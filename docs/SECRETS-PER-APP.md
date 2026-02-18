# Secrets Per App

This document defines required secret keys per example app and how they are consumed.

## Source of Truth

- Per-app checklist: `examples/<app>/secrets-required.txt`
- Encrypted bundle keys: `secrets/*.enc.yaml`
- Runtime secret files: `secrets/<key>` (local/non-committed)

## Required Keys by App

| App | Required Secret Keys |
|-----|----------------------|
| Ghost | `ghost_db_password`, `ghost_mail_password`, `mysql_root_password` |
| LibreChat | `librechat_db_password`, `librechat_creds_key`, `librechat_creds_iv`, `librechat_jwt_secret`, `postgres_password`, `mongodb_root_password` |
| Matrix | `synapse_db_password`, `synapse_signing_key`, `synapse_registration_shared_secret`, `postgres_password` |
| PeerTube | `peertube_db_password`, `peertube_secret`, `postgres_password` |
| Listmonk | `listmonk_db_password`, `postgres_password` |
| rss2bsky | Managed via encrypted env vars (no Docker secret file currently) |
| Solid | No Docker secret files required for default file-based config |
| Landing | No Docker secret files required |

## `_FILE` Support Notes

- Ghost: uses `database__connection__password__file`, `mail__options__auth__pass__file`
- Listmonk: uses `LISTMONK_db__password_file`
- LibreChat: uses `_FILE` variants for Postgres and crypto key material where supported
- PeerTube: uses wrapper entrypoint (`examples/peertube/pmdl-peertube-entrypoint.sh`) to load values from Docker secret files because native `_FILE` variants are not available for all required variables

## Validation

From repository root:

```bash
just validate ghost production
just validate matrix production
just validate peertube production
```

This checks that required keys exist in `secrets/<env>.enc.yaml`.
