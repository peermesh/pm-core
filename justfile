set shell := ["bash", "-euo", "pipefail", "-c"]

help:
    @echo "Usage:"
    @echo "  just validate <app> <environment>"
    @echo "  just validate-secrets <environment>"
    @echo "  just validate-adapter-boundary"
    @echo "  just rotate-drill <key> <environment>"
    @echo ""
    @echo "Examples:"
    @echo "  just validate ghost production"
    @echo "  just validate matrix staging"
    @echo "  just validate-secrets production"
    @echo "  just validate-adapter-boundary"
    @echo "  just rotate-drill postgres_password staging"

validate app env="production":
    ./scripts/validate-app-secrets.sh {{app}} {{env}}

validate-secrets env="production":
    ./scripts/validate-secret-parity.sh --environment {{env}}

rotate-drill key env="staging":
    ./scripts/secrets-rotation-recovery-drill.sh --environment {{env}} --key {{key}}

validate-adapter-boundary:
    ./scripts/validate-federation-adapter-boundary.sh
