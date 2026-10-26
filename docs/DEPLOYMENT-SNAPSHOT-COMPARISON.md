---
gas_schema: gas.doc.v1
type: guide
title: Offline deployment snapshot comparison
status: draft
created: 2026-10-24T15:54:31Z
project: peermesh-core
project_root: .
---

# Offline deployment snapshot comparison

Compare two explicitly supplied local JSON snapshots:

```sh
python3 scripts/validation/compare_deployment_snapshots.py expected.json observed.json
python3 -m unittest discover -s tests/deployment_drift
```

Requires Python 3.10 or later and its standard library. The command only reads
the two files. It does not query Docker/Traefik, access a URL, derive the expected
state from a repository, install a job, send an alert or change a deployment.

## Version 1 input contract

This example is synthetic. Its hash is a format example, not a captured file:

```json
{
  "schema": "peermesh.deployment-snapshot.v1",
  "source_kind": "synthetic",
  "routers": {
    "capture_status": "complete",
    "items": {
      "example@docker": {
        "rule": "Host(`example.invalid`)",
        "service": "example@docker",
        "middlewares": ["auth@file", "rate@file"],
        "tls": {}
      }
    }
  },
  "middlewares": {
    "capture_status": "complete",
    "items": {"rate@file": {"rateLimit": {"average": 20, "burst": 5}}}
  },
  "dynamic_files": {
    "capture_status": "complete",
    "items": {"security.yml": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
  }
}
```

- The top-level object has exactly the five shown keys. The schema is exact;
  `source_kind` is `synthetic` or `captured` and must match between inputs.
- Every collection has exactly `capture_status` and `items`. Only `complete`
  is accepted. Missing, failed, partial, null or malformed captures are invalid.
- Router/middleware `items` are maps from exact names to nonempty configuration
  objects. Preserve provider suffixes and every native configuration field.
  Names cannot be empty, padded with whitespace or contain control characters.
  Duplicate names and JSON keys at any depth are invalid, even if values match.
- Dynamic-file `items` maps canonical relative POSIX file paths to lowercase
  64-character SHA-256 strings. Absolute/drive paths, backslashes, empty paths,
  dot/parent segments, repeated separators and trailing slashes are invalid.
  Paths are compared as written; no file is opened through this mapping.
- An explicitly complete empty inventory is `{"capture_status":"complete",
  "items":{}}`. Two such snapshots may be equivalent. A nonempty inventory
  becoming empty is drift; missing capture metadata is never treated as empty.

Dictionary key order is insignificant. All arrays, including middleware chains
and unknown extension arrays, remain ordered. Unknown configuration fields are
fully compared; unknown envelope/capture fields are rejected. No provider,
router, middleware, setting or dynamic-file removal is ignored. Nested empty
objects, arrays and null values remain meaningful configuration values.

JSON numbers use exact decimal comparison: `100` and `1e2` are the same value;
booleans remain distinct from numbers. NaN, Infinity, invalid UTF-8, lone Unicode
surrogates and malformed JSON are rejected. Excessively deep parser/comparison
input fails as invalid rather than producing an equality result.

Complete-capture markers and `captured` are assertions by the input producer,
not authentication or proof of a real capture. The comparator validates this
envelope and JSON structure; it does not validate native Traefik semantics,
prove inventory completeness/freshness or detect settings omitted from both
inputs. A later collector/expected-state builder must bind those guarantees.

## Output and exits

Stdout is one deterministic JSON object. Stderr is one concise count/error
summary. No raw names, configuration keys/values, file paths, hashes from the
input, credential-like text or response bodies are echoed.

- Exit `0`: `{"changed_paths":[],"status":"equivalent"}`.
- Exit `1`: `{"changed_paths":["..."],"status":"drift"}`.
- Exit `2`: `{"error":"fixed_error_code","input":"expected|observed|pair","status":"invalid"}`.

Changed paths start with `/routers`, `/middlewares` or `/dynamic_files`.
Each following map-key segment is `k-` plus the lowercase SHA-256 of that key's
exact UTF-8 bytes. The first such segment identifies the router/middleware name
or relative file path. Subsequent segments identify nested configuration keys.
Array segments are zero-based decimal indices. Added/removed whole objects are
reported at their own path; values are never included. Paths are sorted.

For example, a changed middleware chain produces paths ending in `/0` and `/1`
under its router-name and `middlewares` key tokens. A caller with the input can
resolve tokens locally by hashing its keys; no output includes the original
key text. This remains a comparison result, not a scheduled alert or release
acceptance.
