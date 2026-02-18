set shell := ["bash", "-euo", "pipefail", "-c"]

help:
    @echo "Usage:"
    @echo "  just validate <app> <environment>"
    @echo ""
    @echo "Examples:"
    @echo "  just validate ghost production"
    @echo "  just validate matrix staging"

validate app env="production":
    ./scripts/validate-app-secrets.sh {{app}} {{env}}
