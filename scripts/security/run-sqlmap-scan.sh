#!/usr/bin/env bash
# ==============================================================
# PeerMesh Docker Lab - SQLMap Endpoint Scanner
# ==============================================================
# Discovers API endpoints from Go source and runs sqlmap against
# each with safe, non-destructive defaults.
#
# Usage:
#   ./scripts/security/run-sqlmap-scan.sh http://localhost:8080
#   ./scripts/security/run-sqlmap-scan.sh https://dockerlab.peermesh.org --cookie "session=abc123"
#   ./scripts/security/run-sqlmap-scan.sh http://localhost:8080 --output /tmp/sqlmap-report
#
# SAFETY: Uses --batch --level=1 --risk=1 (lowest settings).
#         Read-only detection only. No data exfiltration attempted.
# ==============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
readonly REPO_ROOT

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

if [[ ! -t 1 ]] || [[ -n "${NO_COLOR:-}" ]]; then
    RED='' GREEN='' YELLOW='' CYAN='' BOLD='' RESET=''
fi

# --------------------------------------------------------------
# Defaults
# --------------------------------------------------------------
TARGET_URL=""
COOKIE=""
OUTPUT_DIR=""
SQLMAP_LEVEL=1
SQLMAP_RISK=1
FINDING_COUNT=0

# --------------------------------------------------------------
# Usage
# --------------------------------------------------------------
usage() {
    cat <<'USAGE'
Usage: run-sqlmap-scan.sh TARGET_URL [OPTIONS]

Arguments:
  TARGET_URL              Base URL of the dashboard (e.g., http://localhost:8080)

Options:
  --cookie COOKIE         Session cookie for authenticated testing
  --output DIR            Directory for sqlmap output files
  --level LEVEL           sqlmap level (1-5, default: 1)
  --risk RISK             sqlmap risk (1-3, default: 1)
  -h, --help              Show this help

Examples:
  ./scripts/security/run-sqlmap-scan.sh http://localhost:8080
  ./scripts/security/run-sqlmap-scan.sh https://dockerlab.peermesh.org --cookie "session=abc"
USAGE
    exit 0
}

# --------------------------------------------------------------
# Parse Arguments
# --------------------------------------------------------------
# Handle --help / -h before requiring positional arg
case "${1:-}" in
    -h|--help) usage ;;
esac

if [[ $# -lt 1 ]]; then
    usage
fi

TARGET_URL="$1"
shift

while [[ $# -gt 0 ]]; do
    case "$1" in
        --cookie)
            COOKIE="${2:-}"
            shift 2
            ;;
        --output)
            OUTPUT_DIR="${2:-}"
            shift 2
            ;;
        --level)
            SQLMAP_LEVEL="${2:-1}"
            shift 2
            ;;
        --risk)
            SQLMAP_RISK="${2:-1}"
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

# Validate target URL
if [[ ! "$TARGET_URL" =~ ^https?:// ]]; then
    printf 'Error: TARGET_URL must start with http:// or https://\n' >&2
    exit 1
fi

# Remove trailing slash
TARGET_URL="${TARGET_URL%/}"

# --------------------------------------------------------------
# Check Prerequisites
# --------------------------------------------------------------
printf "${BOLD}=== SQLMap Endpoint Scanner ===${RESET}\n"
printf "Target: %s\n" "$TARGET_URL"
printf "Level:  %d  Risk: %d\n\n" "$SQLMAP_LEVEL" "$SQLMAP_RISK"

if ! command -v sqlmap &>/dev/null; then
    printf "${RED}ERROR: sqlmap is not installed.${RESET}\n\n"
    printf "Install options:\n"
    printf "  macOS:   brew install sqlmap\n"
    printf "  Debian:  apt install sqlmap\n"
    printf "  pip:     pip install sqlmap\n"
    printf "  Manual:  git clone https://github.com/sqlmapproject/sqlmap.git\n"
    exit 1
fi

printf "sqlmap version: %s\n" "$(sqlmap --version 2>&1 | head -1)"
printf "\n"

# --------------------------------------------------------------
# Discover Endpoints from Go Source
# --------------------------------------------------------------
printf "${CYAN}--- Discovering endpoints from Go source ---${RESET}\n"

ENDPOINTS=()
DASHBOARD_DIR="${REPO_ROOT}/services/dashboard"

if [[ -d "$DASHBOARD_DIR" ]]; then
    # Extract HandleFunc paths from Go source
    while IFS= read -r line; do
        # Extract the path from HandleFunc("/path", ...)
        path=$(printf '%s' "$line" | sed -n 's/.*HandleFunc("\([^"]*\)".*/\1/p')
        if [[ -n "$path" ]]; then
            ENDPOINTS+=("$path")
        fi
    done < <(grep -rn 'HandleFunc(' "$DASHBOARD_DIR" --include="*.go" 2>/dev/null | grep -v "_test.go" | grep -v "httptest" || true)
else
    printf "${YELLOW}WARNING: Dashboard source not found at %s${RESET}\n" "$DASHBOARD_DIR"
    printf "Using default endpoint list.\n"
fi

# Fallback/supplement with known endpoints
DEFAULT_ENDPOINTS=(
    "/api/login"
    "/api/logout"
    "/api/guest-login"
    "/api/session"
    "/api/system"
    "/api/containers"
    "/api/volumes"
    "/api/alerts"
    "/api/events"
    "/api/deployment"
    "/api/instances"
)

# Merge discovered + default, deduplicate
ALL_ENDPOINTS=()
declare -A seen_endpoints
for ep in "${ENDPOINTS[@]}" "${DEFAULT_ENDPOINTS[@]}"; do
    if [[ -z "${seen_endpoints[$ep]:-}" ]]; then
        seen_endpoints[$ep]=1
        ALL_ENDPOINTS+=("$ep")
    fi
done

printf "Discovered %d unique endpoints:\n" "${#ALL_ENDPOINTS[@]}"
for ep in "${ALL_ENDPOINTS[@]}"; do
    printf "  %s\n" "$ep"
done
printf "\n"

# --------------------------------------------------------------
# Build sqlmap Base Command
# --------------------------------------------------------------
build_sqlmap_cmd() {
    local url="$1"
    local cmd="sqlmap -u '${url}' --batch --level=${SQLMAP_LEVEL} --risk=${SQLMAP_RISK}"
    cmd+=" --threads=1 --timeout=10 --retries=1"
    cmd+=" --technique=BEUSTQ"
    cmd+=" --tamper=space2comment"

    # Safe defaults: no data extraction
    cmd+=" --skip-waf"

    if [[ -n "$COOKIE" ]]; then
        cmd+=" --cookie='${COOKIE}'"
    fi

    if [[ -n "$OUTPUT_DIR" ]]; then
        cmd+=" --output-dir='${OUTPUT_DIR}'"
    fi

    printf '%s' "$cmd"
}

# --------------------------------------------------------------
# Run Scans
# --------------------------------------------------------------
printf "${CYAN}--- Running sqlmap scans ---${RESET}\n\n"

VULNERABLE_ENDPOINTS=()
CLEAN_ENDPOINTS=()
ERROR_ENDPOINTS=()

for ep in "${ALL_ENDPOINTS[@]}"; do
    url="${TARGET_URL}${ep}"
    printf "${BOLD}Testing: %s${RESET}\n" "$url"

    # Build the command
    sqlmap_cmd="sqlmap -u '${url}' --batch --level=${SQLMAP_LEVEL} --risk=${SQLMAP_RISK}"
    sqlmap_cmd+=" --threads=1 --timeout=10 --retries=1"

    if [[ -n "$COOKIE" ]]; then
        sqlmap_cmd+=" --cookie='${COOKIE}'"
    fi

    if [[ -n "$OUTPUT_DIR" ]]; then
        sqlmap_cmd+=" --output-dir='${OUTPUT_DIR}'"
    fi

    # Run sqlmap and capture output
    sqlmap_output=""
    sqlmap_output=$(eval "$sqlmap_cmd" 2>&1) || true

    # Parse results
    if printf '%s' "$sqlmap_output" | grep -qi "is vulnerable\|injectable\|sql injection"; then
        FINDING_COUNT=$((FINDING_COUNT + 1))
        VULNERABLE_ENDPOINTS+=("$ep")
        printf "${RED}  VULNERABLE: SQL injection found!${RESET}\n"
        # Show the relevant finding lines
        printf '%s' "$sqlmap_output" | grep -i "vulnerable\|injectable\|Parameter\|Type:" | head -10 | while IFS= read -r fline; do
            printf "    %s\n" "$fline"
        done
    elif printf '%s' "$sqlmap_output" | grep -qi "all tested parameters do not appear\|connection timed out\|not injectable"; then
        CLEAN_ENDPOINTS+=("$ep")
        printf "${GREEN}  CLEAN: No injection found${RESET}\n"
    elif printf '%s' "$sqlmap_output" | grep -qi "connection refused\|unable to connect\|HTTP error"; then
        ERROR_ENDPOINTS+=("$ep")
        printf "${YELLOW}  ERROR: Connection issue${RESET}\n"
    else
        CLEAN_ENDPOINTS+=("$ep")
        printf "${GREEN}  CLEAN: No injection found${RESET}\n"
    fi

    printf "\n"
done

# --------------------------------------------------------------
# Summary
# --------------------------------------------------------------
printf "${CYAN}==========================================\n"
printf "SQLMAP SCAN SUMMARY\n"
printf "==========================================${RESET}\n"
printf "Target:     %s\n" "$TARGET_URL"
printf "Level:      %d\n" "$SQLMAP_LEVEL"
printf "Risk:       %d\n" "$SQLMAP_RISK"
printf "Scanned:    %d endpoints\n" "${#ALL_ENDPOINTS[@]}"
printf "\n"
printf "${GREEN}Clean:      %d${RESET}\n" "${#CLEAN_ENDPOINTS[@]}"
printf "${RED}Vulnerable: %d${RESET}\n" "${#VULNERABLE_ENDPOINTS[@]}"
printf "${YELLOW}Errors:     %d${RESET}\n" "${#ERROR_ENDPOINTS[@]}"

if [[ ${#VULNERABLE_ENDPOINTS[@]} -gt 0 ]]; then
    printf "\n${RED}VULNERABLE ENDPOINTS:${RESET}\n"
    for ep in "${VULNERABLE_ENDPOINTS[@]}"; do
        printf "  - %s%s\n" "$TARGET_URL" "$ep"
    done
fi

if [[ ${#ERROR_ENDPOINTS[@]} -gt 0 ]]; then
    printf "\n${YELLOW}ENDPOINTS WITH ERRORS:${RESET}\n"
    for ep in "${ERROR_ENDPOINTS[@]}"; do
        printf "  - %s%s\n" "$TARGET_URL" "$ep"
    done
fi

printf "\n"

if [[ $FINDING_COUNT -gt 0 ]]; then
    printf "${RED}VERDICT: FAIL -- %d SQL injection finding(s)${RESET}\n" "$FINDING_COUNT"
    exit 1
else
    printf "${GREEN}VERDICT: PASS -- No SQL injection findings${RESET}\n"
    exit 0
fi
