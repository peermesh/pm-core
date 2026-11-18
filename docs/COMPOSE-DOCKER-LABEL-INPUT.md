---
gas_schema: gas.doc.v1
type: guide
title: Resolved Compose inventory to Docker label input
status: draft
created: 2026-10-26T17:45:30Z
updated: 2026-10-31T05:46:09Z
project: peermesh-core
project_code: PMSYS
project_root: ~/work/peermesh/repo/peermesh-core
workstream: pm-platform-security
---

# Resolved Compose label input

`scripts/validation/extract_compose_docker_labels.py` converts an explicitly
supplied, already resolved Compose JSON document into the existing
`peermesh.docker-resolved-labels.v1` input. It validates that inventory with the
unchanged Docker provider projector before creating an output. It does not run
Compose, read environment variables, inspect Docker, make requests or evaluate
commands. Python3.10 or later and the existing PyYAML dependency are required.

## Inputs and command

Supply two regular local JSON files using absolute paths with no symlink
components or parent traversal. Each file must be private (no group or other
permission bits) and no larger than1MiB. The output's immediate parent must also
be private. For example, in a checkout containing this adapter and its helpers:

```sh
python3 -B scripts/validation/extract_compose_docker_labels.py --compose "$PWD/private/resolved-compose.json" --provider-scope "$PWD/private/provider-scope.json" --output "$PWD/private/resolved-labels.json"
python3 -B scripts/validation/project_docker_provider_snapshot.py source --input "$PWD/private/resolved-labels.json" --output "$PWD/private/expected-projection.json"
```

Use a private directory and `umask 077` when preparing those input files. The
provider-scope file must contain exactly:

```json
{"exposedByDefault": false, "swarmMode": false}
```

Both values must be JSON booleans. This is an explicit caller assertion, not a
default or proof of a deployment's Traefik configuration.

The Compose document must have a nonempty `services` object whose values are
objects. Each service's `labels` must be a string-to-string map. Missing `labels`
means an empty map; null, array shorthand and non-string entries are rejected.
Every supplied service is retained, including profile-associated services,
explicitly disabled services and services without labels. No service selection,
hostname generation or name normalization occurs. Other Compose fields are
outside the output and validation claim; finite fractional numbers in those
fields are accepted without converting labels. The file is not a Compose schema
validator or proof that rendering occurred.

Top-level `include` and service-level `extends` or `label_file` are refused because
they could hide label inventory outside the supplied document. Resolve them
before supplying the JSON. Unknown Traefik label fields, conflicting router or
middleware names, case-colliding labels and unsupported values are rejected by
the existing projector. Its lower-case service-name grammar and requirement for
nonempty projected router and middleware collections remain unchanged. An
inventory containing only disabled/unlabelled services is therefore unsupported.

Duplicate JSON keys at any depth, NaN/Infinity, invalid UTF-8, lone Unicode
surrogates and excessive nesting are rejected. Unresolved `${...}`/template
expressions in label keys or values are refused. Dollar syntax in label keys or
non-Traefik label values is unsupported. The existing projector validates the
specific crypt-dollar exception in BasicAuth users; it does not interpolate or
unescape it. Literal non-Traefik strings, including whitespace, empty strings and
Unicode, are otherwise preserved. Their meaning is outside projection scope.
Environment expressions in non-label Compose settings are neither evaluated
nor certified as resolved.

## Compose config render input

`docker compose config --format json` writes each literal dollar in a label as
two dollars. By default the adapter does not unescape, so that render is refused
when a BasicAuth label holds a crypt hash. Add `--compose-config-render` only when
the `--compose` file is that render:

```sh
python3 -B scripts/validation/extract_compose_docker_labels.py --compose-config-render --compose "$PWD/private/compose-config.json" --provider-scope "$PWD/private/provider-scope.json" --output "$PWD/private/resolved-labels.json"
```

With the flag, each pair of dollars in a label value becomes one dollar before
any other check, so the output and its projection match the single-dollar input.
A lone dollar in a label value is refused, including a single-dollar document
supplied by mistake. All existing checks then run on the unescaped value, so
`$${X}` is refused as `${X}`, and a dollar stays refused in a label key, a
non-Traefik label value and any Traefik label value other than BasicAuth users.
Non-label fields are not read, changed or validated for dollar syntax. The flag
must be spelled exactly; it has no prefix forms. It does not run Compose or prove
that the input came from a render. The receipt does not record the flag, and its
`output` binding differs from its `compose` binding because the bytes differ.

## Output, privacy and bindings

The generated file has exactly four fields:

```json
{
  "schema": "peermesh.docker-resolved-labels.v1",
  "capture_status": "complete",
  "provider": {"exposedByDefault": false, "swarmMode": false},
  "services": {"service-name": {"label-key": "exact label string"}}
}
```

This schematic example shows the shape; actual labels must satisfy the projector.
`complete` means all services in the supplied document were visited. It cannot
prove that files, services, profiles or overrides were not omitted before input
creation. The adapter does not filter profiles, so callers must supply the
intended complete inventory. Canonical serialization sorts object keys while
preserving every name and string value.

Output is bounded to1MiB, created exclusively with mode0600 and read back. An
existing file, symlink, directory or input/output collision is refused without
overwriting it. A failed write removes only the newly created matching inode.
Raw labels, including BasicAuth users, remain in this private output. It is not
a redacted projection and must not be published or copied into public logs.

Exit0 emits a JSON receipt with `status: extracted`, the schema, and SHA256/byte
length bindings for both inputs, the output, this adapter and its five helper
sources. It prints no labels, supplied paths or exception details. Exit2 emits
only `{"reason":"invalid_or_unavailable_input","status":"invalid"}`; stderr
is empty for handled input/CLI errors. `--help` prints static usage.

The reader reuses bounded descriptor reads and local identity checks. These
detect certain replacement/modification races; they do not establish a globally
atomic snapshot of all paths or defend an output directory actively controlled
by another writer. Hashes bind observed bytes, not origin, deployment authority
or inventory freshness. Use trusted local private directories.

## APIs and proof boundary

`extract_labels(compose, provider, *, compose_config_render=False)` returns the
validated four-field mapping.
`extract_compose_labels(compose_path, provider_scope_path, output_path, *, compose_config_render=False)`
performs the bounded file conversion and returns the hash/length receipt. The
keyword is the API form of `--compose-config-render`. `main(argv)` provides the CLI and fixed-error boundary. All projector semantics remain owned
by `project_docker_provider_snapshot.project_source`.

Run the new focused suite with:

```sh
python3 -B -m unittest discover -s tests/deployment_drift -p test_compose_docker_labels.py -v
```

The suite uses synthetic inventory and credential strings. It exercises the
actual adapter and projector CLIs, multiple services, exclusions, label semantics,
added/removed services, refusals, private modes and collision preservation. It
does not render Compose or contact a runtime. Existing projector/capture runtime
qualification is separate evidence. Clean-environment Compose rendering and
capture integration remain a subsequent qualification boundary; this source
adapter establishes no live completeness, TLS/authentication enforcement,
production parity or full Compose canonicalization acceptance.

See [Docker projection](DOCKER-PROVIDER-PROJECTION.md),
[Docker capture](DOCKER-PROVIDER-CAPTURE.md) and
[snapshot comparison](DEPLOYMENT-SNAPSHOT-COMPARISON.md).
