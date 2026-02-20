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
    @echo "  just capture-wave2-metrics <ssh_host> [output_dir]"
    @echo "  just validate-scalability-wave2 <ssh_host> [output_dir]"
    @echo "  just rotate-drill <key> <environment>"
    @echo "  just tofu-version"
    @echo "  just tofu-preflight"
    @echo "  just tofu-state-backup [suffix]"
    @echo "  just tofu-apply-readiness [var_file] [backend_config] [summary_file]"
    @echo "  just tofu-apply-readiness-dryrun [summary_file]"
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
    @echo "  just capture-wave2-metrics root@37.27.208.228 /tmp/pmdl-wo033"
    @echo "  just validate-scalability-wave2 root@37.27.208.228 /tmp/pmdl-wo033"
    @echo "  just rotate-drill postgres_password staging"
    @echo "  just tofu-version"
    @echo "  just tofu-preflight"
    @echo "  just tofu-state-backup preflight"
    @echo "  OPENTOFU_PILOT_APPLY_APPROVED=true OPENTOFU_PILOT_CHANGE_REF=WO-123 just tofu-apply-readiness /path/to/pilot.auto.tfvars /path/to/backend.hcl /tmp/opentofu-readiness.env"
    @echo "  just tofu-apply-readiness-dryrun /tmp/opentofu-readiness-dryrun.env"

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

capture-wave2-metrics ssh_host output_dir="":
    if [[ -n "{{output_dir}}" ]]; then \
        ./scripts/scalability/capture-wave2-metrics.sh --ssh-host {{ssh_host}} --output-dir "{{output_dir}}"; \
    else \
        ./scripts/scalability/capture-wave2-metrics.sh --ssh-host {{ssh_host}}; \
    fi

validate-scalability-wave2 ssh_host output_dir="":
    if [[ -n "{{output_dir}}" ]]; then \
        ./scripts/scalability/capture-wave2-metrics.sh --ssh-host {{ssh_host}} --output-dir "{{output_dir}}"; \
        ./scripts/scalability/run-wave1-validation.sh --metrics-summary-file "{{output_dir}}/aggregated/wave2-metrics-summary.env"; \
    else \
        echo "output_dir is required for validate-scalability-wave2"; \
        exit 1; \
    fi

tofu-version:
    ./infra/opentofu/scripts/tofu.sh version

tofu-preflight:
    ./infra/opentofu/scripts/pilot-preflight.sh

tofu-state-backup suffix="manual":
    ./infra/opentofu/scripts/state-backup.sh --suffix {{suffix}} --allow-empty

tofu-apply-readiness var_file="" backend_config="" summary_file="":
    args=(); \
    if [[ -n "{{var_file}}" ]]; then args+=(--var-file "{{var_file}}"); fi; \
    if [[ -n "{{backend_config}}" ]]; then args+=(--backend-config "{{backend_config}}"); fi; \
    if [[ -n "{{summary_file}}" ]]; then args+=(--summary-file "{{summary_file}}"); fi; \
    ./infra/opentofu/scripts/pilot-apply-readiness.sh "$${args[@]}"

tofu-apply-readiness-dryrun summary_file="/tmp/pmdl-opentofu-readiness-dryrun.env":
    OPENTOFU_PILOT_APPLY_APPROVED=true \
    OPENTOFU_PILOT_CHANGE_REF=dryrun \
    OPENTOFU_REQUIRED_ENV=DRYRUN_PROVIDER_TOKEN \
    DRYRUN_PROVIDER_TOKEN=dryrun-token \
    ./infra/opentofu/scripts/pilot-apply-readiness.sh \
        --allow-example-inputs \
        --summary-file "{{summary_file}}"
