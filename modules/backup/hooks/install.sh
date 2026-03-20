#!/bin/bash
# ==============================================================
# Backup Module - Install Hook
# ==============================================================
# Purpose: Initialize backup module directories and dependencies
# Called: When module is first installed via pmdl module install backup
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (installation failed)
# ==============================================================

set -euo pipefail

# Configuration
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "${MODULE_DIR}/../.." && pwd)"
BACKUP_LOCAL_PATH="${BACKUP_LOCAL_PATH:-/var/backups/pmdl}"
CONFIGS_DIR="${MODULE_DIR}/configs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# ==============================================================
# Pre-flight Checks
# ==============================================================

check_dependencies() {
    log "Checking dependencies..."

    local missing=()

    # Check for Docker
    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    fi

    # Check for docker compose
    if ! docker compose version &> /dev/null; then
        missing+=("docker-compose-plugin")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing dependencies: ${missing[*]}"
        return 1
    fi

    log_success "All dependencies available"
    return 0
}

check_docker_socket() {
    log "Checking Docker socket access..."

    if [[ ! -S /var/run/docker.sock ]]; then
        log_error "Docker socket not found at /var/run/docker.sock"
        return 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Cannot connect to Docker daemon"
        return 1
    fi

    log_success "Docker socket accessible"
    return 0
}

# ==============================================================
# Directory Setup
# ==============================================================

create_backup_directories() {
    log "Creating backup directories..."

    local dirs=(
        "${BACKUP_LOCAL_PATH}"
        "${BACKUP_LOCAL_PATH}/postgres/daily"
        "${BACKUP_LOCAL_PATH}/postgres/pre-deploy"
        "${BACKUP_LOCAL_PATH}/postgres/logs"
        "${BACKUP_LOCAL_PATH}/volumes/tar"
        "${BACKUP_LOCAL_PATH}/volumes/logs"
        "${BACKUP_LOCAL_PATH}/restic"
    )

    for dir in "${dirs[@]}"; do
        if [[ ! -d "$dir" ]]; then
            if mkdir -p "$dir" 2>/dev/null; then
                log_success "Created: $dir"
            else
                log_warn "Cannot create $dir (may need sudo)"
            fi
        else
            log_success "Exists: $dir"
        fi
    done
}

create_configs_directory() {
    log "Setting up module configs directory..."

    mkdir -p "${CONFIGS_DIR}"

    # Create placeholder secret files if they don't exist
    local secrets=(
        "restic_password"
        "s3_access_key"
        "s3_secret_key"
    )

    for secret in "${secrets[@]}"; do
        local secret_file="${CONFIGS_DIR}/${secret}"
        if [[ ! -f "$secret_file" ]]; then
            # Create placeholder with instructions
            echo "# Replace this line with your ${secret}" > "$secret_file"
            chmod 600 "$secret_file"
            log_warn "Created placeholder: ${secret_file}"
        else
            log_success "Secret exists: ${secret}"
        fi
    done
}

# ==============================================================
# Configuration Validation
# ==============================================================

validate_configuration() {
    log "Validating configuration..."

    local warnings=0

    # Check if backup path is writable
    if [[ -d "${BACKUP_LOCAL_PATH}" ]]; then
        if touch "${BACKUP_LOCAL_PATH}/.write_test" 2>/dev/null; then
            rm -f "${BACKUP_LOCAL_PATH}/.write_test"
            log_success "Backup path is writable: ${BACKUP_LOCAL_PATH}"
        else
            log_warn "Backup path may not be writable: ${BACKUP_LOCAL_PATH}"
            ((warnings++))
        fi
    fi

    # Check for restic password
    local restic_pw="${CONFIGS_DIR}/restic_password"
    if [[ -f "$restic_pw" ]] && grep -q "Replace this" "$restic_pw" 2>/dev/null; then
        log_warn "Restic password not configured - edit ${restic_pw}"
        ((warnings++))
    fi

    # Check for S3 credentials (optional)
    local s3_key="${CONFIGS_DIR}/s3_access_key"
    if [[ -f "$s3_key" ]] && grep -q "Replace this" "$s3_key" 2>/dev/null; then
        log_warn "S3 credentials not configured (optional) - edit ${CONFIGS_DIR}/s3_*"
    fi

    if [[ $warnings -gt 0 ]]; then
        log_warn "Configuration has ${warnings} warning(s) - review before starting"
    else
        log_success "Configuration validated"
    fi

    return 0
}

# ==============================================================
# Network Setup
# ==============================================================

setup_networks() {
    log "Setting up Docker networks..."

    local network="pmdl_backup-internal"

    if docker network inspect "$network" &> /dev/null; then
        log_success "Network exists: $network"
    else
        # Do NOT create the network manually — docker compose must own it
        # to set the com.docker.compose.network label correctly.
        # The network will be created automatically by docker compose up.
        log_success "Network $network will be created by docker compose"
    fi
}

# ==============================================================
# Script Validation
# ==============================================================

validate_scripts() {
    log "Validating backup scripts..."

    local scripts_dir="${PROJECT_ROOT}/scripts/backup"
    local required_scripts=(
        "backup-postgres.sh"
        "backup-volumes.sh"
        "restore-postgres.sh"
        "sync-offsite.sh"
    )

    local missing=()

    for script in "${required_scripts[@]}"; do
        if [[ -f "${scripts_dir}/${script}" ]]; then
            log_success "Found: ${script}"
        else
            missing+=("$script")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing backup scripts: ${missing[*]}"
        log_error "Expected location: ${scripts_dir}/"
        return 1
    fi

    return 0
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "Backup Module Installation"
    log "========================================"
    log ""

    local errors=0

    # Pre-flight checks
    check_dependencies || ((errors++))
    check_docker_socket || ((errors++))

    if [[ $errors -gt 0 ]]; then
        log_error "Pre-flight checks failed with ${errors} error(s)"
        exit 1
    fi

    # Setup
    create_backup_directories
    create_configs_directory
    validate_scripts || ((errors++))
    setup_networks
    validate_configuration

    log ""
    log "========================================"

    if [[ $errors -gt 0 ]]; then
        log_error "Installation completed with ${errors} error(s)"
        exit 1
    fi

    log_success "Backup module installed successfully"
    log ""
    log "Next steps:"
    log "  1. Configure secrets in: ${CONFIGS_DIR}/"
    log "     - restic_password (required for encryption)"
    log "     - s3_access_key (optional, for off-site backup)"
    log "     - s3_secret_key (optional, for off-site backup)"
    log ""
    log "  2. Review .env.example and create .env file"
    log ""
    log "  3. Start the module:"
    log "     docker compose -f modules/backup/docker-compose.yml up -d"
    log ""
    log "========================================"

    exit 0
}

main "$@"
