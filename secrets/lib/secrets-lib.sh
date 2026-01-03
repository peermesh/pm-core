#!/usr/bin/env bash
# secrets/lib/secrets-lib.sh
# Shared functions for SOPS + age secrets management
#
# This library provides helper functions for the secrets justfile.
# All operations use process substitution to avoid plaintext on disk.
#
# Design Reference: .dev/ai/proposals/2026-01-03-secrets-management-tooling-design.md
#
# Required Functions (per design):
#   - secrets_check_deps      - Verify sops, age, jq installed
#   - secrets_log             - Audit logging with timestamp
#   - secrets_confirm         - Interactive confirmation
#   - secrets_get_env_file    - Return path to env's encrypted file
#   - secrets_validate_pubkey - Validate age public key format
#   - secrets_list_members    - List current team members from .sops.yaml
#   - secrets_is_terminal     - Check if stdout is terminal (block piping)

set -euo pipefail

# ============================================================================
# CONSTANTS
# ============================================================================

# Directory paths - resolved from script location or environment
if [[ -n "${SECRETS_DIR:-}" ]]; then
    : # Use environment variable if already set
elif [[ -n "${BASH_SOURCE[0]:-}" ]]; then
    SECRETS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
else
    SECRETS_DIR="$(pwd)"
fi

# Configuration file paths
readonly SOPS_CONFIG="${SECRETS_DIR}/.sops.yaml"
readonly AUDIT_LOG="${SECRETS_DIR}/audit.log"
readonly KEYS_DIR="${SECRETS_DIR}/keys/public"

# Default age key location
readonly DEFAULT_AGE_KEY_FILE="${HOME}/.config/sops/age/keys.txt"

# Color codes for terminal output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly BOLD='\033[1m'
readonly NC='\033[0m' # No Color

# ============================================================================
# CLEANUP TRAP
# ============================================================================

# Cleanup function called on error or exit
# Ensures sensitive variables are cleared from memory
_secrets_cleanup() {
    local exit_code=$?

    # Clear any sensitive variables from memory
    unset _temp_secret 2>/dev/null || true
    unset _new_value 2>/dev/null || true
    unset _confirm_value 2>/dev/null || true
    unset new_value 2>/dev/null || true
    unset confirm_value 2>/dev/null || true
    unset value 2>/dev/null || true
    unset pubkey 2>/dev/null || true

    # Log errors to audit (only if audit log exists to avoid bootstrap issues)
    if [[ $exit_code -ne 0 && -f "${AUDIT_LOG}" ]]; then
        secrets_log "ERROR" "Script exited with code ${exit_code}" 2>/dev/null || true
    fi

    return $exit_code
}

# Set up cleanup trap - handles EXIT, ERR, INT (Ctrl+C), TERM
trap _secrets_cleanup EXIT ERR INT TERM

# ============================================================================
# LOGGING FUNCTIONS
# ============================================================================

# Internal colored output to stderr
log()   { echo -e "${GREEN}[secrets]${NC} $1"; }
warn()  { echo -e "${YELLOW}[secrets]${NC} $1"; }
error() { echo -e "${RED}[secrets]${NC} $1" >&2; }
info()  { echo -e "${BLUE}[secrets]${NC} $1"; }

# ============================================================================
# AUDIT LOGGING - secrets_log
# ============================================================================

# Audit logging function - logs operations to audit.log
# Usage: secrets_log ACTION MESSAGE [DETAILS]
# Format: TIMESTAMP | USER@HOST | ACTION | MESSAGE | DETAILS
#
# All operations are logged for security audit trail.
# The audit.log file is gitignored but kept locally.
secrets_log() {
    local action="${1:-UNKNOWN}"
    local message="${2:-}"
    local details="${3:-}"

    # Generate ISO 8601 UTC timestamp
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Get user and hostname
    local user="${USER:-unknown}"
    local hostname="${HOSTNAME:-$(hostname -s 2>/dev/null || echo 'unknown')}"

    # Build log entry
    local log_entry="${timestamp} | ${user}@${hostname} | ${action} | ${message}"

    if [[ -n "${details}" ]]; then
        log_entry="${log_entry} | ${details}"
    fi

    # Ensure audit log directory exists
    mkdir -p "$(dirname "${AUDIT_LOG}")" 2>/dev/null || true

    # Append to audit log (create if doesn't exist)
    echo "${log_entry}" >> "${AUDIT_LOG}"

    # Set restrictive permissions (owner read/write only)
    chmod 600 "${AUDIT_LOG}" 2>/dev/null || true
}

# Backwards compatible alias
log_operation() {
    local command="$1"
    local key="${2:--}"
    local env="${3:--}"
    secrets_log "${command}" "${key}" "${env}"
}

# ============================================================================
# DEPENDENCY CHECKS - secrets_check_deps
# ============================================================================

# Check if all required dependencies are installed
# Usage: secrets_check_deps
# Returns: 0 if all required deps installed, 1 otherwise
#
# Required: sops, age, jq
# Optional: yq (helpful for YAML manipulation)
secrets_check_deps() {
    local missing=0

    log "Checking dependencies..."

    # Check for sops (required)
    if command -v sops &> /dev/null; then
        local sops_version
        sops_version=$(sops --version 2>&1 | head -1 || echo "unknown")
        echo "  sops: ${sops_version}"
    else
        error "  sops: NOT FOUND"
        echo "    Install with: brew install sops"
        echo "    Or: go install github.com/getsops/sops/v3/cmd/sops@latest"
        missing=1
    fi

    # Check for age (required)
    if command -v age &> /dev/null; then
        local age_version
        age_version=$(age --version 2>&1 | head -1 || echo "unknown")
        echo "  age: ${age_version}"
    else
        error "  age: NOT FOUND"
        echo "    Install with: brew install age"
        echo "    Or: go install filippo.io/age/cmd/age@latest"
        missing=1
    fi

    # Check for age-keygen (required, usually bundled with age)
    if ! command -v age-keygen &> /dev/null; then
        error "  age-keygen: NOT FOUND (usually installed with age)"
        missing=1
    fi

    # Check for jq (required for JSON manipulation)
    if command -v jq &> /dev/null; then
        local jq_version
        jq_version=$(jq --version 2>&1 || echo "unknown")
        echo "  jq: ${jq_version}"
    else
        error "  jq: NOT FOUND"
        echo "    Install with: brew install jq"
        missing=1
    fi

    # Check for yq (optional but helpful for YAML)
    if command -v yq &> /dev/null; then
        local yq_version
        yq_version=$(yq --version 2>&1 | head -1 || echo "unknown")
        echo "  yq: ${yq_version} (optional)"
    else
        warn "  yq: not found (optional, for YAML manipulation)"
        echo "    Install with: brew install yq"
    fi

    # Summary
    echo ""
    if [[ ${missing} -eq 1 ]]; then
        error "Missing required dependencies. Please install them first."
        return 1
    fi

    log "All required dependencies installed"
    return 0
}

# Backwards compatible alias
check_dependencies() {
    secrets_check_deps "$@"
}

# ============================================================================
# TERMINAL CHECKS - secrets_is_terminal
# ============================================================================

# Check if stdout is a terminal (to prevent piping secrets to files)
# Usage: secrets_is_terminal
# Returns: 0 if stdout is a terminal, 1 if piped/redirected
#
# This is a critical safety function to prevent secrets from being
# accidentally written to files via output redirection.
secrets_is_terminal() {
    if [[ -t 1 ]]; then
        return 0
    else
        return 1
    fi
}

# Enforce terminal-only output for sensitive operations
# Usage: secrets_require_terminal [OPERATION_NAME]
secrets_require_terminal() {
    local operation="${1:-view secrets}"

    if ! secrets_is_terminal; then
        error "Cannot ${operation} when output is piped or redirected"
        error "Secrets must only be displayed in an interactive terminal"
        error "This prevents accidental exposure to log files or other processes"
        exit 1
    fi
}

# Check if stdin is a terminal (for interactive prompts)
secrets_is_interactive() {
    [[ -t 0 ]]
}

# ============================================================================
# CONFIRMATION PROMPTS - secrets_confirm
# ============================================================================

# Interactive confirmation prompt
# Usage: secrets_confirm PROMPT [default: n]
# Returns: 0 if confirmed (y/Y), 1 if denied
#
# Requires interactive terminal - will fail in non-interactive mode.
secrets_confirm() {
    local prompt="${1:-Continue?}"
    local default="${2:-n}"

    # Must be in interactive terminal
    if ! secrets_is_interactive; then
        error "Cannot prompt for confirmation in non-interactive mode"
        return 1
    fi

    local yn_hint
    if [[ "${default}" == "y" ]]; then
        yn_hint="[Y/n]"
    else
        yn_hint="[y/N]"
    fi

    echo -en "${YELLOW}${prompt}${NC} ${yn_hint} " >&2
    read -r -n 1 response
    echo "" >&2

    # Handle empty response (use default)
    if [[ -z "${response}" ]]; then
        response="${default}"
    fi

    case "${response}" in
        [yY])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Backwards compatible alias
confirm() {
    secrets_confirm "$@"
}

# Destructive operation confirmation (requires typing 'yes')
# Usage: secrets_confirm_destructive MESSAGE
confirm_destructive() {
    local message="${1:-This is a destructive operation.}"

    if ! secrets_is_interactive; then
        error "Cannot prompt for confirmation in non-interactive mode"
        return 1
    fi

    echo "" >&2
    echo -e "${RED}${BOLD}WARNING: ${message}${NC}" >&2
    echo "" >&2
    echo -en "${YELLOW}Type 'yes' to confirm: ${NC}" >&2
    read -r response

    [[ "${response}" == "yes" ]]
}

# Read secret input without echoing to terminal
# Usage: value=$(secrets_read_hidden "Enter value: ")
secrets_read_hidden() {
    local prompt="${1:-Enter value: }"

    if ! secrets_is_interactive; then
        error "Cannot read secret input in non-interactive mode"
        return 1
    fi

    local _secret_value
    read -r -s -p "${prompt}" _secret_value >&2
    echo "" >&2  # Add newline after hidden input
    echo "${_secret_value}"
}

# ============================================================================
# PATH UTILITIES - secrets_get_env_file
# ============================================================================

# Get the path to an environment's encrypted secrets file
# Usage: secrets_get_env_file ENV
# Returns: Full path to the encrypted file (e.g., /path/to/secrets/staging.enc.yaml)
#
# Validates environment name and returns absolute path.
secrets_get_env_file() {
    local env="${1:-staging}"

    # Sanitize environment name (alphanumeric, underscores, hyphens only)
    if [[ ! "${env}" =~ ^[a-zA-Z][a-zA-Z0-9_-]*$ ]]; then
        error "Invalid environment name: ${env}"
        error "Environment names must start with a letter and contain only letters, numbers, underscores, and hyphens"
        return 1
    fi

    local file_path="${SECRETS_DIR}/${env}.enc.yaml"
    echo "${file_path}"
}

# Backwards compatible alias
get_secrets_file() {
    local secrets_dir="$1"
    local env="$2"
    echo "$secrets_dir/$env.enc.yaml"
}

# Check if an encrypted file exists for the environment
secrets_env_exists() {
    local env="${1:-staging}"
    local file_path
    file_path=$(secrets_get_env_file "${env}") || return 1

    [[ -f "${file_path}" ]]
}

# Get the age key file path (with tilde expansion)
secrets_get_key_file() {
    local key_file="${SOPS_AGE_KEY_FILE:-${DEFAULT_AGE_KEY_FILE}}"
    # Expand tilde if present
    key_file="${key_file/#\~/${HOME}}"
    echo "${key_file}"
}

# ============================================================================
# VALIDATION - secrets_validate_pubkey
# ============================================================================

# Validate age public key format
# Usage: secrets_validate_pubkey KEY
# Returns: 0 if valid, 1 if invalid
#
# Age public keys:
# - Start with "age1"
# - Followed by 58 lowercase alphanumeric characters (Bech32 encoding)
# - Total length: 62 characters
secrets_validate_pubkey() {
    local pubkey="${1:-}"

    if [[ -z "${pubkey}" ]]; then
        error "Public key cannot be empty"
        return 1
    fi

    if [[ ! "${pubkey}" =~ ^age1[a-z0-9]{58}$ ]]; then
        error "Invalid age public key format: ${pubkey}"
        echo "Age public keys must:" >&2
        echo "  - Start with 'age1'" >&2
        echo "  - Be exactly 62 characters long" >&2
        echo "  - Contain only lowercase letters and numbers after 'age1'" >&2
        echo "" >&2
        echo "Example: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p" >&2
        return 1
    fi

    return 0
}

# Backwards compatible alias
validate_pubkey() {
    secrets_validate_pubkey "$@"
}

# Validate secret key name (must be UPPERCASE_WITH_UNDERSCORES)
secrets_validate_key_name() {
    local key="${1:-}"

    if [[ -z "${key}" ]]; then
        error "Key name cannot be empty"
        return 1
    fi

    if [[ ! "${key}" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
        error "Invalid key name: ${key}"
        echo "Key names must:" >&2
        echo "  - Start with an uppercase letter" >&2
        echo "  - Contain only uppercase letters, numbers, and underscores" >&2
        echo "" >&2
        echo "Examples: DATABASE_URL, STRIPE_API_KEY, MY_SECRET_123" >&2
        return 1
    fi

    return 0
}

# Backwards compatible alias
validate_key_name() {
    secrets_validate_key_name "$@"
}

# Validate environment name
validate_env() {
    local env="$1"
    case "$env" in
        production|staging|development)
            return 0
            ;;
        *)
            error "Invalid environment: $env"
            echo "Valid environments: production, staging, development" >&2
            return 1
            ;;
    esac
}

# Validate member name (alphanumeric, hyphens, underscores)
secrets_validate_member_name() {
    local name="${1:-}"

    if [[ -z "${name}" ]]; then
        error "Member name cannot be empty"
        return 1
    fi

    if [[ ! "${name}" =~ ^[a-zA-Z][a-zA-Z0-9_-]*$ ]]; then
        error "Invalid member name: ${name}"
        echo "Member names must:" >&2
        echo "  - Start with a letter" >&2
        echo "  - Contain only letters, numbers, underscores, and hyphens" >&2
        return 1
    fi

    return 0
}

# ============================================================================
# TEAM MEMBER FUNCTIONS - secrets_list_members
# ============================================================================

# List current team members from keys directory
# Usage: secrets_list_members
# Outputs: List of member names, one per line
#
# Members are identified by .pub files in keys/public/ directory.
secrets_list_members() {
    local found_members=()

    # List from keys/public directory
    if [[ -d "${KEYS_DIR}" ]]; then
        # Use nullglob to handle empty directory gracefully
        local old_nullglob
        old_nullglob=$(shopt -p nullglob 2>/dev/null || echo "shopt -u nullglob")
        shopt -s nullglob

        for keyfile in "${KEYS_DIR}"/*.pub; do
            if [[ -f "${keyfile}" ]]; then
                local name
                name=$(basename "${keyfile}" .pub)
                found_members+=("${name}")
            fi
        done

        # Restore previous nullglob setting
        eval "${old_nullglob}"
    fi

    # Output unique members sorted
    if [[ ${#found_members[@]} -eq 0 ]]; then
        warn "No team members found in ${KEYS_DIR}"
        echo "" >&2
        echo "Add team members with: just secrets-member-add NAME PUBKEY" >&2
        return 0
    fi

    printf '%s\n' "${found_members[@]}" | sort -u
}

# Get a member's public key
secrets_get_member_pubkey() {
    local name="${1:-}"

    secrets_validate_member_name "${name}" || return 1

    local keyfile="${KEYS_DIR}/${name}.pub"

    if [[ ! -f "${keyfile}" ]]; then
        error "No public key found for member: ${name}"
        return 1
    fi

    cat "${keyfile}"
}

# Check if a member exists
secrets_member_exists() {
    local name="${1:-}"
    local keyfile="${KEYS_DIR}/${name}.pub"
    [[ -f "${keyfile}" ]]
}

# ============================================================================
# AGE KEY MANAGEMENT
# ============================================================================

# Check if the user has an age key configured
check_age_key() {
    log "Checking your age key..."

    local key_file="${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"
    key_file="${key_file/#\~/$HOME}"

    if [[ ! -f "$key_file" ]]; then
        warn "No age key found at $key_file"
        echo ""
        echo "To generate a new key:"
        echo "  mkdir -p ~/.config/sops/age"
        echo "  age-keygen -o ~/.config/sops/age/keys.txt"
        echo "  chmod 600 ~/.config/sops/age/keys.txt"
        echo ""
        echo "Then share your PUBLIC key with the team admin:"
        echo "  grep 'public key' ~/.config/sops/age/keys.txt"
        return 1
    fi

    # Check permissions (macOS and Linux compatible)
    local perms
    perms=$(stat -f "%Lp" "$key_file" 2>/dev/null || stat -c "%a" "$key_file" 2>/dev/null || echo "unknown")
    if [[ "$perms" != "600" && "$perms" != "unknown" ]]; then
        warn "Key file permissions are $perms (should be 600)"
        echo "  Fix with: chmod 600 $key_file"
    fi

    echo "  Key file: $key_file"
    local pubkey
    pubkey=$(grep "public key" "$key_file" 2>/dev/null | cut -d: -f2 | tr -d ' ' || echo "")
    if [[ -n "$pubkey" ]]; then
        echo "  Public key: $pubkey"
    fi

    return 0
}

# Alias
secrets_check_age_key() {
    check_age_key "$@"
}

# Get the user's public key from their age key file
secrets_get_my_pubkey() {
    local key_file
    key_file=$(secrets_get_key_file)

    if [[ ! -f "${key_file}" ]]; then
        error "No age key file found at ${key_file}"
        return 1
    fi

    grep "public key" "${key_file}" | cut -d: -f2 | tr -d ' '
}

# ============================================================================
# SOPS CONFIGURATION
# ============================================================================

# Check if .sops.yaml exists
secrets_has_sops_config() {
    [[ -f "${SOPS_CONFIG}" ]]
}

# Create .sops.yaml template
create_sops_config() {
    local secrets_dir="$1"
    local sops_file="$secrets_dir/.sops.yaml"

    if [[ -f "$sops_file" ]]; then
        log ".sops.yaml already exists"
        return 0
    fi

    # Check for example file to copy from
    if [[ -f "$secrets_dir/.sops.yaml.example" ]]; then
        log "Found .sops.yaml.example - use as template"
        echo ""
        echo "To create .sops.yaml from example:"
        echo "  cp $secrets_dir/.sops.yaml.example $sops_file"
        echo ""
        echo "Then edit to add your team's age public keys."
        return 0
    fi

    log "Creating .sops.yaml template..."

    # Get user's public key if available
    local key_file="${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"
    key_file="${key_file/#\~/$HOME}"
    local pubkey=""

    if [[ -f "$key_file" ]]; then
        pubkey=$(grep "public key" "$key_file" 2>/dev/null | cut -d: -f2 | tr -d ' ' || echo "")
    fi

    # Create template with both naming conventions (flat files and directory-based)
    cat > "$sops_file" << 'EOF'
# SOPS Configuration for secrets encryption
# Documentation: https://github.com/getsops/sops
#
# This configuration supports two naming patterns:
#   1. Flat files: production.enc.yaml, staging.enc.yaml, development.enc.yaml
#   2. Directory-based: prod/*, staging/*, dev/*
#
# Replace RECIPIENT_KEYS_HERE with actual age public keys (comma-separated)
# Example: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p

creation_rules:
  # Production secrets - highest security (flat file pattern)
  - path_regex: production\.enc\.yaml$
    age: >-
      RECIPIENT_KEYS_HERE

  # Production secrets - directory pattern
  - path_regex: ^secrets/.*prod(uction)?/.*$
    age: >-
      RECIPIENT_KEYS_HERE

  # Staging secrets (flat file pattern)
  - path_regex: staging\.enc\.yaml$
    age: >-
      RECIPIENT_KEYS_HERE

  # Staging secrets - directory pattern
  - path_regex: ^secrets/.*stag(ing)?/.*$
    age: >-
      RECIPIENT_KEYS_HERE

  # Development secrets (flat file pattern)
  - path_regex: development\.enc\.yaml$
    age: >-
      RECIPIENT_KEYS_HERE

  # Development secrets - directory pattern
  - path_regex: ^secrets/.*dev(elopment)?/.*$
    age: >-
      RECIPIENT_KEYS_HERE

  # Default rule for any other .enc.yaml files
  - path_regex: .*\.enc\.yaml$
    age: >-
      RECIPIENT_KEYS_HERE
EOF

    if [[ -n "$pubkey" ]]; then
        echo ""
        info "Your public key: $pubkey"
        echo "Add this key to .sops.yaml in the 'age' field for each environment."
    fi

    log "Created $sops_file - edit to add team member keys"
}

# Get all age recipients from .sops.yaml
secrets_get_recipients() {
    if [[ ! -f "${SOPS_CONFIG}" ]]; then
        error ".sops.yaml not found at ${SOPS_CONFIG}"
        return 1
    fi

    # Extract age keys from .sops.yaml
    if command -v yq &> /dev/null; then
        yq '.creation_rules[].age' "${SOPS_CONFIG}" 2>/dev/null | tr -d '"' | tr -d '\n' || true
    else
        # Fallback: grep for age keys
        grep -oE 'age1[a-z0-9]{58}' "${SOPS_CONFIG}" 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//' || true
    fi
}

# ============================================================================
# SECRET OPERATIONS
# ============================================================================

# Ensure secrets file exists, create if not
ensure_secrets_file() {
    local file="$1"
    local env="$2"

    if [[ ! -f "$file" ]]; then
        log "Creating new encrypted secrets file: $(basename "$file")"

        # Create empty YAML structure in temp file
        # IMPORTANT: This temp file is immediately encrypted and deleted
        local tmp_file="${file%.enc.yaml}.tmp.yaml"
        echo "# Encrypted secrets for $env environment" > "$tmp_file"
        echo "# Managed by SOPS + age" >> "$tmp_file"
        echo "" >> "$tmp_file"

        # Encrypt it
        if sops -e "$tmp_file" > "$file" 2>/dev/null; then
            rm -f "$tmp_file"
            log "Created $file"
        else
            rm -f "$tmp_file"
            error "Failed to create encrypted file. Check .sops.yaml configuration."
            exit 1
        fi
    fi
}

# Add a secret to encrypted file
add_secret() {
    local file="$1"
    local key="$2"
    local value="$3"

    # Check if file exists
    if [[ ! -f "$file" ]]; then
        error "Secrets file not found: $file"
        echo "Run 'just secrets-init' first or create the environment file" >&2
        exit 1
    fi

    # Check if key exists
    if sops -d "$file" 2>/dev/null | grep -q "^$key:"; then
        warn "Key '$key' already exists in $(basename "$file")"
        if ! secrets_confirm "Overwrite existing value?"; then
            echo "Aborted."
            exit 0
        fi
    fi

    # Add/update the secret using sops --set
    # IMPORTANT: Never log the value itself
    if sops --set '["'"$key"'"] "'"$value"'"' "$file" 2>/dev/null; then
        log "Added '$key' to $(basename "$file")"
        secrets_log "ADD_SECRET" "${key}" "$(basename "$file")"
    else
        error "Failed to add secret. Check SOPS configuration."
        exit 1
    fi

    # Clear value from bash history if possible
    if [[ -n "${HISTFILE:-}" ]] && command -v history &> /dev/null; then
        history -d "$(history 1 | awk '{print $1}')" 2>/dev/null || true
    fi
}

# View secrets (masked or revealed)
view_secrets() {
    local file="$1"
    local reveal="${2:-false}"

    if [[ ! -f "$file" ]]; then
        error "Secrets file not found: $file"
        exit 1
    fi

    local env_name
    env_name=$(basename "$file" .enc.yaml)

    echo ""
    echo -e "${BOLD}=== SECRETS ($env_name) ===${NC}"
    echo -e "${RED}WARNING: Do not copy secrets to chat, Slack, or email${NC}"
    echo ""

    if [[ "$reveal" == "true" ]] || [[ "$reveal" == "--reveal" ]]; then
        sops -d "$file" 2>/dev/null || {
            error "Failed to decrypt. You may not have access."
            exit 1
        }
    else
        # Mask values (show first 4 chars + ****)
        sops -d "$file" 2>/dev/null | while IFS=: read -r key value; do
            # Skip comments and empty lines
            [[ "$key" =~ ^[[:space:]]*# ]] && continue
            [[ -z "$key" ]] && continue

            value=$(echo "$value" | xargs 2>/dev/null || echo "$value")  # trim whitespace
            local masked
            if [[ ${#value} -gt 8 ]]; then
                masked="${value:0:4}****"
            elif [[ ${#value} -gt 0 ]]; then
                masked="****"
            else
                masked=""
            fi
            echo "$key: $masked"
        done || {
            error "Failed to decrypt. You may not have access."
            exit 1
        }
        echo ""
        info "Use '--reveal' to show full values"
    fi
}

# Rotate a specific secret
rotate_secret() {
    local file="$1"
    local key="$2"

    if [[ ! -f "$file" ]]; then
        error "Secrets file not found: $file"
        exit 1
    fi

    log "Rotating '$key' in $(basename "$file")"
    echo ""

    # Get current value
    local current
    current=$(sops -d "$file" 2>/dev/null | grep "^$key:" | cut -d: -f2- | xargs 2>/dev/null || echo "")
    if [[ -z "$current" ]]; then
        error "Key '$key' not found in $(basename "$file")"
        exit 1
    fi

    # Show masked current value
    local masked
    if [[ ${#current} -gt 8 ]]; then
        masked="${current:0:4}****"
    else
        masked="****"
    fi
    echo "Current value: $masked"
    echo ""

    # Get new value (hidden input)
    local new_value confirm_value
    read -rsp "Enter new value: " new_value
    echo
    read -rsp "Confirm new value: " confirm_value
    echo

    if [[ "$new_value" != "$confirm_value" ]]; then
        error "Values do not match. Aborted."
        # Clear sensitive variables
        unset new_value confirm_value
        exit 1
    fi

    if [[ -z "$new_value" ]]; then
        error "New value cannot be empty. Aborted."
        unset new_value confirm_value
        exit 1
    fi

    # Update the secret
    if sops --set '["'"$key"'"] "'"$new_value"'"' "$file" 2>/dev/null; then
        log "Updated '$key' in $(basename "$file")"
        secrets_log "ROTATE_SECRET" "${key}" "$(basename "$file")"
    else
        error "Failed to update secret."
        unset new_value confirm_value
        exit 1
    fi

    # Clear sensitive variables
    unset new_value confirm_value

    echo ""
    echo -e "${YELLOW}${BOLD}IMPORTANT: Update these external systems:${NC}"
    echo "  [ ] The service/application that uses this credential"
    echo "  [ ] Any backup scripts using this credential"
    echo "  [ ] Monitoring systems with access"
    echo ""
    info "Remember to commit the encrypted file and deploy!"
}

# ============================================================================
# TEAM MEMBER MANAGEMENT
# ============================================================================

# Add a new team member
add_member() {
    local secrets_dir="$1"
    local name="$2"
    local pubkey="$3"

    log "Adding team member: $name"
    echo ""

    # Create keys directory
    mkdir -p "$secrets_dir/keys/public"

    # Check if member already exists
    local keyfile="$secrets_dir/keys/public/$name.pub"
    if [[ -f "$keyfile" ]]; then
        warn "Member '$name' already exists"
        if ! secrets_confirm "Replace existing key?"; then
            echo "Aborted."
            exit 0
        fi
    fi

    # Save public key
    echo "$pubkey" > "$keyfile"
    chmod 644 "$keyfile"
    log "Saved public key to keys/public/$name.pub"

    secrets_log "MEMBER_ADD" "${name}" "${pubkey:0:20}..."

    echo ""
    echo -e "${YELLOW}${BOLD}MANUAL STEP REQUIRED:${NC}"
    echo ""
    echo "Add this key to .sops.yaml in the 'age' field:"
    echo ""
    echo "  $pubkey"
    echo ""
    echo "Then run: sops updatekeys <file>.enc.yaml"
    echo ""

    # Re-encrypt all files if .sops.yaml exists and has been updated
    info "After updating .sops.yaml, re-encrypt secrets with:"
    for env in production staging development; do
        local file="$secrets_dir/$env.enc.yaml"
        if [[ -f "$file" ]]; then
            echo "  sops updatekeys $file --yes"
        fi
    done

    echo ""
    log "Done. Commit changes and push to give $name access."
}

# Remove a team member
remove_member() {
    local secrets_dir="$1"
    local name="$2"

    log "Removing team member: $name"

    local keyfile="$secrets_dir/keys/public/$name.pub"
    if [[ ! -f "$keyfile" ]]; then
        error "Member key file not found: $keyfile"
        exit 1
    fi

    # Show the key being removed
    local pubkey
    pubkey=$(cat "$keyfile")
    echo "Public key: $pubkey"
    echo ""

    if ! confirm_destructive "Remove $name from secrets access?"; then
        echo "Aborted."
        exit 0
    fi

    # Remove the key file
    rm "$keyfile"
    log "Removed $keyfile"

    secrets_log "MEMBER_REMOVE" "${name}" "${pubkey:0:20}..."

    echo ""
    echo -e "${YELLOW}${BOLD}MANUAL STEP REQUIRED:${NC}"
    echo ""
    echo "Remove this key from .sops.yaml:"
    echo ""
    echo "  $pubkey"
    echo ""

    # Re-encrypt instructions
    info "After updating .sops.yaml, re-encrypt secrets with:"
    for env in production staging development; do
        local file="$secrets_dir/$env.enc.yaml"
        if [[ -f "$file" ]]; then
            echo "  sops updatekeys $file --yes"
        fi
    done
}

# Show rotation reminder after member removal
show_rotation_reminder() {
    local name="$1"

    echo ""
    echo -e "${RED}${BOLD}========================================"
    echo "CRITICAL: CREDENTIAL ROTATION REQUIRED"
    echo "========================================${NC}"
    echo ""
    echo -e "${YELLOW}$name has seen all current secrets.${NC}"
    echo ""
    echo "You MUST rotate these credentials:"
    echo ""
    echo "  [ ] All production database passwords"
    echo "  [ ] All API keys (payment processors, email services, etc.)"
    echo "  [ ] All deployment tokens and webhooks"
    echo "  [ ] VPS/server SSH access (separate process)"
    echo ""
    echo "Use: just secrets-rotate KEY [ENV]"
    echo ""
    echo -e "${RED}${BOLD}Rotation deadline: 24 hours for production credentials${NC}"
    echo ""
}

# Alias for design compatibility
secrets_show_rotation_reminder() {
    show_rotation_reminder "$@"
}

# ============================================================================
# VERIFICATION AND TESTING
# ============================================================================

# Verify encrypted files are properly encrypted
verify_encrypted_files() {
    local secrets_dir="$1"
    local errors=0

    log "Verifying encrypted files..."
    echo ""

    for file in "$secrets_dir"/*.enc.yaml; do
        [[ ! -f "$file" ]] && continue

        local filename
        filename=$(basename "$file")

        # Check if file is actually encrypted (contains sops metadata)
        if grep -q "sops:" "$file" 2>/dev/null; then
            # Try to decrypt
            if sops -d "$file" > /dev/null 2>&1; then
                echo -e "  ${GREEN}[OK]${NC} $filename"
            else
                echo -e "  ${YELLOW}[NO ACCESS]${NC} $filename (you may not be a recipient)"
            fi
        else
            echo -e "  ${RED}[NOT ENCRYPTED]${NC} $filename"
            errors=$((errors + 1))
        fi
    done

    # Check for accidentally decrypted files (CRITICAL SAFETY CHECK)
    echo ""
    log "Checking for plaintext files..."

    for pattern in "*.dec.yaml" "*.dec.env" ".env" ".env.*"; do
        for file in "$secrets_dir"/$pattern; do
            [[ ! -f "$file" ]] && continue
            [[ "$file" == *.example ]] && continue
            echo -e "  ${RED}[DANGER]${NC} $(basename "$file") - plaintext file detected!"
            errors=$((errors + 1))
        done
    done

    # Check .sops.yaml exists
    if [[ ! -f "$secrets_dir/.sops.yaml" ]]; then
        echo ""
        echo -e "  ${YELLOW}[MISSING]${NC} .sops.yaml - run 'just secrets-init' to create"
    fi

    echo ""
    if [[ $errors -gt 0 ]]; then
        error "Found $errors issue(s). Please review above."
        return 1
    else
        log "All checks passed."
        return 0
    fi
}

# Test decryption of secrets files
test_decryption() {
    local secrets_dir="$1"
    log "Testing decryption..."

    local found=0
    for env in staging production development; do
        local file="$secrets_dir/$env.enc.yaml"
        if [[ -f "$file" ]]; then
            found=1
            if sops -d "$file" > /dev/null 2>&1; then
                echo -e "  ${GREEN}[OK]${NC} $env.enc.yaml"
            else
                echo -e "  ${YELLOW}[NO ACCESS]${NC} $env.enc.yaml (you may not be a recipient)"
            fi
        fi
    done

    if [[ $found -eq 0 ]]; then
        info "No encrypted secrets files found yet."
        echo "  Create one with: just secrets-add KEY VALUE [ENV]"
    fi
}

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

# Mask a secret value for display (show first 4 chars + ****)
secrets_mask() {
    local value="${1:-}"

    if [[ ${#value} -gt 8 ]]; then
        echo "${value:0:4}****"
    elif [[ ${#value} -gt 0 ]]; then
        echo "****"
    else
        echo ""
    fi
}

# Clear sensitive command from bash history
secrets_clear_history() {
    if [[ -n "${HISTFILE:-}" ]]; then
        history -d "$((HISTCMD-1))" 2>/dev/null || true
    fi
}

# Display a security warning header
secrets_warning_header() {
    echo ""
    echo -e "${YELLOW}${BOLD}========================================${NC}"
    echo -e "${YELLOW}${BOLD}  SECRETS - DO NOT COPY TO CHAT/SLACK  ${NC}"
    echo -e "${YELLOW}${BOLD}========================================${NC}"
    echo ""
}

# Check if running in CI/CD environment
secrets_is_ci() {
    [[ -n "${CI:-}" ]] || \
    [[ -n "${GITHUB_ACTIONS:-}" ]] || \
    [[ -n "${GITLAB_CI:-}" ]] || \
    [[ -n "${JENKINS_URL:-}" ]] || \
    [[ -n "${CIRCLECI:-}" ]] || \
    [[ -n "${TRAVIS:-}" ]]
}

# ============================================================================
# INITIALIZATION
# ============================================================================

# Ensure audit log exists and has correct permissions on library load
if [[ ! -f "${AUDIT_LOG}" ]]; then
    mkdir -p "$(dirname "${AUDIT_LOG}")" 2>/dev/null || true
    touch "${AUDIT_LOG}" 2>/dev/null || true
fi

# Set restrictive permissions on audit log (owner read/write only)
chmod 600 "${AUDIT_LOG}" 2>/dev/null || true
