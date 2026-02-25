set shell := ["bash", "-euo", "pipefail", "-c"]

help:
    @echo "Usage:"
    @echo "  just validate <app> <environment>"
    @echo "  just validate-secrets <environment>"
    @echo "  just validate-adapter-boundary"
    @echo "  just validate-observability-profile"
    @echo "  just validate-image-policy"
    @echo "  just module-plan <module>"
    @echo "  just module-enable <module>"
    @echo "  just generate-sbom [output_dir]"
    @echo "  just validate-supply-chain [severity]"
    @echo "  just validate-scalability-wave1"
    @echo "  just capture-wave2-metrics <ssh_host> [output_dir]"
    @echo "  just validate-scalability-wave2 <ssh_host> [output_dir]"
    @echo "  just observability-scorecard <wave1_summary> [wave1_summary_prev] [wave2_summary] [incident_count] [output_dir]"
    @echo "  just check-links [format]"
    @echo "  just test [suite]"
    @echo "  just test-unit"
    @echo "  just test-integration"
    @echo "  just test-smoke"
    @echo "  just test-e2e"
    @echo "  just script-tests"
    @echo "  just smoke-example-app <app> <base_url>"
    @echo "  just deploy-log [file] [tail_lines] [log_dir]"
    @echo "  just rotate-drill <key> <environment>"
    @echo "  just tofu-version"
    @echo "  just tofu-preflight"
    @echo "  just tofu-credentials-status [var_file] [env_file]"
    @echo "  just tofu-credentials-setup [var_file] [env_file]"
    @echo "  just tofu-credentials-path [env_file]"
    @echo "  just tofu-state-backup [suffix]"
    @echo "  just tofu-apply-readiness [var_file] [backend_config] [summary_file] [env_file]"
    @echo "  just tofu-apply-readiness-prompt [var_file] [backend_config] [summary_file] [env_file]"
    @echo "  just tofu-apply-readiness-dryrun [summary_file]"
    @echo ""
    @echo "Examples:"
    @echo "  just validate ghost production"
    @echo "  just validate matrix staging"
    @echo "  just validate-secrets production"
    @echo "  just validate-adapter-boundary"
    @echo "  just validate-observability-profile"
    @echo "  just validate-image-policy"
    @echo "  just module-plan test-module"
    @echo "  just module-enable test-module"
    @echo "  just generate-sbom /tmp/pmdl-sbom"
    @echo "  just validate-supply-chain HIGH"
    @echo "  just validate-scalability-wave1"
    @echo "  just capture-wave2-metrics root@37.27.208.228 /tmp/pmdl-wo033"
    @echo "  just validate-scalability-wave2 root@37.27.208.228 /tmp/pmdl-wo033"
    @echo "  just observability-scorecard /path/to/wave1-summary.env"
    @echo "  just observability-scorecard /path/to/wave1-summary.env /path/to/prev-summary.env /path/to/wave2-summary.env 2"
    @echo "  just test"
    @echo "  just test-unit"
    @echo "  just test-integration"
    @echo "  just test-smoke"
    @echo "  just test-e2e"
    @echo "  just script-tests"
    @echo "  just smoke-example-app ghost https://ghost.example.com"
    @echo "  just deploy-log"
    @echo "  just deploy-log deploy-20260222-000000.log 80 /tmp/deploy-logs"
    @echo "  just rotate-drill postgres_password staging"
    @echo "  just tofu-version"
    @echo "  just tofu-preflight"
    @echo "  just tofu-credentials-status"
    @echo "  just tofu-credentials-setup"
    @echo "  just tofu-credentials-path"
    @echo "  just tofu-state-backup preflight"
    @echo "  just tofu-credentials-setup /path/to/pilot.auto.tfvars"
    @echo "  OPENTOFU_PILOT_APPLY_APPROVED=true OPENTOFU_PILOT_CHANGE_REF=WO-123 just tofu-apply-readiness /path/to/pilot.auto.tfvars /path/to/backend.hcl /tmp/opentofu-readiness.env"
    @echo "  OPENTOFU_PILOT_APPLY_APPROVED=true OPENTOFU_PILOT_CHANGE_REF=WO-123 just tofu-apply-readiness-prompt /path/to/pilot.auto.tfvars /path/to/backend.hcl /tmp/opentofu-readiness.env"
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

module-plan module:
    ./launch_peermesh.sh module enable {{module}} --dry-run

module-enable module:
    ./launch_peermesh.sh module enable {{module}}

check-links format="text":
    if [[ "{{format}}" == "json" ]]; then \
        python3 ./scripts/check-links.py --json; \
    else \
        python3 ./scripts/check-links.py; \
    fi

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

observability-scorecard wave1_summary wave1_summary_prev="" wave2_summary="" incident_count="" output_dir="":
    args=(--wave1-summary "{{wave1_summary}}"); \
    if [[ -n "{{wave1_summary_prev}}" ]]; then args+=(--wave1-summary-prev "{{wave1_summary_prev}}"); fi; \
    if [[ -n "{{wave2_summary}}" ]]; then args+=(--wave2-summary "{{wave2_summary}}"); fi; \
    if [[ -n "{{incident_count}}" ]]; then args+=(--incident-count "{{incident_count}}"); fi; \
    if [[ -n "{{output_dir}}" ]]; then args+=(--output-dir "{{output_dir}}"); fi; \
    ./scripts/observability/run-observability-scorecard.sh "$${args[@]}"

tofu-version:
    ./infra/opentofu/scripts/tofu.sh version

tofu-preflight:
    ./infra/opentofu/scripts/pilot-preflight.sh

tofu-credentials-status var_file="" env_file="":
    args=(); \
    if [[ -n "{{var_file}}" ]]; then args+=(--var-file "{{var_file}}"); fi; \
    if [[ -n "{{env_file}}" ]]; then args+=(--env-file "{{env_file}}"); fi; \
    ./infra/opentofu/scripts/pilot-credentials.sh "$${args[@]}" status

tofu-credentials-setup var_file="" env_file="":
    args=(); \
    if [[ -n "{{var_file}}" ]]; then args+=(--var-file "{{var_file}}"); fi; \
    if [[ -n "{{env_file}}" ]]; then args+=(--env-file "{{env_file}}"); fi; \
    ./infra/opentofu/scripts/pilot-credentials.sh "$${args[@]}" setup

tofu-credentials-path env_file="":
    args=(); \
    if [[ -n "{{env_file}}" ]]; then args+=(--env-file "{{env_file}}"); fi; \
    ./infra/opentofu/scripts/pilot-credentials.sh "$${args[@]}" path

tofu-state-backup suffix="manual":
    ./infra/opentofu/scripts/state-backup.sh --suffix {{suffix}} --allow-empty

tofu-apply-readiness var_file="" backend_config="" summary_file="" env_file="":
    args=(); \
    if [[ -n "{{var_file}}" ]]; then args+=(--var-file "{{var_file}}"); fi; \
    if [[ -n "{{backend_config}}" ]]; then args+=(--backend-config "{{backend_config}}"); fi; \
    if [[ -n "{{summary_file}}" ]]; then args+=(--summary-file "{{summary_file}}"); fi; \
    if [[ -n "{{env_file}}" ]]; then args+=(--env-file "{{env_file}}"); fi; \
    ./infra/opentofu/scripts/pilot-apply-readiness.sh "$${args[@]}"

tofu-apply-readiness-prompt var_file="" backend_config="" summary_file="" env_file="":
    args=(--prompt-missing-env --persist-prompted-env); \
    if [[ -n "{{var_file}}" ]]; then args+=(--var-file "{{var_file}}"); fi; \
    if [[ -n "{{backend_config}}" ]]; then args+=(--backend-config "{{backend_config}}"); fi; \
    if [[ -n "{{summary_file}}" ]]; then args+=(--summary-file "{{summary_file}}"); fi; \
    if [[ -n "{{env_file}}" ]]; then args+=(--env-file "{{env_file}}"); fi; \
    ./infra/opentofu/scripts/pilot-apply-readiness.sh "$${args[@]}"

tofu-apply-readiness-dryrun summary_file="/tmp/pmdl-opentofu-readiness-dryrun.env":
    OPENTOFU_PILOT_APPLY_APPROVED=true \
    OPENTOFU_PILOT_CHANGE_REF=dryrun \
    OPENTOFU_REQUIRED_ENV=DRYRUN_PROVIDER_TOKEN \
    DRYRUN_PROVIDER_TOKEN=dryrun-token \
    ./infra/opentofu/scripts/pilot-apply-readiness.sh \
        --allow-example-inputs \
        --summary-file "{{summary_file}}"

dashboard-test:
    make dashboard-test

script-tests:
    ./scripts/testing/run-script-tests.sh

# Test commands (bats-core based testing framework)
test suite="all":
    ./tests/run-tests.sh {{suite}}

test-unit:
    ./tests/run-tests.sh unit

test-integration:
    ./tests/run-tests.sh integration

test-smoke:
    ./tests/run-tests.sh smoke

test-e2e:
    ./tests/run-tests.sh e2e

smoke-http url expected_status="200" contains="":
    if [[ -n "{{contains}}" ]]; then \
        ./scripts/testing/smoke-http.sh --url "{{url}}" --expect-status "{{expected_status}}" --contains "{{contains}}"; \
    else \
        ./scripts/testing/smoke-http.sh --url "{{url}}" --expect-status "{{expected_status}}"; \
    fi

smoke-example-app app base_url:
    ./scripts/testing/smoke-example-app.sh --app "{{app}}" --base-url "{{base_url}}"

deploy-log file="" tail_lines="200" log_dir="/tmp/deploy-logs":
    if [[ -n "{{file}}" ]]; then \
        ./scripts/view-deploy-log.sh --log-dir "{{log_dir}}" --tail "{{tail_lines}}" --file "{{file}}"; \
    else \
        ./scripts/view-deploy-log.sh --log-dir "{{log_dir}}" --tail "{{tail_lines}}"; \
    fi
