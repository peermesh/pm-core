---
gas_schema: gas.doc.v1
type: guide
title: Owned synthetic Docker provider capture
status: active
created: 2026-10-25T23:14:43Z
updated: 2026-10-26T00:33:06Z
project: peermesh-core
project_code: PMSYS
workstream: pm-platform-security
privacy_scope: project-readable
---

# Owned synthetic Docker provider capture

`scripts/validation/capture_docker_provider_snapshot.py` is the canonical bounded
consumer of the [Docker projection](DOCKER-PROVIDER-PROJECTION.md). It leaves the
file-provider capture contract unchanged. The unchanged consumer passed actual
equal (exit 0), stable remote-label drift (exit 1), and stopped-resource rejection
(exit 2) against pinned Traefik 2.11.41 and an explicitly owned synthetic Docker
API fixture. The independent expected projection preceded observations; private
proof, exports and exact resource cleanup were verified. This establishes the
admitted fixture's declared-configuration capture behavior only. Synthetic HTTP
bodies in offline tests remain declared test data, not runtime captures.

The drift control changed only the fixture's dashboard rate-limit average from
10 to 11 while the local expectation stayed at 10. The stopped control failed
the exact active-network-membership check before HTTP: stopped Traefik was absent
from active endpoints. Missing-resolver diagnostics were retained; no ACME,
certificate resolver, certificate validation or TLS enforcement was qualified.

Python 3.10 or newer and the existing PyYAML dependency are required. The CLI
accepts exactly three required arguments:

```text
python3 -B scripts/validation/capture_docker_provider_snapshot.py --input ABSOLUTE_RESOLVED_LABELS_JSON --fixture ABSOLUTE_FIXTURE_JSON --output ABSOLUTE_NEW_OUTPUT_DIRECTORY
```

The input is the strict `peermesh.docker-resolved-labels.v1` envelope described by
the projector, limited to 1 MiB. Local input, fixture, runner and pinned helper
bytes are bound before observation and checked afterward. Links, overlapping
helper storage and an existing output path are rejected. The consumer creates
its output exclusively; collision refusal preserves prior evidence.

## Admitted fixture

The fixture JSON contains exactly `schema`, `namespace`, `traefik_id`, `api_id`,
`client_id`, `network_id`, `api_script_sha256`, and `dynamic_fixture_sha256`.
The schema is `peermesh.owned-docker-fixture.v1`; the namespace is
`pm166-docker-capture-` followed by six decimal digits. All four IDs must be
distinct full 64-character lowercase hexadecimal values. Both hashes are full
SHA256 values describing caller-admitted test files. They do not authenticate
a deployment.

Only the fixed `gpu-server` SSH destination is supported, using the existing
batch-mode command owner. There is no host override, environment resolution,
Compose evaluation, Docker socket access, credential discovery or arbitrary
remote-command argument. The consumer reads resources; setup and cleanup belong
to a separately authorized fixture operation.

The internal bridge network must be named `NAMESPACE-internal`, labeled
`peermesh.fixture=NAMESPACE`, and contain exactly the three admitted containers.
The pinned Traefik image is
`sha256:7256cb4222acb3ecfcae35e1a7c83d6949ecb1a019d76684a48d074d0d1b8819`;
the API and client Node image is
`sha256:ae59e9992c6b3e963dd9dac9c476287048177ad8f90ac646669afb738705f56d`.
Each container must run unpaused with a read-only root, all capabilities dropped,
no added capabilities, no new privileges, one CPU, PID limit 128 and restart
policy `no`. Memory is 256 MiB for Traefik and 128 MiB for each Node container.
Host ports, privileged mode, host networking and extra mounts are rejected.
The Node containers run as UID/GID 65534 with their pinned image entrypoint.
Container environment must exactly match the retained image defaults: the fixed
system PATH, and for Node, `NODE_VERSION=22.23.4` and `YARN_VERSION=1.22.22`.
Provider overrides and Node startup options cannot be injected through environment
variables. The capture command does not read the caller's environment for input.

Traefik admits one read-only bind from `/tmp/NAMESPACE/dynamic` to `/dynamic`,
containing only regular `fixture.yaml`. The API admits one read-only bind from
`/tmp/NAMESPACE/api` to `/fixture`, containing only regular `docker-api.js` and
`state.json`, and runs `node /fixture/docker-api.js`. The client is unmounted and
runs `node -e 'setInterval(() => {}, 1000)'`. The API has network alias
`fixture-api`. Each runtime file is bounded to 1 MiB.

Traefik admits exactly the following flags, in any order:

```text
--api=true --api.dashboard=false --api.insecure=false
--providers.docker=true --providers.docker.endpoint=tcp://fixture-api:2375
--providers.docker.exposedbydefault=false --providers.docker.swarmmode=false
--providers.docker.watch=false --providers.docker.httpclienttimeout=3s
--providers.file.directory=/dynamic --providers.file.watch=false
--entrypoints.web.address=:8080 --entrypoints.websecure.address=:8443
--global.checknewversion=false --global.sendanonymoususage=false --log.level=DEBUG
```

No certificate resolver or ACME configuration is admitted. The synthetic dynamic
file makes the rawdata route available within the fixture; it is pinned, not
included as Docker configuration in the comparison.

## Observation and outcome

The expected projection is generated from the local input before the first
runtime callback. Full inspected identities and runtime file hashes bracket two
HTTP observations. The client requests `GET /api/rawdata` at the inspected private
Traefik IPv4 address, port 8080, with Host `api.fixture.invalid` and a three-second
request timeout. Existing command limits bound the overall operation.

Both HTTP responses must be complete JSON with status 200, matching receipt hashes
and lengths, and identical body bytes. The strict projector checks supported,
healthy Docker router and middleware declarations. API code and dynamic file
hashes must match the fixture. The API's explicit resolved-label state may differ
from the independent local expectation, but must remain valid and stable across
the bracket. Changing input, helper, fixture metadata, resource identity, runtime
files or API body invalidates the observation.

| Exit | Status | Meaning |
| --- | --- | --- |
| 0 | `equal` | Stable admitted observation equals the declared projection. |
| 1 | `drift` | Stable admitted observation differs at opaque configuration paths. |
| 2 | `invalid_unavailable` | Input, boundary, transport, stability or projection failed. |

Stdout and `outcome.json` contain fixed reason codes, scope and validated opaque
changed paths. Raw labels, BasicAuth values, names, source paths, identities,
command outputs, HTTP headers/bodies and exception details stay in private proof:
directories mode 0700 and files mode 0600. Even projections can contain sensitive
configuration; keep the whole output private. Do not publish its raw files.

A stable bracket is neither an atomic snapshot nor authenticated deployment
capture. The fixed `runtime_parity: unqualified` projector annotation is retained; it is
not a runtime attestation. The actual qualification above covers only this strict
owned synthetic fixture. Service/backend health, certificate availability,
TLS/authentication enforcement, real Docker inventory admission, arbitrary
inventory completeness, wider integration and production release acceptance
remain outside the proof.
