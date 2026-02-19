# OpenTofu Infrastructure Scaffold (Pilot)

This directory is the OpenTofu pilot scaffold for Docker Lab.

Boundary rules:

1. OpenTofu provisions infrastructure prerequisites only.
2. Docker Compose + webhook pull-deploy remain runtime source of truth.
3. Multi-VPS extension is explicitly deferred until single-VPS validation is complete.

Authoritative planning/policy document:

- `/Users/grig/work/peermesh/repo/knowledge-graph-lab-alpha/.dev/modules/peer-mesh-docker-lab/.dev/ai/research/opentofu-integration/OPENTOFU-PILOT-SCAFFOLD-AND-STATE-POLICY.md`

Current scaffold:

```text
infra/opentofu/
  README.md
  .gitignore
  backend/
    README.md
  env/
    README.md
  modules/
    README.md
  stacks/
    pilot-single-vps/
      README.md
  state-backups/
    README.md
```

Operational contract:

1. Never commit state payloads or credentials.
2. Mandatory state backup before any `tofu apply` or `tofu destroy`.
3. Keep naming consistent with `pilot-single-vps` environment key.
