---
gas_schema: gas.doc.v1
type: guide
title: Offline HTTP file-provider projection
status: active
created: 2026-10-24T18:26:37Z
updated: 2026-10-24T22:07:24Z
project: peermesh-core
project_code: PMSYS
project_root: /Users/grig/work/peermesh/repo/peermesh-core/sub-repos/core
workstream: pm-platform-security
created_by: dev-worker
privacy_scope: project-readable
source_work_order: /Users/grig/work/peermesh/repo/peermesh-system/.dev/ai/workorders/WO-PMSYS-2026-07-14-166-core-comp-c-canonicalization-and-docker-lab-tracking.md
---

# Offline HTTP file-provider projection

`scripts/validation/project_file_provider_snapshot.py` derives expected configuration
from a complete local file inventory and ingests an independent saved Traefik
`/api/rawdata` response plus runtime file bytes. It reuses the existing deployment
snapshot comparator. It does not collect from a running deployment, authenticate,
schedule work, or establish deployment completeness.

The `peermesh.file-provider-projection.v1` envelope binds Traefik **2.11.41**,
HTTP **file-provider** routers, **headers, rateLimit, chain, forwardAuth, buffering and ipAllowList middleware**, and all inventoried dynamic
file byte hashes. HTTP services (including `api@internal`), static configuration,
TLS, TCP and UDP are explicitly excluded. Nonempty TCP/UDP API inventories, other
router/middleware providers and unexpected top-level fields are refused. The CLI
requires source and observed origins with exactly this scope; it rejects the old
unscoped deployment snapshot envelope.

## Input contract

Use Python with the already available **PyYAML 6.0.3** (the verified version).
No installation or network operation is performed by this tool.

Source files must be UTF-8 `.yaml` or `.yml`, containing one YAML document with
only an `http` root. Its admitted collections are `routers`, `middlewares` and
optional `services`; services are excluded from configuration comparison but
their file bytes remain hashed. There must be at least one router and one
middleware in the complete file set. Each middleware must have exactly one
supported type. `headers` retains its existing nonempty-object contract;
the other types use the narrower contracts below. Routers require explicit nonempty `entryPoints`, `rule`,
`service` and a nonzero integer `priority`. TLS router fields are refused.

The parser refuses duplicate mapping keys, duplicate names across files,
provider-qualified source names, anchors, aliases, merges, explicit tags,
directives, template openers and non-JSON YAML types. Strings, arrays, objects,
lowercase `true`/`false`, literal `null`, and decimal integers with JSON spelling
are supported. Fractional/exponent numbers, timestamps, binary/set values,
YAML 1.1 booleans such as `yes`, octal/hex integers and shorthand nulls are
refused instead of coerced. Plain strings beginning with numeric-looking text
(for example `1e3`, `0o12` or `123.example`) require quotes because YAML parsers
can assign different types. The sole exception is a whole-second duration at
`http.middlewares.<name>.rateLimit.period`, allowing the existing plain `1h`
Events source. It does not relax scalar handling in headers or other fields.
Multiple documents and malformed input are invalid.
Names are qualified with `@file`; bare router middleware references receive
`@file`. Other-provider middleware references are refused. Service references
and all other admitted configuration values are retained exactly.

No generic default removal occurs. For headers and routers, unknown configuration fields, array order,
empty values, zero and false are retained. Unsupported middleware types and
metadata-name collisions fail explicitly. Traefik may omit configured zero or
false values during JSON serialization; that produces literal drift, never a
silently normalized match. This tool does not claim general Traefik semantic
equivalence or validate every Traefik configuration field.

## Rate-limit and chain contract

`rateLimit` requires explicit `average`, `burst` and `period`; its only optional
key is `sourceCriterion`. Average and burst must be positive integers no larger
than 2^63−1. Missing, zero, negative, boolean, fractional and string rates are
refused; omitted defaults are not filled. Unknown keys and mixed middleware
types are refused rather than discarded.

Source and raw-API periods must be nonempty strings comprising decimal integer
components in `h`, `m`, `s` order, each at most once. Components have no sign or
leading zero except the literal `0`. At least one component and a positive total
are required. Examples: `1h`, `90s`, `1m30s`, `1h0m0s`, `1h2m3s`. Fractional,
subsecond, unitless, numeric, exponent, day, repeated-unit and out-of-order forms
are refused. The string is limited to32 characters, and its total cannot exceed
9,223,372,036 seconds (whole seconds within signed64-bit nanoseconds).

The projection stores `period` as an exact positive integer number of **seconds**,
bound by `scope.rate_limit_period_unit`. Both independent source and observed
configuration receive this normalization. A serialized projection must already
contain canonical integer seconds; passing source strings to comparison fails.
The pinned owned fixture observed `1h`→`1h0m0s`, `90s`→`1m30s`, `2m`→`2m0s`,
`3s`→`3s` and `1h2m3s`→`1h2m3s`. Rate values are never converted to floating-point
requests per second. File-byte hashes still detect spelling or comment changes.

An absent `sourceCriterion` is retained as absent: this is the configured default
remote-address criterion. The only admitted explicit criterion is exactly
`{requestHeaderName: <name>}`, preserving the name and its case. The supported
name grammar is an ASCII letter or digit followed by ASCII letters, digits or
hyphens. Empty criteria, `ipStrategy`, `requestHost`, mixed selectors, nulls and
unknown fields are refused. This intentionally covers the existing Events
default-IP and actor-header definitions; it does not prove actual client-IP
selection, trusted proxy handling, authentication or actor-header trust.

`chain` admits exactly a nonempty `middlewares` string array. Each name uses an
ASCII letter/digit followed by ASCII letters/digits, underscore, dot or hyphen,
optionally ending with `@file`. Other providers, empty names, whitespace, paths,
extra keys and non-string members are refused. Order and duplicate occurrences
are preserved. Source and API bare names receive `@file`; existing `@file` names
stay unchanged. The owned fixture observed used bare/qualified/mixed chains
as fully qualified, including repeated references, while inert Events chains
retained bare references in rawdata. Both forms therefore normalize explicitly.
Serialized projections require qualified chain references. This is configuration
comparison, not chain reachability, cycle detection or middleware enforcement.

### Forward auth, buffering and IP allow lists

`forwardAuth` requires exactly `address`, `trustForwardHeader` and
`authResponseHeaders` in source and serialized projections. Trust must be an
explicit boolean. Only raw observed omission normalizes to false, recorded as
`forward_auth_observed_trust_default: false` in scope; explicit observed false
also remains false. No other omission/default is inferred. The header list must
be nonempty and use the same ASCII letter/digit/hyphen name grammar as the rate
criterion. Order, case and duplicate occurrences remain significant. TLS,
request-header, regex, body and all other fields are refused.

The address grammar is intentionally narrower than a general URL: lowercase
`http://` or `https://`, an ASCII DNS hostname or canonical dotted-decimal IPv4
host, optional decimal port1–65535 without leading zeros, and a mandatory absolute
path. DNS labels use letters/digits and interior hyphens, at most63 characters
per label and253 for the host, with no empty labels or trailing dot. Numeric-only
hosts must be canonical IPv4 addresses. Paths allow ASCII letters/digits and
`/._~-`; repeated slashes and `.`/`..` segments are refused. Root and trailing
slashes are admitted. No IPv6 URL literals, userinfo, percent encoding, query,
fragment, backslash, template, whitespace or control characters are admitted.
Accepted address bytes are retained without rewriting, resolving or requesting
the address. This compares configuration, not authentication behavior.

`buffering` requires exactly `maxRequestBodyBytes` and `memRequestBodyBytes`,
each an explicit positive integer at most9,223,372,036,854,775,807. Boolean,
fractional, zero/negative/overflow and missing values, response buffering,
retry expressions and unknown fields are refused. No defaults or body-enforcement
behavior are inferred.

`ipAllowList` requires exactly a nonempty `sourceRange` array. Each entry must
equal the standard library `ipaddress.ip_network(value, strict=True)` canonical
IPv4/IPv6 CIDR spelling, including a slash and prefix length. Bare IPs, host bits,
leading-zero/dotted-netmask prefixes, expanded or uppercase noncanonical IPv6,
zone IDs, whitespace and malformed values are refused. Order and duplicates are
retained. `ipStrategy`, unknown fields and mixed middleware types are refused;
no actual client address or allow/deny result is inferred.

The pinned owned-fixture rawdata qualified omitted false trust on an initially
false definition and after a synthetic true→false reload. Its header and CIDR
arrays retained exact order, case and duplicates, and request-buffer integers
remained literal without additional fields. The integrated capture bound
independent expected before allocation, returned baseline0, actual six-field
security reload drift1, and stopped-client invalid2 with earlier output intact.
Canonical input files remained unchanged and their authentication/enforcement
paths were not queried. The affected 29 projection and 21 capture methods passed;
the comparator suite was not replayed. These facts qualify the stated restricted
configuration contract only.

The scope differs from the earlier headers-only and headers/rateLimit/chain
envelopes, and comparisons reject both. The matching
[capture runner](FILE-PROVIDER-CAPTURE.md) pins this projector and imports its
scope. Qualification remains limited to an owned synthetic fixture with a stable,
non-atomic observation bracket. Canonical adoption follows independent parent
acceptance and a separate guarded write interval.

Both source and observed files require an explicit JSON inventory:

```json
{"schema":"peermesh.file-inventory.v1","capture_status":"complete","files":["fixture.yaml"]}
```

The inventory must exactly equal the nonempty physical file tree. Paths must be
canonical relative POSIX paths; unsafe names, missing/unlisted files, duplicate
names, symlink roots/ancestors/entries and special files are refused. SHA-256
covers exact file bytes, including comments and whitespace. Inventory completeness
is local to the supplied root: the tool cannot prove that an operator supplied
every directory mounted in an unrelated deployment.

Observed ingestion requires the actual full rawdata body and this separately
saved receipt (values here illustrate the fields, not a usable receipt):

```json
{"schema":"peermesh.rawdata-receipt.v1","method":"GET","path":"/api/rawdata","status":200,"complete":true,"content_type":"application/json","body_sha256":"<64 lowercase hex digits>","body_bytes":123}
```

The byte count and SHA-256 must match the saved body. Missing, unsuccessful,
incomplete, truncated, empty, duplicate-key or malformed responses are invalid.
The required router and middleware maps must be nonempty and every object must
have `status: enabled` and no errors. The only removed fields are router
`status`, `error`, `using`, and middleware `status`, `error`, `usedBy`. Error lists
must be absent or empty; usage fields must be absent or arrays of nonempty
strings. All remaining admitted configuration is retained. Additional raw HTTP
service data is outside the comparison; it is never described as full coverage.

Receipts and runtime file inventories are explicit local inputs, not trusted
proof of how they were acquired. Supply them from an independent capture with
known generation/custody. This tool has no live atomic-snapshot guarantee.

## Commands

Derive expected **before** capturing runtime data, using independent directories:

```sh
python3 scripts/validation/project_file_provider_snapshot.py source \
  --files /absolute/source-files --inventory /absolute/source-inventory.json \
  --output /absolute/expected.json
python3 scripts/validation/project_file_provider_snapshot.py observed \
  --files /absolute/runtime-files --inventory /absolute/runtime-inventory.json \
  --body /absolute/rawdata.json --receipt /absolute/api-receipt.json \
  --output /absolute/observed.json
python3 scripts/validation/project_file_provider_snapshot.py compare \
  /absolute/expected.json /absolute/observed.json
```

Projection exits 0 on success and 2 on invalid input. Comparison exits 0 for
equality within the bound scope, 1 for drift, and 2 for invalid input. Comparison
prints opaque change paths and scope, without configuration values. Projection
files intentionally contain configuration and require appropriate custody.

Run only the focused new tests with:

```sh
python3 -B -m unittest discover -s tests/deployment_drift -p test_file_provider_projection.py -v
```

## Pinned source basis

The rawdata response has full runtime maps in
[API handler v2.11.41](https://raw.githubusercontent.com/traefik/traefik/v2.11.41/pkg/api/handler.go).
Metadata is defined by
[HTTP runtime structs](https://raw.githubusercontent.com/traefik/traefik/v2.11.41/pkg/config/runtime/runtime_http.go);
embedded router fields are in
[HTTP configuration](https://raw.githubusercontent.com/traefik/traefik/v2.11.41/pkg/config/dynamic/http_config.go)
and middleware fields in
[middleware configuration](https://raw.githubusercontent.com/traefik/traefik/v2.11.41/pkg/config/dynamic/middlewares.go).
Router middleware qualification follows
[router construction](https://raw.githubusercontent.com/traefik/traefik/v2.11.41/pkg/server/router/router.go)
and [provider naming](https://raw.githubusercontent.com/traefik/traefik/v2.11.41/pkg/server/provider/provider.go).
The [file provider](https://raw.githubusercontent.com/traefik/traefik/v2.11.41/pkg/provider/file/file.go)
supports broader inputs than this intentionally restricted offline projection.
