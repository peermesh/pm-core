---
gas_schema: gas.doc.v1
type: guide
title: One-shot owned-fixture file-provider capture
status: draft
created: 2026-10-24T19:12:38Z
updated: 2026-10-24T22:07:24Z
project: peermesh-core
project_code: PMSYS
project_root: /Users/grig/work/peermesh/repo/peermesh-core/sub-repos/core
workstream: pm-platform-security
created_by: dev-worker
requested_by: owner-authorized Core166 C4 continuation
privacy_scope: project-readable
source_work_order: /Users/grig/work/peermesh/repo/peermesh-system/.dev/ai/workorders/WO-PMSYS-2026-07-14-166-core-comp-c-canonicalization-and-docker-lab-tracking.md
---

# One-shot owned-fixture file-provider capture

`scripts/validation/capture_file_provider_snapshot.py` observes one explicitly
owned, isolated Core166 GPU fixture and invokes the adopted source, observed and
compare commands from [the projection guide](FILE-PROVIDER-PROJECTION.md).
It creates one new output directory and exits. It neither creates nor reloads
nor stops a container. The separate fixture harness owns those operations.

The supported scope is Traefik 2.11.41 HTTP file-provider routers, headers,
rateLimit, ordered chain, forwardAuth, buffering and ipAllowList middleware,
and exact dynamic-file bytes. The
[projection guide](FILE-PROVIDER-PROJECTION.md) defines the restricted grammar:
explicit positive integer rate parameters, positive whole-second h/m/s periods,
absent default-address or one actor-header criterion, and ordered file-provider
chain references, restricted literal forward-auth URLs/explicit trust/header
lists, positive integer request-buffer limits and strict canonical IPv4/IPv6
CIDR lists. Periods normalize to integer seconds; bare references normalize
to `@file`; only observed omitted forward-auth trust normalizes to false.
Source and projected trust must remain explicit. Lists retain order, case and
duplicates. Unknown/mixed types, unsupported fields, ambiguous values and
foreign providers fail closed. Earlier headers-only and headers/rateLimit/chain
projection scopes cannot be compared with this scope.

Services, static configuration, TLS, TCP/UDP, other middleware/provider types and
full deployment completeness remain outside this contract. This is not a
production collector, notification system, scheduler or atomic/authenticated
live snapshot mechanism. Configuration equivalence does not establish rate
enforcement, authenticated actor headers, trusted client addresses, or chain
reachability/cycle correctness.

## Inputs and ownership

Use Python 3.10 or later with the existing PyYAML dependency used by the projection.
The adjacent adopted projection/comparator files must match their pinned SHA-256
values in the runner. Their CLI behavior is reused; there is no new comparator.
Neither local Node/Docker nor installation of a dependency is required.

Supply absolute, symlink-free local paths for an independent source directory,
its complete file inventory, a fixture manifest and a **new** output directory.
The output parent must already exist. Source/output overlap, unsafe parents,
existing outputs (including dangling links), unsupported source inventories and
changed helper files are invalid. No existing output is removed, reused or replaced.

The source format and full inventory requirements are those of the projection
guide. The runner adds limits of 32 files and 1 MiB per file/body. It records source
file hashes, inventory bytes, fixture-manifest bytes and helper/runner hashes,
then runs the source CLI before any runtime observation by the runner. The same
bindings are checked at completion, including failed captures. A change prevents
an equal/drift success outcome. Expected is never derived from the runtime body.

The fixture manifest has exactly these fields (placeholders are not usable IDs):

```json
{
  "schema": "peermesh.owned-file-fixture.v1",
  "namespace": "pm166-drift-capture-190710",
  "traefik_id": "<64 lowercase hex characters>",
  "client_id": "<64 lowercase hex characters>",
  "network_id": "<64 lowercase hex characters>"
}
```

Namespaces must have form `pm166-drift-capture-NNNNNN`. The transport is fixed to
`ssh -o BatchMode=yes -o ConnectTimeout=10 gpu-server`, using a safely quoted
single remote Docker argv. There is no URL, hostname, image, shell-command or
API-path override. IDs must be exact, distinct container/network IDs.

Both containers and their one internal network must carry
`peermesh.fixture=<namespace>`. The network must be named `<namespace>-internal`
and contain exactly the supplied Traefik and Node client IDs. Both containers must
be running, unprivileged, use read-only roots, drop all capabilities, enable
no-new-privileges, publish no ports and attach only to that network.

Images are fixed to the admitted Traefik image
`sha256:7256cb4222acb3ecfcae35e1a7c83d6949ecb1a019d76684a48d074d0d1b8819`
and Node client image
`sha256:ae59e9992c6b3e963dd9dac9c476287048177ad8f90ac646669afb738705f56d`.
Traefik must have exactly one read-only bind,
`/tmp/<namespace>/dynamic` to `/dynamic`; the client must have no mounts.
No Docker socket or arbitrary host bind is admitted.

Traefik's entrypoint must be `traefik` with exactly the runner's declared flags:
file directory `/dynamic`, file watch enabled, web `:8080`, API enabled, insecure
API/dashboard/update checks/usage reporting disabled, and debug logging. No other
provider, resolver or command is accepted. The client must run only the admitted
idle Node command. The private runtime address is obtained from validated Docker
inspection, never supplied as an arbitrary URL. These checks enforce the declared
fixture boundary; labels/manifests are not cryptographic proof of ownership.

## Observation bracket

The transport reuses the accepted Node HTTP request to `/api/rawdata` through the
owned client, with a three-second HTTP timeout. It records the complete flag,
status, content type, byte count and SHA-256 alongside the actual body and headers.
Failed, incomplete, malformed or truncated responses cannot become equal.

Around the observation it performs:

1. Exact container/network identity and isolation checks.
2. Actual `/dynamic` file inventory and byte reads inside Traefik, then an API read.
3. A second complete file read and API read.
4. The same container/network identity and isolation checks.

Symlinks, nonregular entries, unsafe/missing paths, unsupported extensions and
empty/oversized inventories are invalid. Exact file hashes and API body hashes
must agree across the bracket; identities include start time, PID, restart count,
network and mount bindings. A detected change yields invalid/unavailable.

**A stable bracket is not atomic.** A transient change followed by reversion
between reads may escape detection. No authenticity or completeness beyond the
explicit owned fixture and admitted scope is established. Use the raw records
to assess this limit; do not label the output an atomic deployment snapshot.

After a stable bracket, the existing observed CLI consumes the captured body,
receipt and runtime-file directory. The existing compare CLI compares it with
the independently projected expected. The runner retains exact CLI argv, exits,
stdout and stderr in protected raw evidence.

## Invocation and outcomes

```sh
python3 -B scripts/validation/capture_file_provider_snapshot.py \
  --source /absolute/independent-source \
  --inventory /absolute/source-inventory.json \
  --fixture /absolute/owned-fixture.json \
  --output /absolute/new-capture-directory
```

The output directory is created exclusively with mode0700. It contains expected
and observed projections, raw input/identity/API/file/command records and the
small `outcome.json`. These raw files contain configuration, addresses and IDs;
protect the directory accordingly. Nothing is sent as an alert or notification.

Stdout and `outcome.json` contain only a versioned schema, `equal`, `drift` or
`invalid_unavailable` status, fixed reason code, supported scope, exit code,
opaque change paths and the non-atomic observation limit. Raw rules, header
values, addresses, arbitrary stderr and filesystem paths are excluded from the
outcome. Comparison output is checked before forwarding its opaque paths.

- Exit0: equal within the supported scope and stable bracket.
- Exit1: drift within that scope, with opaque changed paths.
- Exit2: invalid/unavailable input, transport, capture, projection or output.

Each subprocess is bounded by 20 seconds and the command sequence by 90 seconds;
SSH connection and HTTP timeouts also apply. There is no polling in the runner.
An input/output failure still emits a redacted exit2 outcome on stdout when a
new outcome file cannot safely be created. An existing output stays byte-identical.
A failed new capture retains its available evidence and invalid outcome; it
cannot erase or pass a previous successful observation.

The caller owns source/output permissions, fixture setup, a bounded readiness
or reload check, output retention and exact resource cleanup. Never use a prior
successful result as the result of a failed invocation.

## Focused checks and proof boundary

Run the affected capture checks:

```sh
python3 -B -m unittest discover -s tests/deployment_drift \
  -p test_file_provider_capture.py -v
```

The 21 capture methods retain the existing header/rate/chain and isolation
boundaries. New security checks cover actual-contract false omission and explicit
false, strict observed refusals, missing source trust before transport, opaque
drift and preservation of earlier outputs after failure. The 29 affected
projection methods cover source/observed/projected grammar, every supported
new field's drift, strict malformed-input refusals and existing behavior.
Both suites bind source hashes before/after their invocation and retain raw
outputs. The unchanged comparator suite is not replayed.

The integrated proof used one fresh internal network and two retained-image
containers. Independent source bytes and their expected projection were bound
before fixture allocation or any runtime observation. Four source files included
unchanged canonical authentik, security and Events configuration plus synthetic
definitions. The queried API router had higher priority than the canonical
catchall and attached only fixture headers. No request invoked forwardAuth,
Authentik, the catchall or an Events policy.

The runner returned equal/0 for the baseline, drift/1 after the harness actually
reloaded only synthetic forward-auth address/trust/response headers, request
buffer limits and the CIDR list, then invalid/unavailable/2 after the client
stopped. All six intended field changes were independently checked in the actual
rawdata. Baseline false trust was omitted in rawdata; changing true to false also
produced omission. Buffer integers and header/CIDR list order and duplicates
remained literal. The header/rate/chain definitions, canonical inputs and
independent expected remained unchanged. Both successful brackets had matching
before/after identity, file and API bindings. All 52 earlier baseline/drift output
files remained unchanged after the failed capture, which created no observed
projection. No production enforcement is established by this configuration proof.

This proves the declared synthetic fixture boundary only, with the non-atomic
limit above. Source adoption requires independent parent acceptance and a
separate guarded write interval. Real deployment capture, broader configuration,
scheduling and alert delivery remain outside this qualification. The older
header-reload proof remains separate evidence; its initial test-source
reconstruction limitation is not rewritten by this new qualification.
