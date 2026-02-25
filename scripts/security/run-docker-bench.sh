#!/bin/bash
# ==============================================================
# Docker Bench Security Scanner
# ==============================================================
# Runs docker-bench-security against the Peer Mesh Docker Lab
# infrastructure and generates a timestamped report.
#
# Usage:
#   ./scripts/security/run-docker-bench.sh              # Run full scan
#   ./scripts/security/run-docker-bench.sh --quick      # Skip host checks
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
echo -e "Project: ${GREEN}Peer Mesh Docker Lab${NC}"
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
if ! docker image inspect docker/docker-bench-security:latest >/dev/null 2>&1; then
    echo -e "${BLUE}Pulling docker-bench-security image...${NC}"
    docker pull docker/docker-bench-security:latest
fi

# Build the docker-bench command
BENCH_CMD="docker run --rm --net host --pid host --userns host --cap-add audit_control"
BENCH_CMD="$BENCH_CMD -e DOCKER_CONTENT_TRUST=\$DOCKER_CONTENT_TRUST"
BENCH_CMD="$BENCH_CMD -v /var/lib:/var/lib:ro"
BENCH_CMD="$BENCH_CMD -v /var/run/docker.sock:/var/run/docker.sock:ro"
BENCH_CMD="$BENCH_CMD -v /usr/lib/systemd:/usr/lib/systemd:ro"
BENCH_CMD="$BENCH_CMD -v /etc:/etc:ro"
BENCH_CMD="$BENCH_CMD --label docker_bench_security"
BENCH_CMD="$BENCH_CMD docker/docker-bench-security"

if [ "$QUICK_MODE" = true ]; then
    echo -e "${YELLOW}Running in quick mode (skipping host checks)...${NC}"
    BENCH_CMD="$BENCH_CMD -c container_images,container_runtime,docker_security_operations"
fi

echo -e "${BLUE}Running docker-bench-security...${NC}"
echo ""

# Run the benchmark and capture output
{
    echo "========================================"
    echo "Docker Bench Security Report"
    echo "========================================"
    echo ""
    echo "Project: Peer Mesh Docker Lab"
    echo "Date: $(date)"
    echo "Host: $(hostname)"
    echo "Docker Version: $(docker version --format '{{.Server.Version}}')"
    echo ""
    echo "========================================"
    echo ""

    eval "$BENCH_CMD" 2>&1

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
