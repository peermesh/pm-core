# Social stub surface — runtime metadata contract

**Status**: normative for listed route modules  
**Version**: 1  
**Related**: WO-PMDL-2026-03-31-223

## Purpose

Protocol stub and thin-adapter HTTP handlers under the Social module must expose a **machine-checkable** signal so clients and operators can distinguish stub-tier surfaces from fully integrated protocol paths without relying on documentation alone.

## Required HTTP header

Every **200** JSON response from a handler listed in `scripts/validation/contracts/social-stub-surface-metadata.contract.json` **must** include:

- **Name**: `X-Peermesh-Social-Stub-Surface`
- **Value**: `1` (opaque version token for this contract)

Implementation: use `jsonStubSurface` / `jsonWithTypeStubSurface` from `modules/social/app/lib/helpers.js`, which set this header together with `Content-Type` and `Content-Length`.

Foreign-shaped JSON (for example Matrix `/.well-known` delegation documents) **must not** add non-spec body fields; the header alone satisfies this contract for those responses.

## Body signals (PeerMesh-owned JSON)

Where the response body is PeerMesh-defined (not a strict third-party schema), handlers **should** keep existing body markers for backward compatibility:

- `_stub: true` for structural stubs (Hypercore, Braid, Zot, DSNP graph, and similar), and/or
- `provider.status: 'stub'` (or equivalent documented nested `status: 'stub'`) where the payload already uses that pattern.

Thin adapters (Lens/Farcaster mapping, Matrix/XMTP identity bridges) may omit `_stub: true` when it would misrepresent provisioned state; the **header** remains mandatory for the listed routes.

## Non-goals

- Changing error responses (4xx/5xx) — they continue to use `json()` without the stub header.
- Requiring clients to send any new request header.

## Enforcement

- CI: `scripts/validation/run-social-stub-surface-metadata-gate.sh`
- Static checks: `scripts/validation/validate_social_stub_surface_metadata.py`
