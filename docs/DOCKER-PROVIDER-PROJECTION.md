---
gas_schema: gas.doc.v1
type: guide
title: Offline Docker HTTP provider projection
status: active
created: 2026-10-24T23:31:21Z
updated: 2026-10-25T22:48:09Z
project: peermesh-core
project_code: PMSYS
workstream: pm-platform-security
privacy_scope: project-readable
---

# Offline Docker HTTP provider projection

`scripts/validation/project_docker_provider_snapshot.py` compares explicit resolved
Docker labels with a separately supplied Traefik 2.11.41 `/api/rawdata` body. It
reuses the strict JSON reader, middleware validators and opaque deployment
comparator. Python 3.10 or newer and the existing PyYAML dependency are required.

The canonical-shaped five TLS Docker routers and four middleware definitions
were checked against actual Traefik 2.11.41 in a synthetic isolated Docker API
fixture. Equality (exit 0), actual provider-input changed-state drift (exit 1)
and unavailable-capture rejection (exit 2) passed. This proves only
declared-configuration normalization. General capture integration, certificate
availability and TLS enforcement, backend and authentication enforcement, and
production acceptance remain outside the proof. The fixed
`runtime_parity: unqualified` envelope annotation carries no runtime attestation;
this bounded fixture proof does not broaden the schema's scope. Synthetic
rawdata in tests remains a declared expectation, not runtime evidence.
The tool does not invoke Compose, inspect Docker, read environment variables,
render default router rules, look up credentials, make requests or activate TLS.

## Resolved input

Provide JSON with exactly these fields:

```json
{
  "schema": "peermesh.docker-resolved-labels.v1",
  "capture_status": "complete",
  "provider": {"exposedByDefault": false, "swarmMode": false},
  "services": {
    "synthetic-app": {
      "traefik.enable": "true",
      "traefik.http.routers.synthetic.rule": "Host(`synthetic.invalid`)",
      "traefik.http.routers.synthetic.entrypoints": "websecure",
      "traefik.http.routers.synthetic.service": "synthetic",
      "traefik.http.routers.synthetic.tls": "true",
      "traefik.http.routers.synthetic.middlewares": "synthetic-headers",
      "traefik.http.services.synthetic.loadbalancer.server.port": "8080",
      "traefik.http.middlewares.synthetic-headers.headers.frameDeny": "true"
    },
    "disabled-app": {"traefik.enable": "false"},
    "unlabelled-app": {}
  }
}
```

The caller must supply the complete service inventory and resolve all Traefik
label strings before invocation. The tool cannot verify that an omitted service
exists elsewhere. Service names and Docker object names use lower-case ASCII
letters/digits, underscores and hyphens, starting with a letter/digit. Label field
names are case insensitive; case-colliding label paths are rejected. Labels must
be string maps. Duplicate JSON keys, fractional JSON scalars, unknown Traefik
fields, mixed middleware types and cross-service duplicate router/middleware
definitions fail closed, even when duplicate definitions are equal.

Non-Traefik labels are explicitly outside scope. A missing `traefik.enable` excludes
the service as `unlabelled`; `false` records `disabled`. Excluded service names and
reasons appear in the source envelope's `excluded_services` map. They are inventory
annotations, not compared configuration. Unknown Traefik fields still fail on an
excluded service. An enabled service must declare a router with an explicit rule;
implicit/default routers are unsupported. Dollar/template expressions, control
characters, surrounding whitespace, ambiguous comma lists, noncanonical integers
and implicit defaults outside the documented normalizations are rejected.

The new tests cover canonical label shapes for `traefik-dashboard`,
`catchall-https`, `dashboard`, `minio-api` and `minio-console`, and middleware
definitions `dashboard-auth`, `dashboard-auth-ratelimit`, `dashboard-security`
and `dashboard-ratelimit`. Domains and credential material in tests are synthetic.

## Declared configuration semantics

Router fields are restricted to rule, entrypoints, service, priority, middleware
references, `tls=true` and `tls.certresolver`. Entry points are explicit nonempty
lists of distinct ASCII identifiers. Middleware order and duplicates are preserved.
Bare references become `@docker`; explicit middleware `@file` references and the
service `api@internal` remain unchanged. Other foreign service providers are not
supported. An omitted router service is inferred only when the same input service
has exactly one named HTTP service with the exact
`loadbalancer.server.port` label (integer1–65535). Zero or multiple candidates are
invalid. Backend URLs, health and port drift are outside the compared inventory;
the port label only establishes the narrow service-inference prerequisite.

TLS is represented by an object: `tls=true` produces `{}`, while a certresolver
subfield alone activates TLS and produces `{"certResolver":"..."}`. Resolver text
is preserved. Missing TLS stays absent; false, unknown TLS fields and contradictory
false/subfield inputs are rejected. This does not prove certificates exist, TLS
works, a resolver is configured, or ACME requests are safe or authorized.
Resolver-name preservation was checked without configuring resolvers or ACME;
the fixture's missing-resolver diagnostics do not establish functioning TLS.

Explicit priorities are positive canonical decimal integers at most2^63−1001.
Missing source priority and absent/zero rawdata priority normalize to integer0.
This preserves declared configuration, not effective routing precedence: the
[pinned Router struct](https://raw.githubusercontent.com/traefik/traefik/v2.11.41/pkg/config/dynamic/http_config.go)
omits zero priority in JSON, and the
[pinned muxer](https://raw.githubusercontent.com/traefik/traefik/v2.11.41/pkg/muxer/http/mux.go)
substitutes UTF-8 rule byte length internally without updating that field.
In the isolated fixture, four omitted rawdata priorities normalized to 0 and
the explicit catchall priority 1 was retained; effective muxer precedence
remains outside that proof.
The [provider builder](https://raw.githubusercontent.com/traefik/traefik/v2.11.41/pkg/provider/configuration.go)
supplies the unique-service inference basis; default templating remains unsupported.

Headers admit only `browserXssFilter`, `contentTypeNosniff`, `frameDeny`,
`stsIncludeSubdomains`, `stsPreload`, `stsSeconds` and `customResponseHeaders`.
Omitted boolean fields normalize to false, omitted seconds to0 and omitted custom
headers to an empty map. Source seconds must be a positive canonical int64;
observed/projected seconds permit0 for the omitted default. Header names preserve
spelling and must be ASCII alphanumerics/hyphens with an alphanumeric first
character. Case-colliding header names are rejected. Values remain literal strings:
`noindex,nofollow` is one value, never a list. Empty custom values are unsupported.

Rate limits reuse the accepted validator: explicit positive int64 average/burst,
positive whole-second durations and optional `sourceCriterion.requestHeaderName`.
Periods normalize to integer seconds. Fractional periods and other criteria are
unsupported. No throttling behavior is established by this normalization.

## BasicAuth and redaction

BasicAuth admits only an explicit nonempty realm and nonempty ordered user list.
Source lists are comma-separated without padding/escaping; observed lists are JSON
arrays. Username syntax is ASCII letters/digits/underscore/dot/hyphen. The narrow
credential grammar accepts `{SHA}` with27 Base64 characters plus `=`, bcrypt
`$2a$`/`$2b$`/`$2y$` with a two-digit cost and53 crypt characters, or `$apr1$` with
a1–8-character salt and22-character digest. This is syntax validation, not hash
verification or a credential-strength guarantee. Unknown options, `usersFile`,
empty/masked values and unresolved expressions are invalid. Valid crypt `$` syntax
is the sole exception to the general dollar-expression rejection.

Neither usernames nor password hash strings enter a projection. Instead,
`basicAuth` stores `realm`, `users_count` and `users_sha256`. The digest is SHA256 of
the ASCII domain `peermesh.docker-provider.basic-auth-users.v1`, one zero byte,
then the UTF-8 compact JSON serialization of the ordered raw list with
`ensure_ascii=false`. Order and duplicates therefore affect the digest.
The fixture preserved the synthetic BasicAuth ordered raw list and projected
only the accepted digest and count, without secret originals.

Resolved input and rawdata can contain credential material. Treat those originals
as sensitive; this tool neither redacts nor copies them. Comparison stdout carries
only fixed status/scope and opaque paths, and invalid input emits a fixed reason
code without parser exception text. Projection files retain router names/rules and
noncredential configuration. A digest does not confer access authority, authenticate
a live capture or make an untrusted response authentic. No live credential is used
by the included tests.

## Observed input and comparison

Supply the saved rawdata body and a separate exact HTTP receipt:

```json
{
  "schema": "peermesh.rawdata-receipt.v1",
  "method": "GET",
  "path": "/api/rawdata",
  "status": 200,
  "complete": true,
  "content_type": "application/json",
  "body_sha256": "<lowercase SHA256 of exact body bytes>",
  "body_bytes": 123
}
```

The byte count/hash must match, and duplicate keys, malformed JSON, unsupported
fields, incomplete/failed responses and unhealthy Docker routers/middleware are
invalid. HTTP provenance is caller supplied; this offline check proves consistency
of the receipt with the supplied body, not network origin. It checks that body bytes
remain unchanged across its local reads, not an atomic remote snapshot.

Only `@docker` HTTP routers/middleware are projected. File/internal provider objects
and HTTP services are explicit exclusions, but unknown provider names anywhere in
HTTP inventories are rejected. Nonempty TCP/UDP inventories fail closed. Both
projected collections must be nonempty. `dynamic_files` must be `{}` and is outside
Docker scope. File-provider results remain separate. The envelope schema is
`peermesh.docker-provider-projection.v1`, with exact scope, origin (`source` or
`observed`), `complete_within_scope`, exclusion map and collections. A malformed,
empty, broadened or noncanonical projection is rejected before opaque comparison.

From a checkout containing this candidate and its accepted dependencies:

```sh
python3 -B scripts/validation/project_docker_provider_snapshot.py source --input resolved.json --output expected.json
python3 -B scripts/validation/project_docker_provider_snapshot.py observed --body rawdata.json --receipt receipt.json --output observed.json
python3 -B scripts/validation/project_docker_provider_snapshot.py compare expected.json observed.json
python3 -B -m unittest discover -s tests/deployment_drift -p test_docker_provider_projection.py -v
```

Projection output paths must not already exist. Comparison returns0 for equivalent,
1 for drift and2 for invalid; projection returns0 on success and2 on invalid input
or output collision. CLI errors do not echo arguments. No file-provider tests need
to run for this isolated projector. The bounded fixture qualification above does
not establish general capture integration or production behavior.
