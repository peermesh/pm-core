#!/usr/bin/env bash
# ==============================================================
# PeerMesh Core - Comprehensive Security Audit
# ==============================================================
# Single entry point for all scriptable security tests.
# Safe to run against production (read-only, no mutations).
#
# Usage:
#   ./scripts/security/run-full-audit.sh --local
#   ./scripts/security/run-full-audit.sh --remote root@46.225.188.213
#   ./scripts/security/run-full-audit.sh --local --output report.md
#
# Exit codes:
#   0 - No CRITICAL or HIGH findings
#   1 - CRITICAL or HIGH findings detected
# ==============================================================
set -euo pipefail

# --------------------------------------------------------------
# Constants and Colors
# --------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
readonly REPO_ROOT

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# Disable color if not a terminal or if NO_COLOR is set
if [[ ! -t 1 ]] || [[ -n "${NO_COLOR:-}" ]]; then
    RED='' GREEN='' YELLOW='' CYAN='' BOLD='' RESET=''
fi

# --------------------------------------------------------------
# Counters
# --------------------------------------------------------------
CRITICAL_COUNT=0
HIGH_COUNT=0
MEDIUM_COUNT=0
LOW_COUNT=0
SKIP_COUNT=0
PASS_COUNT=0

# --------------------------------------------------------------
# Mode and Options
# --------------------------------------------------------------
MODE=""
REMOTE_HOST=""
OUTPUT_FILE=""
TARGET_URL=""

# Accumulated report lines for --output
REPORT_LINES=()

# --------------------------------------------------------------
# Helper Functions
# --------------------------------------------------------------
usage() {
    cat <<'USAGE'
Usage: run-full-audit.sh [OPTIONS]

Options:
  --local               Run codebase-only checks (no VPS)
  --remote HOST         Run all checks including remote VPS scans via SSH
  --target URL          Override endpoint target (default: http://localhost:8080)
  --output FILE         Write markdown report to FILE
  -h, --help            Show this help

Examples:
  ./scripts/security/run-full-audit.sh --local
  ./scripts/security/run-full-audit.sh --remote root@46.225.188.213
  ./scripts/security/run-full-audit.sh --local --target https://dockerlab.peermesh.org --output audit.md
USAGE
    exit 0
}

emit() {
    # Print to stdout and capture for report
    local line="$1"
    printf '%s\n' "$line"
    REPORT_LINES+=("$line")
}

emit_color() {
    # Print colored to stdout, plain to report
    local color="$1"
    local plain="$2"
    printf "${color}%s${RESET}\n" "$plain"
    REPORT_LINES+=("$plain")
}

record_pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    emit_color "$GREEN" "PASS: $1"
}

record_fail_critical() {
    CRITICAL_COUNT=$((CRITICAL_COUNT + 1))
    emit_color "$RED" "CRITICAL: $1"
}

record_fail_high() {
    HIGH_COUNT=$((HIGH_COUNT + 1))
    emit_color "$RED" "HIGH: $1"
}

record_fail_medium() {
    MEDIUM_COUNT=$((MEDIUM_COUNT + 1))
    emit_color "$YELLOW" "MEDIUM: $1"
}

record_fail_low() {
    LOW_COUNT=$((LOW_COUNT + 1))
    emit_color "$YELLOW" "LOW: $1"
}

record_skip() {
    SKIP_COUNT=$((SKIP_COUNT + 1))
    emit_color "$YELLOW" "SKIP: $1"
}

section_header() {
    emit ""
    emit_color "$CYAN" "=========================================="
    emit_color "$BOLD" "$1"
    emit_color "$CYAN" "=========================================="
}

subsection_header() {
    emit ""
    emit_color "$BOLD" "--- $1 ---"
}

# --------------------------------------------------------------
# Parse Arguments
# --------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --local)
            MODE="local"
            shift
            ;;
        --remote)
            MODE="remote"
            REMOTE_HOST="${2:-}"
            if [[ -z "$REMOTE_HOST" ]]; then
                printf 'Error: --remote requires a HOST argument\n' >&2
                exit 1
            fi
            shift 2
            ;;
        --target)
            TARGET_URL="${2:-}"
            if [[ -z "$TARGET_URL" ]]; then
                printf 'Error: --target requires a URL argument\n' >&2
                exit 1
            fi
            shift 2
            ;;
        --output)
            OUTPUT_FILE="${2:-}"
            if [[ -z "$OUTPUT_FILE" ]]; then
                printf 'Error: --output requires a FILE argument\n' >&2
                exit 1
            fi
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            printf 'Error: Unknown option: %s\n' "$1" >&2
            usage
            ;;
    esac
done

if [[ -z "$MODE" ]]; then
    printf 'Error: Must specify --local or --remote HOST\n' >&2
    usage
fi

# Default target URL
if [[ -z "$TARGET_URL" ]]; then
    if [[ "$MODE" == "remote" ]]; then
        TARGET_URL="https://dockerlab.peermesh.org"
    else
        TARGET_URL="http://localhost:8080"
    fi
fi

# ==============================================================
# AUDIT START
# ==============================================================
AUDIT_START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

section_header "PeerMesh CORE - SECURITY AUDIT"
emit "Timestamp: ${AUDIT_START}"
emit "Mode:      ${MODE}"
emit "Target:    ${TARGET_URL}"
if [[ "$MODE" == "remote" ]]; then
    emit "Remote:    ${REMOTE_HOST}"
fi
emit "Repo Root: ${REPO_ROOT}"

cd "$REPO_ROOT"

# ==============================================================
# SECTION 1: STATIC ANALYSIS (LOCAL)
# ==============================================================
section_header "SECTION 1: STATIC ANALYSIS"

# --- 1a. gosec on Go code ---
subsection_header "1a. Go Static Analysis (gosec)"
if command -v gosec &>/dev/null; then
    gosec_output=""
    if gosec_output=$(gosec -quiet -fmt text ./services/dashboard/... 2>&1); then
        record_pass "gosec found no issues"
    else
        # Parse gosec output for severity
        gosec_high=$(printf '%s' "$gosec_output" | grep -c '\[HIGH\]' 2>/dev/null || true)
        gosec_medium=$(printf '%s' "$gosec_output" | grep -c '\[MEDIUM\]' 2>/dev/null || true)
        gosec_low=$(printf '%s' "$gosec_output" | grep -c '\[LOW\]' 2>/dev/null || true)

        if [[ "$gosec_high" -gt 0 ]]; then
            HIGH_COUNT=$((HIGH_COUNT + gosec_high))
            emit_color "$RED" "HIGH: gosec found ${gosec_high} high-severity issues"
        fi
        if [[ "$gosec_medium" -gt 0 ]]; then
            MEDIUM_COUNT=$((MEDIUM_COUNT + gosec_medium))
            emit_color "$YELLOW" "MEDIUM: gosec found ${gosec_medium} medium-severity issues"
        fi
        if [[ "$gosec_low" -gt 0 ]]; then
            LOW_COUNT=$((LOW_COUNT + gosec_low))
            emit_color "$YELLOW" "LOW: gosec found ${gosec_low} low-severity issues"
        fi
        if [[ "$gosec_high" -eq 0 && "$gosec_medium" -eq 0 && "$gosec_low" -eq 0 ]]; then
            # gosec returned non-zero but no categorized findings
            emit "$gosec_output"
            record_fail_medium "gosec returned non-zero exit code"
        fi
        emit "$gosec_output"
    fi
else
    record_skip "gosec not installed (go install github.com/securego/gosec/v2/cmd/gosec@latest)"
fi

# --- 1b. shellcheck on all shell scripts ---
subsection_header "1b. Shell Script Analysis (shellcheck)"
if command -v shellcheck &>/dev/null; then
    sc_fail=0
    sc_total=0
    while IFS= read -r f; do
        sc_total=$((sc_total + 1))
        if ! sc_out=$(shellcheck -S warning "$f" 2>&1); then
            sc_fail=$((sc_fail + 1))
            emit "  ISSUES: $f"
            emit "$sc_out" | head -20
        fi
    done < <(find . -name "*.sh" -not -path "./.dev/*" -not -path "./node_modules/*" -not -path "./.git/*" 2>/dev/null)

    if [[ $sc_fail -eq 0 ]]; then
        record_pass "shellcheck: all ${sc_total} scripts clean"
    else
        record_fail_medium "shellcheck: ${sc_fail}/${sc_total} scripts have warnings"
    fi
else
    record_skip "shellcheck not installed (brew install shellcheck / apt install shellcheck)"
fi

# --- 1c. Vulnerability Pattern Search ---
subsection_header "1c. Vulnerability Pattern Search"

# SQL injection patterns
sqli_hits=$(grep -rn 'fmt\.Sprintf.*SELECT\|fmt\.Sprintf.*INSERT\|exec\.Command.*Getenv' services/dashboard/ --include="*.go" 2>/dev/null || true)
if [[ -n "$sqli_hits" ]]; then
    record_fail_high "Potential SQL injection / command injection patterns found"
    emit "$sqli_hits"
else
    record_pass "No SQL/command injection patterns detected"
fi

# Hardcoded secrets (exclude tests, comments, and common false-positive patterns)
secret_hits=$(grep -rn 'password.*=.*"\|secret.*=.*"\|token.*=.*"' services/dashboard/ --include="*.go" 2>/dev/null | grep -v "_test.go" | grep -v "// " | grep -v "\.example" | grep -v "ENV\|env\|flag\.\|os\.Getenv\|config\." | grep -v 'FormValue\|Header\.Get\|Getenv\|URL\.Query\|r\.Form\|ParseForm\|cookie\|Cookie' | grep -v '== ""\|!= ""' || true)
if [[ -n "$secret_hits" ]]; then
    record_fail_high "Potential hardcoded secrets found"
    emit "$secret_hits"
else
    record_pass "No hardcoded secrets detected in Go source"
fi

# Unsafe HTML template injection
unsafe_html=$(grep -rn 'template\.HTML\|template\.JS\|template\.URL' services/dashboard/ --include="*.go" 2>/dev/null || true)
if [[ -n "$unsafe_html" ]]; then
    record_fail_medium "Unsafe template types found (potential XSS via template.HTML/JS/URL)"
    emit "$unsafe_html"
else
    record_pass "No unsafe template types detected"
fi

# Unvalidated redirects
redirect_hits=$(grep -rn 'http\.Redirect.*r\.URL\|http\.Redirect.*r\.Form\|http\.Redirect.*r\.Header' services/dashboard/ --include="*.go" 2>/dev/null || true)
if [[ -n "$redirect_hits" ]]; then
    record_fail_medium "Potential open redirect patterns found"
    emit "$redirect_hits"
else
    record_pass "No open redirect patterns detected"
fi

# ==============================================================
# SECTION 2: COMPOSE SECURITY AUDIT (LOCAL)
# ==============================================================
section_header "SECTION 2: COMPOSE SECURITY AUDIT"

subsection_header "2a. Service Hardening Checks"
if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    compose_config=$(docker compose config 2>/dev/null || true)
    if [[ -n "$compose_config" ]]; then
        # Use python3 to parse YAML and check security properties
        # NOTE: Use process substitution (< <(...)) not pipe (|) for the while loop
        # so that record_* calls update counters in the current shell, not a subshell.
        while IFS='|' read -r sev msg; do
            case "$sev" in
                PASS) record_pass "$msg" ;;
                CRITICAL) record_fail_critical "$msg" ;;
                HIGH) record_fail_high "$msg" ;;
                MEDIUM) record_fail_medium "$msg" ;;
                LOW) record_fail_low "$msg" ;;
            esac
        done < <(python3 -c "
import yaml, sys, json

config = yaml.safe_load(sys.stdin)
results = []
for name, svc in config.get('services', {}).items():
    issues = []
    severity = 'LOW'

    sec_opt_str = str(svc.get('security_opt', []))
    if 'no-new-privileges:true' not in sec_opt_str:
        issues.append('MISSING no-new-privileges')
        severity = 'MEDIUM'

    cap_drop_str = str(svc.get('cap_drop', []))
    if 'ALL' not in cap_drop_str:
        issues.append('MISSING cap_drop ALL')
        severity = 'MEDIUM'

    mem = svc.get('deploy', {}).get('resources', {}).get('limits', {}).get('memory')
    if not mem:
        # Also check top-level mem_limit for older compose formats
        if not svc.get('mem_limit'):
            issues.append('MISSING memory limit')

    if not svc.get('healthcheck'):
        issues.append('MISSING healthcheck')

    cap_add = svc.get('cap_add', [])
    if cap_add:
        issues.append(f'cap_add: {cap_add}')

    privileged = svc.get('privileged', False)
    if privileged:
        issues.append('PRIVILEGED MODE')
        severity = 'CRITICAL'

    results.append({
        'name': name,
        'issues': issues,
        'severity': severity if issues else 'PASS'
    })

for r in results:
    if r['severity'] == 'PASS':
        print(f\"PASS|{r['name']}: all hardening checks passed\")
    elif r['severity'] == 'CRITICAL':
        print(f\"CRITICAL|{r['name']}: {', '.join(r['issues'])}\")
    elif r['severity'] == 'MEDIUM':
        print(f\"MEDIUM|{r['name']}: {', '.join(r['issues'])}\")
    else:
        print(f\"LOW|{r['name']}: {', '.join(r['issues'])}\")
" <<< "$compose_config" 2>/dev/null)
    else
        record_skip "docker compose config failed (compose files may not be present)"
    fi
else
    record_skip "docker/docker compose not available for compose audit"
fi

# --- 2b. Image Pinning Audit ---
subsection_header "2b. Image Pinning Audit"
if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    compose_config=$(docker compose config 2>/dev/null || true)
    if [[ -n "$compose_config" ]]; then
        while IFS= read -r line; do
            image=$(printf '%s' "$line" | sed 's/.*image: *//' | tr -d '"' | tr -d "'" | xargs)
            if [[ -z "$image" ]]; then
                continue
            fi
            if printf '%s' "$image" | grep -q "@sha256:"; then
                record_pass "Pinned: ${image}"
            elif printf '%s' "$image" | grep -q ":latest"; then
                record_fail_medium "Uses :latest tag: ${image}"
            elif printf '%s' "$image" | grep -qv ":"; then
                record_fail_medium "No tag specified (implies :latest): ${image}"
            else
                record_fail_low "Tag only, no digest: ${image}"
            fi
        done < <(printf '%s' "$compose_config" | grep "image:" 2>/dev/null)
    fi
else
    record_skip "docker compose not available for image pinning audit"
fi

# ==============================================================
# SECTION 3: ENDPOINT SECURITY TESTS
# ==============================================================
section_header "SECTION 3: ENDPOINT SECURITY TESTS"

subsection_header "3a. Authentication Bypass Tests"
if command -v curl &>/dev/null; then
    endpoint_reachable=false
    # Quick connectivity check
    if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "${TARGET_URL}/" &>/dev/null; then
        endpoint_reachable=true
    fi

    if [[ "$endpoint_reachable" == "true" ]]; then
        # Pre-check: is the dashboard API reachable?
        health_status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "${TARGET_URL}/health" 2>/dev/null || echo "000")
        if [[ "$health_status" != "200" ]]; then
            record_skip "Dashboard not running on ${TARGET_URL} (health returned ${health_status})"
            emit "  Endpoint tests require the dashboard application"
        else
            for path in /api/containers /api/system /api/deployment /api/volumes /api/alerts /api/events /api/instances; do
                status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "${TARGET_URL}${path}" 2>/dev/null || echo "000")
                if [[ "$status" == "401" || "$status" == "403" || "$status" == "302" ]]; then
                    record_pass "${path} returns ${status} (auth required)"
                elif [[ "$status" == "000" ]]; then
                    record_skip "${path} - connection failed"
                else
                    record_fail_critical "${path} returns ${status} (expected 401/403/302 - possible auth bypass)"
                fi
            done

            # Public paths should be accessible
            for path in /health /login; do
                status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "${TARGET_URL}${path}" 2>/dev/null || echo "000")
                if [[ "$status" == "200" || "$status" == "302" ]]; then
                    record_pass "${path} returns ${status} (public, expected)"
                elif [[ "$status" == "000" ]]; then
                    record_skip "${path} - connection failed"
                else
                    emit "INFO: ${path} returns ${status}"
                fi
            done
        fi
    else
        record_skip "Target ${TARGET_URL} not reachable (connection timeout)"
    fi
else
    record_skip "curl not installed"
fi

# --- 3b. Header Injection ---
subsection_header "3b. Header Injection (CRLF)"
if [[ "${endpoint_reachable:-false}" == "true" ]]; then
    # Check response HEADERS only (not body) for injected header.
    # Services like whoami echo request headers in the body by design,
    # which is not a CRLF vulnerability.
    crlf_headers=$(curl -s -D /dev/stdout -o /dev/null -H "Host: evil.com%0d%0aInjected: true" --connect-timeout 5 --max-time 10 "${TARGET_URL}/" 2>/dev/null || true)
    if printf '%s' "$crlf_headers" | grep -qi "^Injected:"; then
        record_fail_critical "CRLF injection possible (injected header in response)"
    else
        record_pass "CRLF injection blocked"
    fi
else
    record_skip "Target not reachable for CRLF test"
fi

# --- 3c. XSS Reflection ---
subsection_header "3c. XSS Reflection"
if [[ "${endpoint_reachable:-false}" == "true" ]]; then
    response=$(curl -s -H "User-Agent: <script>alert(1)</script>" --connect-timeout 5 --max-time 10 "${TARGET_URL}/" 2>/dev/null || true)
    if printf '%s' "$response" | grep -q "<script>alert(1)</script>"; then
        record_fail_high "XSS reflected in response body"
    else
        record_pass "XSS not reflected"
    fi
else
    record_skip "Target not reachable for XSS test"
fi

# --- 3d. Security Headers ---
subsection_header "3d. Security Headers"
if [[ "${endpoint_reachable:-false}" == "true" ]]; then
    headers=$(curl -s -D - -o /dev/null --connect-timeout 5 --max-time 10 "${TARGET_URL}/" 2>/dev/null || true)

    check_header() {
        local header_name="$1"
        local header_pattern="$2"
        if printf '%s' "$headers" | grep -qi "$header_pattern"; then
            record_pass "Header present: ${header_name}"
        else
            record_fail_medium "Header missing: ${header_name}"
        fi
    }

    check_header "X-Frame-Options" "x-frame-options"
    check_header "X-Content-Type-Options" "x-content-type-options"
    check_header "X-XSS-Protection" "x-xss-protection"
    check_header "Content-Security-Policy" "content-security-policy"
    check_header "Strict-Transport-Security" "strict-transport-security"
    check_header "X-Robots-Tag" "x-robots-tag"
else
    record_skip "Target not reachable for security headers test"
fi

# --- 3e. Request Timing (side-channel detection) ---
subsection_header "3e. Request Timing (side-channel detection)"
if [[ "${endpoint_reachable:-false}" == "true" ]]; then
    timings=()
    for _ in $(seq 1 10); do
        t=$(curl -s -o /dev/null -w "%{time_total}" --connect-timeout 5 --max-time 10 "${TARGET_URL}/" 2>/dev/null || echo "0")
        timings+=("$t")
    done

    # Calculate min/max/avg using awk
    timing_stats=$(printf '%s\n' "${timings[@]}" | awk '
        BEGIN { min=999; max=0; sum=0; n=0 }
        { sum+=$1; n++; if($1<min) min=$1; if($1>max) max=$1 }
        END { if(n>0) printf "min=%.3f max=%.3f avg=%.3f variance=%.3f\n", min, max, sum/n, (max-min) }
    ')
    emit "  Timing: ${timing_stats}"

    # Flag high variance (potential timing side-channel)
    variance=$(printf '%s' "$timing_stats" | sed 's/.*variance=//')
    if awk "BEGIN { exit ($variance > 1.0) ? 0 : 1 }" 2>/dev/null; then
        record_fail_low "High response time variance (${variance}s) - potential timing side-channel"
    else
        record_pass "Response timing variance within normal range (${variance}s)"
    fi
else
    record_skip "Target not reachable for timing analysis"
fi

# ==============================================================
# SECTION 4: REMOTE VPS SCANS (only with --remote)
# ==============================================================
if [[ "$MODE" == "remote" ]]; then
    section_header "SECTION 4: REMOTE VPS SCANS"

    # Verify SSH connectivity
    subsection_header "4a. SSH Connectivity"
    if ssh -o ConnectTimeout=10 -o BatchMode=yes "$REMOTE_HOST" 'echo ok' &>/dev/null; then
        record_pass "SSH connection to ${REMOTE_HOST} successful"
    else
        record_fail_critical "Cannot SSH to ${REMOTE_HOST}"
        # Skip remaining remote tests
        emit "Skipping remaining remote tests due to SSH failure"
        # Jump to summary
        REMOTE_SSH_FAILED=true
    fi

    if [[ "${REMOTE_SSH_FAILED:-false}" != "true" ]]; then

        # --- 4b. Trivy Image Scans ---
        subsection_header "4b. Trivy Image Scans"
        trivy_available=$(ssh -o ConnectTimeout=10 "$REMOTE_HOST" 'command -v trivy &>/dev/null && echo yes || echo no' 2>/dev/null)
        if [[ "$trivy_available" == "yes" ]]; then
            trivy_output=$(ssh -o ConnectTimeout=10 "$REMOTE_HOST" '
                for img in $(docker ps --format "{{.Image}}" | sort -u); do
                    printf "IMAGE: %s\n" "$img"
                    trivy image --severity HIGH,CRITICAL --no-progress --quiet "$img" 2>&1 | tail -20
                    printf "\n"
                done
            ' 2>/dev/null || true)
            emit "$trivy_output"

            trivy_crit=$(printf '%s' "$trivy_output" | grep -c "CRITICAL" 2>/dev/null || true)
            trivy_high=$(printf '%s' "$trivy_output" | grep -c "HIGH" 2>/dev/null || true)
            if [[ "$trivy_crit" -gt 0 ]]; then
                record_fail_critical "Trivy found CRITICAL vulnerabilities in container images"
            fi
            if [[ "$trivy_high" -gt 0 ]]; then
                record_fail_high "Trivy found HIGH vulnerabilities in container images"
            fi
            if [[ "$trivy_crit" -eq 0 && "$trivy_high" -eq 0 ]]; then
                record_pass "Trivy found no HIGH/CRITICAL vulnerabilities"
            fi
        else
            record_skip "trivy not installed on ${REMOTE_HOST} (curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh)"
        fi

        # --- 4c. Container Hardening Verification ---
        subsection_header "4c. Container Hardening Verification"
        hardening_output=$(ssh -o ConnectTimeout=10 "$REMOTE_HOST" '
            docker ps --format "{{.Names}}" | while read -r name; do
                printf "=== %s ===\n" "$name"
                docker inspect "$name" --format "CapDrop={{.HostConfig.CapDrop}} SecurityOpt={{.HostConfig.SecurityOpt}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} User={{.Config.User}}" 2>/dev/null
            done
        ' 2>/dev/null || true)
        emit "$hardening_output"

        # Check for containers missing cap_drop ALL
        while IFS= read -r line; do
            if printf '%s' "$line" | grep -q "^=== "; then
                current_container=$(printf '%s' "$line" | sed 's/=== //;s/ ===//')
            elif printf '%s' "$line" | grep -q "CapDrop="; then
                if ! printf '%s' "$line" | grep -q "ALL"; then
                    record_fail_medium "Container ${current_container} missing cap_drop ALL"
                fi
                if ! printf '%s' "$line" | grep -q "no-new-privileges"; then
                    record_fail_medium "Container ${current_container} missing no-new-privileges"
                fi
            fi
        done <<< "$hardening_output"

        # --- 4d. Network Isolation ---
        subsection_header "4d. Network Isolation"
        network_output=$(ssh -o ConnectTimeout=10 "$REMOTE_HOST" '
            for net in $(docker network ls --format "{{.Name}}" | grep pmdl); do
                printf "--- %s ---\n" "$net"
                docker network inspect "$net" --format "Internal={{.Internal}} Driver={{.Driver}}" 2>/dev/null
                docker network inspect "$net" --format "{{range .Containers}}  {{.Name}}{{end}}" 2>/dev/null
            done
        ' 2>/dev/null || true)
        if [[ -n "$network_output" ]]; then
            emit "$network_output"
            record_pass "Network isolation configuration retrieved"
        else
            emit "  No pmdl-prefixed networks found"
        fi

        # --- 4e. Open Ports ---
        subsection_header "4e. Open Ports"
        ports_output=$(ssh -o ConnectTimeout=10 "$REMOTE_HOST" 'ss -tlnp 2>/dev/null | grep LISTEN' 2>/dev/null || true)
        if [[ -n "$ports_output" ]]; then
            emit "$ports_output"
            # Flag unexpected ports
            unexpected=$(printf '%s' "$ports_output" | grep -v ':22 \|:80 \|:443 \|:8080 \|127\.0\.0\.\|::1' || true)
            if [[ -n "$unexpected" ]]; then
                record_fail_medium "Unexpected open ports detected (review manually)"
            else
                record_pass "Only expected ports open (22, 80, 443, 8080)"
            fi
        else
            emit "  Could not retrieve open ports"
        fi

        # --- 4f. Firewall Status ---
        subsection_header "4f. Firewall Status"
        fw_output=$(ssh -o ConnectTimeout=10 "$REMOTE_HOST" 'ufw status verbose 2>/dev/null || iptables -L -n 2>/dev/null | head -30 || echo "No firewall tool found"' 2>/dev/null || true)
        emit "$fw_output"
        if printf '%s' "$fw_output" | grep -qi "Status: active"; then
            record_pass "UFW firewall is active"
        elif printf '%s' "$fw_output" | grep -qi "Status: inactive"; then
            record_fail_high "UFW firewall is inactive"
        elif printf '%s' "$fw_output" | grep -qi "Chain INPUT"; then
            emit "  iptables rules present (manual review needed)"
        else
            record_fail_high "No firewall detected"
        fi

        # --- 4g. Docker Daemon Configuration ---
        subsection_header "4g. Docker Daemon Configuration"
        daemon_config=$(ssh -o ConnectTimeout=10 "$REMOTE_HOST" 'cat /etc/docker/daemon.json 2>/dev/null || echo "{}"' 2>/dev/null || true)
        emit "$daemon_config"

        if printf '%s' "$daemon_config" | grep -q '"live-restore".*true'; then
            record_pass "Docker live-restore enabled"
        else
            record_fail_low "Docker live-restore not enabled"
        fi

        if printf '%s' "$daemon_config" | grep -q '"no-new-privileges".*true'; then
            record_pass "Docker default no-new-privileges enabled"
        else
            record_fail_low "Docker default no-new-privileges not set in daemon.json"
        fi

        if printf '%s' "$daemon_config" | grep -q '"userland-proxy".*false'; then
            record_pass "Docker userland-proxy disabled"
        else
            record_fail_low "Docker userland-proxy not disabled in daemon.json"
        fi
    fi
else
    section_header "SECTION 4: REMOTE VPS SCANS"
    emit "Skipped (--local mode, use --remote HOST to enable)"
fi

# ==============================================================
# SECTION 5: EXISTING SECURITY SCRIPTS
# ==============================================================
section_header "SECTION 5: COMPANION SECURITY SCRIPTS"
emit "The following companion scripts are available but not auto-run:"
emit "  - scripts/security/run-docker-bench.sh       (requires sudo, interactive)"
emit "  - scripts/security/validate-image-policy.sh   (compose image policy)"
emit "  - scripts/security/validate-supply-chain.sh   (SBOM + vuln threshold)"
emit "  - scripts/security/audit-ownership.sh          (runtime ownership audit)"
emit "  - scripts/security/generate-sbom.sh            (CycloneDX SBOM generation)"
emit "  - scripts/security/run-sqlmap-scan.sh          (SQL injection testing)"
emit ""
emit "Run individually as needed. See scripts/security/README.md for details."

# ==============================================================
# SECTION 6: SUMMARY
# ==============================================================
section_header "SECURITY AUDIT SUMMARY"

AUDIT_END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
emit "Started:   ${AUDIT_START}"
emit "Completed: ${AUDIT_END}"
emit "Mode:      ${MODE}"
emit "Target:    ${TARGET_URL}"
emit ""
emit_color "$RED"    "Critical: ${CRITICAL_COUNT}"
emit_color "$RED"    "High:     ${HIGH_COUNT}"
emit_color "$YELLOW" "Medium:   ${MEDIUM_COUNT}"
emit_color "$YELLOW" "Low:      ${LOW_COUNT}"
emit_color "$GREEN"  "Pass:     ${PASS_COUNT}"
emit_color "$YELLOW" "Skipped:  ${SKIP_COUNT}"
emit ""

if [[ $CRITICAL_COUNT -gt 0 || $HIGH_COUNT -gt 0 ]]; then
    emit_color "$RED" "VERDICT: FAIL -- Critical/High findings require remediation"
    VERDICT="FAIL"
else
    emit_color "$GREEN" "VERDICT: PASS -- No critical/high findings"
    VERDICT="PASS"
fi

# ==============================================================
# WRITE REPORT FILE (if --output specified)
# ==============================================================
if [[ -n "$OUTPUT_FILE" ]]; then
    {
        printf '# Security Audit Report\n\n'
        printf '| Field | Value |\n'
        printf '|-------|-------|\n'
        printf '| Timestamp | %s |\n' "$AUDIT_START"
        printf '| Mode | %s |\n' "$MODE"
        printf '| Target | %s |\n' "$TARGET_URL"
        printf '| Verdict | **%s** |\n' "$VERDICT"
        printf '| Critical | %d |\n' "$CRITICAL_COUNT"
        printf '| High | %d |\n' "$HIGH_COUNT"
        printf '| Medium | %d |\n' "$MEDIUM_COUNT"
        printf '| Low | %d |\n' "$LOW_COUNT"
        printf '| Pass | %d |\n' "$PASS_COUNT"
        printf '| Skipped | %d |\n\n' "$SKIP_COUNT"
        printf '## Full Output\n\n'
        printf '```\n'
        for line in "${REPORT_LINES[@]}"; do
            printf '%s\n' "$line"
        done
        printf '```\n'
    } > "$OUTPUT_FILE"
    emit ""
    emit "Report written to: ${OUTPUT_FILE}"
fi

# Exit code
if [[ $CRITICAL_COUNT -gt 0 || $HIGH_COUNT -gt 0 ]]; then
    exit 1
else
    exit 0
fi
