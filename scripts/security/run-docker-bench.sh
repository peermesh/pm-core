#!/bin/bash
# ==============================================================
# Docker Bench Security Scanner
# ==============================================================
# Runs docker-bench-security against the PeerMesh Core
# infrastructure and generates a timestamped report.
#
# Usage:
#   ./scripts/security/run-docker-bench.sh              # Run full scan
#   ./scripts/security/run-docker-bench.sh --quick      # Skip host checks
#   ./scripts/security/run-docker-bench.sh --mode native # Run script directly from source
#   ./scripts/security/run-docker-bench.sh --help       # Show help
#
# Requirements:
#   - Docker installed and running
#   - Must be run as root or with sudo for full host checks
#
# Output:
#   - Nested workspace mode: ../../.dev/ai/security/docker-bench-<timestamp>.log
#   - Standalone mode: reports/security/docker-bench-<timestamp>.log
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -d "$PROJECT_DIR/../../.dev/ai" ]; then
    # Running inside parent workspace that owns the canonical AI artifact tree.
    REPORTS_DIR="$PROJECT_DIR/../../.dev/ai/security"
else
    # Standalone public repo fallback.
    REPORTS_DIR="$PROJECT_DIR/reports/security"
fi
TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
REPORT_FILE="$REPORTS_DIR/docker-bench-$TIMESTAMP.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
QUICK_MODE=false
HELP=false
MODE="auto"

while [[ $# -gt 0 ]]; do
    case $1 in
        --quick|-q)
            QUICK_MODE=true
            shift
            ;;
        --help|-h)
            HELP=true
            shift
            ;;
        --mode)
            MODE="${2:-}"
            if [[ "$MODE" != "auto" && "$MODE" != "container" && "$MODE" != "native" ]]; then
                echo -e "${RED}Invalid mode: $MODE (expected auto|container|native)${NC}"
                exit 1
            fi
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

if [ "$HELP" = true ]; then
    echo "Docker Bench Security Scanner"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --quick, -q    Skip host-level checks (sections 1 & 2)"
    echo "  --mode MODE    Execution mode: auto|container|native (default: auto)"
    echo "  --help, -h     Show this help message"
    echo ""
    echo "Output:"
    echo "  Reports are saved to: $REPORTS_DIR/"
    echo ""
    echo "Notes:"
    echo "  - Run with sudo for complete host checks"
    echo "  - Quick mode is useful in Docker-in-Docker or restricted environments"
    exit 0
fi

# Ensure reports directory exists
mkdir -p "$REPORTS_DIR"

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Docker Bench Security Scanner${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""
echo -e "Project: ${GREEN}PeerMesh Core${NC}"
echo -e "Date:    ${GREEN}$(date)${NC}"
echo -e "Report:  ${GREEN}$REPORT_FILE${NC}"
echo ""

# Check if running as root for full checks
if [ "$EUID" -ne 0 ] && [ "$QUICK_MODE" = false ]; then
    echo -e "${YELLOW}WARNING: Not running as root. Host-level checks may be incomplete.${NC}"
    echo -e "${YELLOW}         Run with sudo for full security audit.${NC}"
    echo ""
fi

# Check if docker-bench-security image exists locally
run_container_mode() {
    if ! docker image inspect docker/docker-bench-security:latest >/dev/null 2>&1; then
        echo -e "${BLUE}Pulling docker-bench-security image...${NC}"
        docker pull docker/docker-bench-security:latest
    fi

    # Build the docker-bench command
    local bench_cmd="docker run --rm --net host --pid host --userns host --cap-add audit_control"
    bench_cmd="$bench_cmd -e DOCKER_CONTENT_TRUST=\$DOCKER_CONTENT_TRUST"
    bench_cmd="$bench_cmd -v /var/lib:/var/lib:ro"
    bench_cmd="$bench_cmd -v /var/run/docker.sock:/var/run/docker.sock:ro"
    bench_cmd="$bench_cmd -v /usr/lib/systemd:/usr/lib/systemd:ro"
    bench_cmd="$bench_cmd -v /etc:/etc:ro"
    bench_cmd="$bench_cmd --label docker_bench_security"
    bench_cmd="$bench_cmd docker/docker-bench-security"

    if [ "$QUICK_MODE" = true ]; then
        echo -e "${YELLOW}Running in quick mode (skipping host checks)...${NC}"
        bench_cmd="$bench_cmd -c container_images,container_runtime,docker_security_operations"
    fi

    eval "$bench_cmd" 2>&1
}

run_native_mode() {
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    echo -e "${BLUE}Running native docker-bench-security script...${NC}"
    echo -e "${BLUE}Using temp dir: ${tmp_dir}${NC}"
    git clone --depth 1 https://github.com/docker/docker-bench-security.git "${tmp_dir}/docker-bench-security" >/dev/null 2>&1
    local script_path="${tmp_dir}/docker-bench-security/docker-bench-security.sh"
    if [ "$QUICK_MODE" = true ]; then
        bash "$script_path" -c container_images,container_runtime,docker_security_operations
    else
        bash "$script_path"
    fi
    rm -rf "$tmp_dir"
}

echo -e "${BLUE}Running docker-bench-security (mode: ${MODE})...${NC}"
echo ""

# Run the benchmark and capture output
{
    echo "========================================"
    echo "Docker Bench Security Report"
    echo "========================================"
    echo ""
    echo "Project: PeerMesh Core"
    echo "Date: $(date)"
    echo "Host: $(hostname)"
    echo "Docker Version: $(docker version --format '{{.Server.Version}}')"
    echo ""
    echo "========================================"
    echo ""

    if [[ "$MODE" == "container" ]]; then
        run_container_mode
    elif [[ "$MODE" == "native" ]]; then
        run_native_mode
    else
        # auto: try container first, then fallback to native on CLI API mismatch
        set +e
        output="$(run_container_mode)"
        rc=$?
        set -e
        if [[ $rc -eq 0 ]]; then
            echo "$output"
        else
            echo "$output"
            if echo "$output" | grep -qi "client version .* too old"; then
                echo ""
                echo -e "${YELLOW}Container mode failed due to Docker API client mismatch; falling back to native mode...${NC}"
                run_native_mode
            else
                exit "$rc"
            fi
        fi
    fi

    echo ""
    echo "========================================"
    echo "End of Report"
    echo "========================================"
} | tee "$REPORT_FILE"

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Scan Complete${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "Report saved to: ${BLUE}$REPORT_FILE${NC}"
echo ""
echo -e "To view report: ${YELLOW}cat $REPORT_FILE${NC}"
echo -e "To view summary: ${YELLOW}grep -E '\\[WARN\\]|\\[PASS\\]|\\[INFO\\]' $REPORT_FILE | head -50${NC}"
