#!/usr/bin/env python3
"""Visibility gate for fail-closed security manifests vs in-tree security service providers.

Scans modules/*/module.json for security.enforcementMode == fail-closed, derives required
security services from security.identity / security.encryption / security.contract and from
requires.securityServices, then checks that some other in-tree module lists each service in
provides.securityServices.

Default: print JSON report, exit 0 (visibility only).
Strict: exit 1 if any required service is unresolved.

Env:
  SECURITY_PROVIDER_ENFORCEMENT_STRICT=1|true|yes — same as --strict
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# contract providers satisfy contract pillar requirements
CONTRACT_PROVIDER_SERVICES = frozenset({"contract-evaluation", "contract-enforcement"})


def _core_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _strict_from_env() -> bool:
    raw = os.environ.get("SECURITY_PROVIDER_ENFORCEMENT_STRICT", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _iter_module_manifests(modules_dir: Path) -> list[Path]:
    if not modules_dir.is_dir():
        return []
    out: list[Path] = []
    for child in sorted(modules_dir.iterdir()):
        if child.is_dir():
            mj = child / "module.json"
            if mj.is_file():
                out.append(mj)
    return out


def _parse_provides_security_services(data: dict) -> list[str]:
    prov = data.get("provides") or {}
    raw = prov.get("securityServices")
    if not isinstance(raw, list):
        return []
    return sorted({str(x) for x in raw if isinstance(x, str) and x.strip()})


def _contract_needs_evaluation(contract: object) -> bool:
    if not isinstance(contract, dict):
        return False
    net = contract.get("network")
    if isinstance(net, dict):
        access = net.get("access", "none")
        if isinstance(access, str) and access.strip().lower() != "none":
            return True
    for key in ("moduleCommunication", "dataGates"):
        v = contract.get(key)
        if isinstance(v, list) and len(v) > 0:
            return True
    return False


def _required_services_for_fail_closed(data: dict) -> tuple[list[str], dict[str, object]]:
    """Return sorted unique service ids and a reasons map (service -> detail)."""
    sec = data.get("security")
    if not isinstance(sec, dict):
        return [], {}
    if sec.get("enforcementMode") != "fail-closed":
        return [], {}

    reasons: dict[str, str] = {}
    needed: set[str] = set()

    req = data.get("requires") or {}
    ss = req.get("securityServices")
    if isinstance(ss, list):
        for item in ss:
            if isinstance(item, str) and item.strip():
                s = item.strip()
                needed.add(s)
                reasons.setdefault(s, "requires.securityServices")

    ident = sec.get("identity")
    if isinstance(ident, dict) and ident.get("required", True) is True:
        needed.add("identity-provider")
        reasons.setdefault("identity-provider", "security.identity.required")

    enc = sec.get("encryption")
    if isinstance(enc, dict):
        if enc.get("dataAtRest") == "required":
            needed.add("storage-encryption")
            reasons.setdefault("storage-encryption", "security.encryption.dataAtRest=required")
        purposes = enc.get("keyPurposes")
        if isinstance(purposes, list) and len(purposes) > 0:
            needed.add("key-management")
            reasons.setdefault("key-management", "security.encryption.keyPurposes non-empty")
        if enc.get("transitEncryption") == "mtls":
            # mtls path uses module identity material; treat as identity-provider obligation
            needed.add("identity-provider")
            if "identity-provider" not in reasons:
                reasons["identity-provider"] = "security.encryption.transitEncryption=mtls"

    if _contract_needs_evaluation(sec.get("contract")):
        # either provider type satisfies the contract pillar
        needed.add("contract-evaluation")
        reasons.setdefault("contract-evaluation", "security.contract declares evaluated surface")

    out = sorted(needed)
    detail: dict[str, object] = {k: reasons.get(k, "") for k in out}
    return out, detail


def _global_providers_by_service(manifests: list[tuple[str, Path, dict]]) -> dict[str, list[str]]:
    """service_id -> sorted module ids that provide it."""
    inv: dict[str, set[str]] = {}
    for mid, _path, data in manifests:
        for svc in _parse_provides_security_services(data):
            inv.setdefault(svc, set()).add(mid)
    return {k: sorted(v) for k, v in sorted(inv.items())}


def _unresolved(
    module_id: str,
    required: list[str],
    providers_by_service: dict[str, list[str]],
) -> list[dict[str, object]]:
    gaps: list[dict[str, object]] = []
    for svc in required:
        if svc == "contract-evaluation":
            ok = any(
                providers_by_service.get(p) for p in CONTRACT_PROVIDER_SERVICES
            )
            if ok:
                continue
            gaps.append(
                {
                    "service": svc,
                    "reason": "no in-tree contract-evaluation or contract-enforcement provider",
                }
            )
            continue
        if not providers_by_service.get(svc):
            gaps.append({"service": svc, "reason": "no in-tree provider module"})
    return gaps


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit 1 when fail-closed modules lack required in-tree providers",
    )
    args = parser.parse_args()
    strict = args.strict or _strict_from_env()

    core = _core_root()
    modules_dir = core / "modules"
    rows: list[dict[str, object]] = []
    all_manifests: list[tuple[str, Path, dict]] = []

    for path in _iter_module_manifests(modules_dir):
        try:
            data = _load_json(path)
        except (OSError, json.JSONDecodeError) as exc:
            rows.append(
                {
                    "module_id": path.parent.name,
                    "manifest": str(path.relative_to(core)),
                    "error": str(exc),
                }
            )
            continue
        mid = str(data.get("id") or path.parent.name)
        all_manifests.append((mid, path, data))

    providers_by_service = _global_providers_by_service(all_manifests)

    fail_closed_modules: list[dict[str, object]] = []
    total_unresolved = 0

    for mid, path, data in all_manifests:
        required, reason_detail = _required_services_for_fail_closed(data)
        if not required:
            continue
        gaps = _unresolved(mid, required, providers_by_service)
        entry = {
            "module_id": mid,
            "manifest": str(path.relative_to(core)),
            "enforcementMode": "fail-closed",
            "requiredSecurityServices": required,
            "requirementReasons": reason_detail,
            "unresolved": gaps,
        }
        fail_closed_modules.append(entry)
        total_unresolved += len(gaps)

    report: dict[str, object] = {
        "coreRoot": str(core),
        "strict": strict,
        "inTreeSecurityProvidersByService": providers_by_service,
        "failClosedModules": fail_closed_modules,
        "summary": {
            "failClosedModuleCount": len(fail_closed_modules),
            "unresolvedRequirementCount": total_unresolved,
        },
    }

    print(json.dumps(report, indent=2, sort_keys=True))

    if strict and total_unresolved > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
