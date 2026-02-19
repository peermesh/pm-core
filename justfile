set shell := ["bash", "-euo", "pipefail", "-c"]

help:
    @echo "Usage:"
    @echo "  just validate <app> <environment>"
    @echo "  just validate-secrets <environment>"
    @echo "  just validate-adapter-boundary"
    @echo "  just validate-observability-profile"
    @echo "  just validate-image-policy"
    @echo "  just generate-sbom [output_dir]"
    @echo "  just validate-supply-chain [severity]"
    @echo "  just validate-scalability-wave1"
    @echo "  just rotate-drill <key> <environment>"
    @echo "  just tofu-version"
    @echo "  just tofu-preflight"
    @echo "  just tofu-state-backup [suffix]"
    @echo ""
    @echo "Examples:"
    @echo "  just validate ghost production"
    @echo "  just validate matrix staging"
    @echo "  just validate-secrets production"
    @echo "  just validate-adapter-boundary"
    @echo "  just validate-observability-profile"
    @echo "  just validate-image-policy"
    @echo "  just generate-sbom /tmp/pmdl-sbom"
    @echo "  just validate-supply-chain HIGH"
    @echo "  just validate-scalability-wave1"
    @echo "  just rotate-drill postgres_password staging"
    @echo "  just tofu-version"
    @echo "  just tofu-preflight"
    @echo "  just tofu-state-backup preflight"

validate app env="production":
    ./scripts/validate-app-secrets.sh {{app}} {{env}}

validate-secrets env="production":
    ./scripts/validate-secret-parity.sh --environment {{env}}

rotate-drill key env="staging":
    ./scripts/secrets-rotation-recovery-drill.sh --environment {{env}} --key {{key}}

validate-adapter-boundary:
    ./scripts/validate-federation-adapter-boundary.sh

validate-observability-profile:
    ./scripts/validate-observability-profile.sh

validate-image-policy:
    ./scripts/security/validate-image-policy.sh

generate-sbom output_dir="":
    if [[ -n "{{output_dir}}" ]]; then \
        ./scripts/security/generate-sbom.sh --output-dir "{{output_dir}}"; \
    else \
        ./scripts/security/generate-sbom.sh; \
    fi

validate-supply-chain severity="CRITICAL":
    ./scripts/security/validate-supply-chain.sh --severity-threshold {{severity}}

validate-scalability-wave1:
    ./scripts/scalability/run-wave1-validation.sh

tofu-version:
    ./infra/opentofu/scripts/tofu.sh version

tofu-preflight:
    ./infra/opentofu/scripts/pilot-preflight.sh

tofu-state-backup suffix="manual":
    ./infra/opentofu/scripts/state-backup.sh --suffix {{suffix}} --allow-empty
