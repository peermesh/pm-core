#!/usr/bin/env python3
"""Module install gate for launch_core.sh (module enable/install).

Two checks run before any module hook or compose call:

  manifest  Validate modules/<name>/module.json against
            foundation/schemas/module.schema.json (and the sibling schemas it
            references). Uses the `jsonschema` package when it is installed;
            otherwise a built-in validator for the keywords these schemas use.
            The built-in validator fails closed on any keyword it does not
            implement. Schema references resolve from local files only; no
            network access.

  compose   Render the module's compose with `docker compose config` (render
            only, nothing starts), report per service what it asks of the
            host, and refuse dangerous requests unless the operator allowed
            this module explicitly.

Exit codes:
  0  pass
  1  validation or render error (not overridable)
  2  usage error
  3  dangerous request refused
  4  dangerous request present, allowed by an explicit operator override
"""

from __future__ import annotations

import argparse
import datetime as _dt
import getpass
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urldefrag, urljoin

EXIT_OK = 0
EXIT_INVALID = 1
EXIT_USAGE = 2
EXIT_REFUSED = 3
EXIT_ALLOWED_BY_OVERRIDE = 4


# ---------------------------------------------------------------------------
# Manifest validation
# ---------------------------------------------------------------------------

def load_schema_store(schema_dir: Path) -> dict[str, dict]:
    store: dict[str, dict] = {}
    for path in sorted(schema_dir.glob("*.json")):
        with path.open(encoding="utf-8") as handle:
            doc = json.load(handle)
        store[doc.get("$id", path.resolve().as_uri())] = doc
    return store


def _field_path(parts) -> str:
    parts = [str(p) for p in parts]
    return ".".join(parts) if parts else "(root)"


def _jsonschema_errors(schema: dict, store: dict[str, dict], instance) -> list[tuple[str, str]]:
    import jsonschema  # noqa: F401  (import error handled by caller)

    try:
        from referencing import Registry, Resource
        from referencing.jsonschema import DRAFT202012

        registry = Registry()
        for uri, doc in store.items():
            registry = registry.with_resource(uri, Resource.from_contents(doc, default_specification=DRAFT202012))
        validator = jsonschema.Draft202012Validator(schema, registry=registry)
    except ImportError:  # jsonschema < 4.18
        resolver = jsonschema.RefResolver.from_schema(schema, store=dict(store))
        validator = jsonschema.Draft202012Validator(schema, resolver=resolver)

    errors: list[tuple[str, str]] = []
    for err in sorted(validator.iter_errors(instance), key=lambda e: list(map(str, e.absolute_path))):
        path = list(err.absolute_path)
        if err.validator == "required" and isinstance(err.instance, dict):
            for field in err.validator_value:
                if field not in err.instance:
                    errors.append((_field_path(path + [field]), "missing required field"))
            continue
        errors.append((_field_path(path), err.message))
    return errors


class UnsupportedSchema(Exception):
    pass


class BuiltinValidator:
    """Small Draft 2020-12 validator for the keywords used by foundation/schemas.

    Any assertion keyword it does not implement raises UnsupportedSchema, so a
    schema change can never silently weaken validation.
    """

    ANNOTATIONS = {
        "$schema", "$id", "$defs", "$comment", "title", "description", "default",
        "examples", "format", "deprecated", "readOnly", "writeOnly",
    }
    HANDLED = {
        "$ref", "type", "enum", "const", "properties", "patternProperties",
        "additionalProperties", "required", "items", "minItems", "maxItems",
        "uniqueItems", "minLength", "maxLength", "pattern", "minimum", "maximum",
        "exclusiveMinimum", "exclusiveMaximum", "oneOf", "anyOf", "allOf", "not",
        "if", "then", "else", "minProperties", "maxProperties",
    }

    def __init__(self, store: dict[str, dict]):
        self.store = store

    def errors(self, schema: dict, instance) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        self._validate(instance, schema, [], schema.get("$id", ""), schema, out)
        return out

    def _resolve(self, ref: str, base: str, root: dict):
        uri = urljoin(base, ref) if base else ref
        doc_uri, fragment = urldefrag(uri)
        if doc_uri in ("", base):
            doc = root
            doc_uri = base
        else:
            if doc_uri not in self.store:
                raise UnsupportedSchema(f"unresolvable $ref '{ref}' (no local schema with $id {doc_uri})")
            doc = self.store[doc_uri]
        node = doc
        if fragment:
            for token in fragment.lstrip("/").split("/"):
                token = token.replace("~1", "/").replace("~0", "~")
                if not isinstance(node, dict) or token not in node:
                    raise UnsupportedSchema(f"unresolvable $ref '{ref}'")
                node = node[token]
        return node, doc_uri, doc

    @staticmethod
    def _type_ok(value, expected: str) -> bool:
        if expected == "object":
            return isinstance(value, dict)
        if expected == "array":
            return isinstance(value, list)
        if expected == "string":
            return isinstance(value, str)
        if expected == "boolean":
            return isinstance(value, bool)
        if expected == "null":
            return value is None
        if expected == "integer":
            return (isinstance(value, int) and not isinstance(value, bool)) or (
                isinstance(value, float) and value.is_integer())
        if expected == "number":
            return isinstance(value, (int, float)) and not isinstance(value, bool)
        raise UnsupportedSchema(f"unknown type '{expected}'")

    def _matches(self, instance, schema, base, root) -> bool:
        probe: list = []
        self._validate(instance, schema, [], base, root, probe)
        return not probe

    def _validate(self, inst, schema, path, base, root, out) -> None:  # noqa: C901
        if schema is True:
            return
        if schema is False:
            out.append((_field_path(path), "no value is allowed here"))
            return
        if not isinstance(schema, dict):
            raise UnsupportedSchema("schema node is not an object")

        unknown = set(schema) - self.ANNOTATIONS - self.HANDLED
        if unknown:
            raise UnsupportedSchema(f"schema keyword(s) not supported by the built-in validator: {sorted(unknown)}")

        if "$id" in schema and schema is not root:
            base = urljoin(base, schema["$id"])
            root = schema

        if "$ref" in schema:
            target, t_base, t_root = self._resolve(schema["$ref"], base, root)
            self._validate(inst, target, path, t_base, t_root, out)

        here = _field_path(path)

        if "type" in schema:
            types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
            if not any(self._type_ok(inst, t) for t in types):
                out.append((here, f"{json.dumps(inst)[:80]} is not of type {' or '.join(types)}"))
                return
        if "enum" in schema and inst not in schema["enum"]:
            out.append((here, f"{json.dumps(inst)[:80]} is not one of {schema['enum']}"))
        if "const" in schema and inst != schema["const"]:
            out.append((here, f"{json.dumps(inst)[:80]} must equal {json.dumps(schema['const'])}"))

        if isinstance(inst, str):
            if "minLength" in schema and len(inst) < schema["minLength"]:
                out.append((here, f"shorter than {schema['minLength']} characters"))
            if "maxLength" in schema and len(inst) > schema["maxLength"]:
                out.append((here, f"longer than {schema['maxLength']} characters"))
            if "pattern" in schema and not re.search(schema["pattern"], inst):
                out.append((here, f"'{inst[:80]}' does not match pattern {schema['pattern']}"))

        if isinstance(inst, (int, float)) and not isinstance(inst, bool):
            if "minimum" in schema and inst < schema["minimum"]:
                out.append((here, f"{inst} is less than minimum {schema['minimum']}"))
            if "maximum" in schema and inst > schema["maximum"]:
                out.append((here, f"{inst} is greater than maximum {schema['maximum']}"))
            if "exclusiveMinimum" in schema and inst <= schema["exclusiveMinimum"]:
                out.append((here, f"{inst} must be greater than {schema['exclusiveMinimum']}"))
            if "exclusiveMaximum" in schema and inst >= schema["exclusiveMaximum"]:
                out.append((here, f"{inst} must be less than {schema['exclusiveMaximum']}"))

        if isinstance(inst, list):
            if "minItems" in schema and len(inst) < schema["minItems"]:
                out.append((here, f"needs at least {schema['minItems']} item(s)"))
            if "maxItems" in schema and len(inst) > schema["maxItems"]:
                out.append((here, f"allows at most {schema['maxItems']} item(s)"))
            if schema.get("uniqueItems"):
                seen = [json.dumps(i, sort_keys=True) for i in inst]
                if len(seen) != len(set(seen)):
                    out.append((here, "items must be unique"))
            if "items" in schema:
                for idx, item in enumerate(inst):
                    self._validate(item, schema["items"], path + [idx], base, root, out)

        if isinstance(inst, dict):
            if "minProperties" in schema and len(inst) < schema["minProperties"]:
                out.append((here, f"needs at least {schema['minProperties']} field(s)"))
            if "maxProperties" in schema and len(inst) > schema["maxProperties"]:
                out.append((here, f"allows at most {schema['maxProperties']} field(s)"))
            for field in schema.get("required", []):
                if field not in inst:
                    out.append((_field_path(path + [field]), "missing required field"))
            props = schema.get("properties", {})
            patterns = schema.get("patternProperties", {})
            extra = []
            for key, value in inst.items():
                matched = False
                if key in props:
                    matched = True
                    self._validate(value, props[key], path + [key], base, root, out)
                for pat, sub in patterns.items():
                    if re.search(pat, key):
                        matched = True
                        self._validate(value, sub, path + [key], base, root, out)
                if not matched:
                    extra.append(key)
            addl = schema.get("additionalProperties", True)
            if addl is False and extra:
                out.append((here, f"additional properties are not allowed ({', '.join(repr(k) for k in extra)} unexpected)"))
            elif isinstance(addl, dict):
                for key in extra:
                    self._validate(inst[key], addl, path + [key], base, root, out)

        if "allOf" in schema:
            for sub in schema["allOf"]:
                self._validate(inst, sub, path, base, root, out)
        if "anyOf" in schema and not any(self._matches(inst, s, base, root) for s in schema["anyOf"]):
            out.append((here, "does not match any of the allowed forms (anyOf)"))
        if "oneOf" in schema:
            hits = sum(1 for s in schema["oneOf"] if self._matches(inst, s, base, root))
            if hits != 1:
                out.append((here, f"must match exactly one allowed form (oneOf); matched {hits}"))
        if "not" in schema and self._matches(inst, schema["not"], base, root):
            out.append((here, "matches a form that is not allowed (not)"))
        if "if" in schema:
            branch = "then" if self._matches(inst, schema["if"], base, root) else "else"
            if branch in schema:
                self._validate(inst, schema[branch], path, base, root, out)


def cmd_manifest(args) -> int:
    module = args.module
    manifest = Path(args.manifest)
    schema_dir = Path(args.schema_dir)
    schema_path = schema_dir / "module.schema.json"

    if not manifest.is_file():
        print(f"[{module}] module.json not found at {manifest}: a manifest is required to install a module", file=sys.stderr)
        return EXIT_INVALID
    if not schema_path.is_file():
        print(f"[{module}] schema not found: {schema_path}", file=sys.stderr)
        return EXIT_INVALID
    try:
        with manifest.open(encoding="utf-8") as handle:
            instance = json.load(handle)
    except json.JSONDecodeError as exc:
        print(f"[{module}] module.json is malformed JSON (line {exc.lineno}, column {exc.colno}): {exc.msg}", file=sys.stderr)
        return EXIT_INVALID

    store = load_schema_store(schema_dir)
    with schema_path.open(encoding="utf-8") as handle:
        schema = json.load(handle)

    engine = os.environ.get("PEERMESH_SCHEMA_ENGINE", "auto")
    if engine not in ("auto", "jsonschema", "builtin"):
        print(f"PEERMESH_SCHEMA_ENGINE must be auto, jsonschema or builtin (got {engine})", file=sys.stderr)
        return EXIT_USAGE
    used = "builtin"
    try:
        if engine in ("auto", "jsonschema"):
            try:
                import jsonschema  # noqa: F401
                used = "jsonschema"
            except ImportError:
                if engine == "jsonschema":
                    print("PEERMESH_SCHEMA_ENGINE=jsonschema but the jsonschema package is not installed", file=sys.stderr)
                    return EXIT_INVALID
        if used == "jsonschema":
            errors = _jsonschema_errors(schema, store, instance)
        else:
            errors = BuiltinValidator(store).errors(schema, instance)
    except UnsupportedSchema as exc:
        print(f"[{module}] cannot validate module.json: {exc}", file=sys.stderr)
        return EXIT_INVALID
    except Exception as exc:  # e.g. unresolvable reference in jsonschema
        print(f"[{module}] cannot validate module.json ({used}): {exc}", file=sys.stderr)
        return EXIT_INVALID

    if errors:
        print(f"[{module}] module.json fails foundation/schemas/module.schema.json ({len(errors)} error(s), engine: {used}):", file=sys.stderr)
        for field, message in errors:
            print(f"[{module}]   field {field}: {message}", file=sys.stderr)
        return EXIT_INVALID
    print(f"[{module}] module.json valid against module.schema.json (engine: {used})")
    return EXIT_OK


# ---------------------------------------------------------------------------
# Compose inspection
# ---------------------------------------------------------------------------

COMPOSE_NAMES = (
    "compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml",
    "compose.override.yaml", "compose.override.yml",
    "docker-compose.override.yaml", "docker-compose.override.yml",
)
SOCKET_BASENAMES = {"docker.sock", "podman.sock", "containerd.sock", "dockershim.sock", "crio.sock", "cri-dockerd.sock"}
SOCKET_DIRS = {"/var/run", "/run", "/var/run/docker", "/run/docker", "/var/run/containerd",
               "/run/containerd", "/run/podman", "/var/run/podman"}


def _norm(path: str) -> str:
    return os.path.normpath(path) if path else path


def _same_path(a: str, b: str) -> bool:
    a, b = _norm(a), _norm(b)
    return a == b or os.path.realpath(a) == os.path.realpath(b)


def _protected_roots(home: str) -> list[tuple[str, str]]:
    roots = [("/", "the host root /"), ("/etc", "/etc")]
    if home:
        home = _norm(home)
        roots.append((home, f"the operator's home {home}"))
        parent = os.path.dirname(home)
        while parent and parent != "/":
            roots.append((parent, f"{parent} (contains the operator's home)"))
            parent = os.path.dirname(parent)
    return roots


def classify_host_path(path: str, home: str) -> list[str]:
    reasons = []
    norm = _norm(path)
    if os.path.basename(norm) in SOCKET_BASENAMES or any(_same_path(norm, d) for d in SOCKET_DIRS):
        reasons.append(f"Docker socket mount ({path})")
    for root, label in _protected_roots(home):
        if _same_path(norm, root):
            reasons.append(f"bind mount of {label}")
            break
    return reasons


def render_compose(module_dir: Path) -> tuple[list[tuple[str, dict]], list[str]]:
    """Return ([(label, rendered_json)], [errors])."""
    renders: list[tuple[str, dict]] = []
    errors: list[str] = []
    invocations = []
    primary = module_dir / "docker-compose.yml"
    if primary.is_file():
        invocations.append(("docker-compose.yml", ["-f", "docker-compose.yml"]))
    others = [n for n in COMPOSE_NAMES if n != "docker-compose.yml" and (module_dir / n).is_file()]
    env_file = module_dir / ".env"
    env_sets_compose_file = False
    if env_file.is_file():
        try:
            env_sets_compose_file = any(
                line.strip().startswith("COMPOSE_FILE=") for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines())
        except OSError:
            pass
    if others or env_sets_compose_file:
        # What a hook's bare `docker compose up` in the module directory would load.
        invocations.append(("default compose file discovery in module dir", []))

    for label, file_args in invocations:
        cmd = ["docker", "compose", *file_args, "--profile", "*", "config", "--format", "json"]
        try:
            proc = subprocess.run(cmd, cwd=str(module_dir), capture_output=True, text=True, timeout=120)
        except FileNotFoundError:
            errors.append("docker is not installed; cannot render the module compose")
            continue
        except subprocess.TimeoutExpired:
            errors.append(f"{label}: docker compose config timed out")
            continue
        if proc.returncode != 0:
            msg = " ".join(line for line in proc.stderr.strip().splitlines() if "level=warning" not in line)
            errors.append(f"{label}: docker compose config failed: {msg or proc.stderr.strip()}")
            continue
        try:
            renders.append((label, json.loads(proc.stdout)))
        except json.JSONDecodeError as exc:
            errors.append(f"{label}: could not parse rendered compose JSON: {exc}")
    return renders, errors


def inspect_render(rendered: dict, home: str) -> tuple[list[dict], list[str]]:
    services_report = []
    violations: list[str] = []
    top_volumes = rendered.get("volumes") or {}

    for vol_name, vol in top_volumes.items():
        opts = (vol or {}).get("driver_opts") or {}
        device = opts.get("device")
        if device and "bind" in str(opts.get("o", "")):
            for reason in classify_host_path(str(device), home):
                violations.append(f"volume {vol_name}: {reason} via driver_opts.device")

    for name, svc in sorted((rendered.get("services") or {}).items()):
        svc = svc or {}
        image = svc.get("image") or ""
        if not image and svc.get("build"):
            build = svc["build"]
            image = f"(built locally from {build.get('context', '?') if isinstance(build, dict) else build})"
        binds, named = [], []
        for vol in svc.get("volumes") or []:
            if isinstance(vol, str):
                parts = vol.split(":")
                vol = {"type": "bind" if parts[0].startswith(("/", ".", "~")) else "volume",
                       "source": parts[0], "target": parts[1] if len(parts) > 1 else ""}
            vtype = vol.get("type")
            source = str(vol.get("source") or "")
            target = vol.get("target", "")
            ro = " (read-only)" if vol.get("read_only") else ""
            if vtype == "bind":
                binds.append(f"{source} -> {target}{ro}")
                for reason in classify_host_path(source, home):
                    violations.append(f"service {name}: {reason}")
            elif vtype == "volume":
                named.append(f"{source or '(anonymous)'} -> {target}{ro}")
                device = ((top_volumes.get(source) or {}).get("driver_opts") or {}).get("device")
                if device:
                    named[-1] += f" [driver_opts.device={device}]"
            else:
                named.append(f"{vtype}: {source or '-'} -> {target}")

        privileged = bool(svc.get("privileged"))
        cap_add = list(svc.get("cap_add") or [])
        devices = []
        for dev in svc.get("devices") or []:
            if isinstance(dev, dict):
                devices.append(f"{dev.get('source')}:{dev.get('target')}")
            else:
                devices.append(str(dev))
        network_mode = svc.get("network_mode") or "default"
        pid = svc.get("pid") or "default"
        ipc = svc.get("ipc") or "default"
        security_opt = list(svc.get("security_opt") or [])
        socket = any("Docker socket" in v for v in violations if v.startswith(f"service {name}:"))

        if privileged:
            violations.append(f"service {name}: privileged: true")
        if cap_add:
            violations.append(f"service {name}: cap_add {cap_add}")
        if devices:
            violations.append(f"service {name}: devices {devices}")
        if network_mode == "host":
            violations.append(f"service {name}: network_mode: host")
        if pid == "host":
            violations.append(f"service {name}: pid: host")
        if ipc == "host":
            violations.append(f"service {name}: ipc: host")

        services_report.append({
            "service": name,
            "image": image or "(none)",
            "bind mounts": binds or ["none"],
            "named volumes": named or ["none"],
            "privileged": str(privileged).lower(),
            "cap_add": ", ".join(cap_add) or "none",
            "devices": ", ".join(devices) or "none",
            "network_mode": network_mode,
            "pid": pid,
            "ipc": ipc,
            "security_opt": ", ".join(security_opt) or "none",
            "docker socket mount": "YES" if socket else "no",
        })
    return services_report, violations


def print_report(module: str, label: str, report: list[dict]) -> None:
    print(f"[{module}] compose render ({label}): {len(report)} service(s)")
    for svc in report:
        print(f"[{module}]   service {svc['service']}")
        for key in ("image", "bind mounts", "named volumes", "privileged", "cap_add", "devices",
                    "network_mode", "pid", "ipc", "security_opt", "docker socket mount"):
            value = svc[key]
            if isinstance(value, list):
                print(f"[{module}]     {key}: {value[0]}")
                for extra in value[1:]:
                    print(f"[{module}]     {' ' * len(key)}  {extra}")
            else:
                print(f"[{module}]     {key}: {value}")


def append_audit(path: str, entry: dict) -> None:
    audit = Path(path)
    audit.parent.mkdir(parents=True, exist_ok=True)
    with audit.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, sort_keys=True) + "\n")


def cmd_compose(args) -> int:
    module = args.module
    module_dir = Path(args.module_dir)
    home = args.home if args.home is not None else os.path.expanduser("~")

    renders, errors = render_compose(module_dir)
    if not renders and not errors:
        print(f"[{module}] no compose file in module directory; nothing to inspect")
        return EXIT_OK
    if errors:
        sys.stdout.flush()
        for err in errors:
            print(f"[{module}] {err}", file=sys.stderr)
        print(f"[{module}] refusing: the module compose could not be rendered, so its host requests cannot be checked", file=sys.stderr)
        return EXIT_INVALID

    all_violations: list[str] = []
    for label, rendered in renders:
        report, violations = inspect_render(rendered, home)
        if args.report:
            print_report(module, label, report)
        for v in violations:
            if v not in all_violations:
                all_violations.append(v)

    sys.stdout.flush()
    if not all_violations:
        print(f"[{module}] compose check passed: no dangerous host requests")
        return EXIT_OK

    if args.allow_dangerous:
        print(f"[{module}] DANGEROUS host requests allowed by operator override (--allow-dangerous={module}):", file=sys.stderr)
        for v in all_violations:
            print(f"[{module}]   - {v}", file=sys.stderr)
        if args.audit_log:
            append_audit(args.audit_log, {
                "time": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "event": "module-install-dangerous-override",
                "module": module,
                "requested_for": args.requested_for or module,
                "operator": getpass.getuser(),
                "findings": all_violations,
            })
            print(f"[{module}] override recorded in {args.audit_log}", file=sys.stderr)
        return EXIT_ALLOWED_BY_OVERRIDE

    print(f"[{module}] REFUSED: the module compose requests dangerous host access:", file=sys.stderr)
    for v in all_violations:
        print(f"[{module}]   - {v}", file=sys.stderr)
    print(f"[{module}] to accept this risk for this module only, re-run with --allow-dangerous={module}", file=sys.stderr)
    return EXIT_REFUSED


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_manifest = sub.add_parser("manifest", help="validate module.json against module.schema.json")
    p_manifest.add_argument("--module", required=True)
    p_manifest.add_argument("--manifest", required=True)
    p_manifest.add_argument("--schema-dir", required=True)

    p_compose = sub.add_parser("compose", help="render and inspect the module compose")
    p_compose.add_argument("--module", required=True)
    p_compose.add_argument("--module-dir", required=True)
    p_compose.add_argument("--report", action="store_true", help="print the per-service report")
    p_compose.add_argument("--allow-dangerous", action="store_true")
    p_compose.add_argument("--audit-log", default="")
    p_compose.add_argument("--requested-for", default="")
    p_compose.add_argument("--home", default=None, help="operator home (default: $HOME)")

    args = parser.parse_args(argv)
    if args.command == "manifest":
        return cmd_manifest(args)
    return cmd_compose(args)


if __name__ == "__main__":
    sys.exit(main())
