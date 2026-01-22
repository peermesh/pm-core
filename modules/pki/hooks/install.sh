#!/bin/bash
# ==============================================================
# PKI Module - Install Hook
# ==============================================================
# Purpose: Initialize PKI module, generate CA, and set up directories
# Called: When module is first installed via pmdl module install pki
#
# Exit codes:
#   0 - Success
#   1 - Fatal error (installation failed)
# ==============================================================

set -euo pipefail

# Configuration
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "${MODULE_DIR}/../.." && pwd)"
PKI_STORAGE_PATH="${PKI_STORAGE_PATH:-/var/lib/pki}"
PKI_CERTS_OUTPUT_PATH="${PKI_CERTS_OUTPUT_PATH:-/var/lib/pki/certs}"
CONFIGS_DIR="${MODULE_DIR}/configs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
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

create_pki_directories() {
    log "Creating PKI directories..."

    local dirs=(
        "${PKI_STORAGE_PATH}"
        "${PKI_CERTS_OUTPUT_PATH}"
        "${PKI_CERTS_OUTPUT_PATH}/services"
        "${PKI_CERTS_OUTPUT_PATH}/services/postgres"
        "${PKI_CERTS_OUTPUT_PATH}/services/redis"
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

    # Generate secure passwords for CA and provisioner if they don't exist
    local secrets=(
        "ca_password"
        "provisioner_password"
    )

    for secret in "${secrets[@]}"; do
        local secret_file="${CONFIGS_DIR}/${secret}"
        if [[ ! -f "$secret_file" ]] || grep -q "Replace this" "$secret_file" 2>/dev/null; then
            # Generate a secure random password
            local password
            password=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
            echo "$password" > "$secret_file"
            chmod 600 "$secret_file"
            log_success "Generated secure password: ${secret}"
        else
            log_success "Secret exists: ${secret}"
        fi
    done
}

create_ca_config() {
    log "Creating CA configuration..."

    local ca_config="${CONFIGS_DIR}/ca.json"

    if [[ ! -f "$ca_config" ]]; then
        cat > "$ca_config" << 'EOF'
{
  "root": "/home/step/certs/root_ca.crt",
  "federatedRoots": null,
  "crt": "/home/step/certs/intermediate_ca.crt",
  "key": "/home/step/secrets/intermediate_ca_key",
  "address": ":9000",
  "insecureAddress": "",
  "dnsNames": [
    "ca.pmdl.local",
    "localhost",
    "step-ca"
  ],
  "logger": {
    "format": "json"
  },
  "db": {
    "type": "badgerv2",
    "dataSource": "/home/step/db"
  },
  "authority": {
    "enableAdmin": false,
    "provisioners": [
      {
        "type": "JWK",
        "name": "pmdl-provisioner",
        "key": {},
        "encryptedKey": ""
      },
      {
        "type": "ACME",
        "name": "acme",
        "forceCN": true,
        "claims": {
          "maxTLSCertDuration": "2160h",
          "defaultTLSCertDuration": "720h"
        }
      }
    ],
    "claims": {
      "minTLSCertDuration": "5m",
      "maxTLSCertDuration": "2160h",
      "defaultTLSCertDuration": "720h",
      "disableRenewal": false,
      "allowRenewalAfterExpiry": true
    }
  },
  "tls": {
    "cipherSuites": [
      "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
      "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
      "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
      "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
      "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
      "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384"
    ],
    "minVersion": 1.2,
    "maxVersion": 1.3,
    "renegotiation": false
  }
}
EOF
        chmod 644 "$ca_config"
        log_success "Created CA configuration: ${ca_config}"
    else
        log_success "CA configuration exists"
    fi
}

# ==============================================================
# Network Setup
# ==============================================================

setup_networks() {
    log "Setting up Docker networks..."

    local networks=("pmdl_pki-internal" "pmdl_pki-external")

    for network in "${networks[@]}"; do
        if docker network inspect "$network" &> /dev/null; then
            log_success "Network exists: $network"
        else
            local opts=""
            if [[ "$network" == *"-internal"* ]]; then
                opts="--internal"
            fi
            if docker network create $opts "$network" &> /dev/null; then
                log_success "Created network: $network"
            else
                log_warn "Could not create network: $network (may be created at startup)"
            fi
        fi
    done
}

# ==============================================================
# Validation
# ==============================================================

validate_configuration() {
    log "Validating configuration..."

    local warnings=0

    # Check if storage path is writable
    if [[ -d "${PKI_STORAGE_PATH}" ]]; then
        if touch "${PKI_STORAGE_PATH}/.write_test" 2>/dev/null; then
            rm -f "${PKI_STORAGE_PATH}/.write_test"
            log_success "Storage path is writable: ${PKI_STORAGE_PATH}"
        else
            log_warn "Storage path may not be writable: ${PKI_STORAGE_PATH}"
            ((warnings++))
        fi
    fi

    # Check for CA password
    local ca_pw="${CONFIGS_DIR}/ca_password"
    if [[ ! -f "$ca_pw" ]] || [[ ! -s "$ca_pw" ]]; then
        log_warn "CA password not configured - will be generated on first start"
        ((warnings++))
    else
        log_success "CA password configured"
    fi

    # Check for provisioner password
    local prov_pw="${CONFIGS_DIR}/provisioner_password"
    if [[ ! -f "$prov_pw" ]] || [[ ! -s "$prov_pw" ]]; then
        log_warn "Provisioner password not configured - will be generated on first start"
        ((warnings++))
    else
        log_success "Provisioner password configured"
    fi

    if [[ $warnings -gt 0 ]]; then
        log_warn "Configuration has ${warnings} warning(s) - review before starting"
    else
        log_success "Configuration validated"
    fi

    return 0
}

# ==============================================================
# Main
# ==============================================================

main() {
    log "========================================"
    log "PKI Module Installation"
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
    create_pki_directories
    create_configs_directory
    create_ca_config
    setup_networks
    validate_configuration

    log ""
    log "========================================"

    if [[ $errors -gt 0 ]]; then
        log_error "Installation completed with ${errors} error(s)"
        exit 1
    fi

    log_success "PKI module installed successfully"
    log ""
    log "Next steps:"
    log "  1. Review secrets in: ${CONFIGS_DIR}/"
    log "     - ca_password (auto-generated, keep secure)"
    log "     - provisioner_password (auto-generated, keep secure)"
    log ""
    log "  2. Review .env.example and create .env file if needed"
    log ""
    log "  3. Start the module:"
    log "     docker compose -f modules/pki/docker-compose.yml up -d"
    log ""
    log "  4. After CA is running, provision certificates:"
    log "     ./modules/pki/scripts/provision-cert.sh postgres"
    log "     ./modules/pki/scripts/provision-cert.sh redis"
    log ""
    log "========================================"

    exit 0
}

main "$@"
