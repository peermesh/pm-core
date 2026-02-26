#!/usr/bin/env bats
# ==============================================================================
# Integration Test: Deploy Flow Blueprint Alignment
# ==============================================================================
# Tests the complete deployment flow according to Blueprint B-FLOW-001
# Validates all phases: preflight, backup, deployment, health, rollback
# ==============================================================================

load '../helpers/common'

# Setup runs before each test
setup() {
    export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../.."
    export DEPLOY_SCRIPT="${PROJECT_ROOT}/scripts/deploy.sh"
    export TEST_EVIDENCE_ROOT="${BATS_TEST_TMPDIR}/pmdl-deploy-evidence"
    export BACKUP_DIR="${BATS_TEST_TMPDIR}/pmdl-backups"

    # Create test evidence directory
    mkdir -p "$TEST_EVIDENCE_ROOT"
    mkdir -p "$BACKUP_DIR"

    # Ensure deploy.sh is executable
    chmod +x "$DEPLOY_SCRIPT"
}

# Teardown runs after each test
teardown() {
    # Clean up test evidence
    rm -rf "$TEST_EVIDENCE_ROOT"
    rm -rf "$BACKUP_DIR"
}

@test "deploy.sh exists and is executable" {
    [ -x "$DEPLOY_SCRIPT" ]
}

@test "deploy.sh --help shows usage" {
    run "$DEPLOY_SCRIPT" --help
    assert_success
    assert_output --partial "Usage:"
    assert_output --partial "OPTIONS"
}

@test "deploy.sh --validate runs preflight checks" {
    skip "Requires .env and secrets setup"

    run "$DEPLOY_SCRIPT" --validate --evidence-root "$TEST_EVIDENCE_ROOT"

    # Should exit 0 or 1 (not crash)
    [ "$status" -eq 0 ] || [ "$status" -eq 1 ]

    # Should create evidence bundle
    [ -d "$TEST_EVIDENCE_ROOT" ]
}

@test "deploy.sh creates evidence bundle structure" {
    skip "Requires .env and secrets setup"

    run "$DEPLOY_SCRIPT" --validate --evidence-root "$TEST_EVIDENCE_ROOT"

    # Evidence directory should exist with timestamp pattern
    local evidence_dir
    evidence_dir=$(find "$TEST_EVIDENCE_ROOT" -maxdepth 1 -type d -name "*-operator-dev" | head -1)

    [ -n "$evidence_dir" ]
    [ -f "$evidence_dir/manifest.env" ]
    [ -f "$evidence_dir/gates.tsv" ]
}

@test "deploy.sh validates promotion policy" {
    skip "Requires .env and secrets setup"

    # Staging without --promotion-from should fail
    run "$DEPLOY_SCRIPT" --validate --environment staging --evidence-root "$TEST_EVIDENCE_ROOT"

    assert_failure
    assert_output --partial "Promotion to staging requires --promotion-from dev"
}

@test "deploy.sh records all gate phases in gates.tsv" {
    skip "Requires .env and secrets setup"

    run "$DEPLOY_SCRIPT" --validate --evidence-root "$TEST_EVIDENCE_ROOT"

    local evidence_dir
    evidence_dir=$(find "$TEST_EVIDENCE_ROOT" -maxdepth 1 -type d -name "*-operator-dev" | head -1)

    [ -f "$evidence_dir/gates.tsv" ]

    # Check that gates file contains expected phases
    grep -q "promotion-readiness" "$evidence_dir/gates.tsv"
    grep -q "supply-chain-baseline" "$evidence_dir/gates.tsv"
}

@test "deploy.sh phase logging includes timestamps" {
    skip "Requires .env and secrets setup"

    run "$DEPLOY_SCRIPT" --validate --evidence-root "$TEST_EVIDENCE_ROOT"

    # Should see phase markers in output
    echo "$output" | grep -q "PHASE: INITIALIZATION"
    echo "$output" | grep -q "PHASE: PREFLIGHT VALIDATION"
}

@test "deploy.sh fails on missing prerequisites" {
    # Mock a missing prerequisite check by calling with invalid compose file
    run "$DEPLOY_SCRIPT" --validate -f nonexistent.yml --evidence-root "$TEST_EVIDENCE_ROOT"

    assert_failure
    assert_output --partial "not found"
}

@test "deploy.sh captures rollback pointer" {
    skip "Requires .env and full deployment environment"

    run "$DEPLOY_SCRIPT" --environment dev --evidence-root "$TEST_EVIDENCE_ROOT"

    local evidence_dir
    evidence_dir=$(find "$TEST_EVIDENCE_ROOT" -maxdepth 1 -type d -name "*-operator-dev" | head -1)

    [ -f "$evidence_dir/rollback-pointer.env" ]
    [ -f "$evidence_dir/rollback-plan.md" ]
}

@test "deploy.sh includes pre-deploy backup phase" {
    skip "Requires .env and backup-predeploy.sh"

    run "$DEPLOY_SCRIPT" --environment dev --evidence-root "$TEST_EVIDENCE_ROOT"

    # Check output for backup phase
    echo "$output" | grep -q "PHASE: PRE-DEPLOY BACKUP"

    # Check gates file for backup gate
    local evidence_dir
    evidence_dir=$(find "$TEST_EVIDENCE_ROOT" -maxdepth 1 -type d -name "*-operator-dev" | head -1)

    grep -q "pre-deploy-backup" "$evidence_dir/gates.tsv"
}

@test "deploy.sh creates release evidence summary" {
    skip "Requires .env and secrets setup"

    run "$DEPLOY_SCRIPT" --validate --evidence-root "$TEST_EVIDENCE_ROOT"

    local evidence_dir
    evidence_dir=$(find "$TEST_EVIDENCE_ROOT" -maxdepth 1 -type d -name "*-operator-dev" | head -1)

    [ -f "$evidence_dir/RELEASE-EVIDENCE.md" ]

    # Verify evidence file contains gate status
    grep -q "Gate Status" "$evidence_dir/RELEASE-EVIDENCE.md"
    grep -q "Promotion readiness" "$evidence_dir/RELEASE-EVIDENCE.md"
    grep -q "Supply-chain baseline" "$evidence_dir/RELEASE-EVIDENCE.md"
    grep -q "Pre-deploy backup" "$evidence_dir/RELEASE-EVIDENCE.md"
}

@test "deploy.sh respects --skip-pull flag" {
    skip "Requires .env and running Docker"

    run "$DEPLOY_SCRIPT" --validate --skip-pull --evidence-root "$TEST_EVIDENCE_ROOT"

    # Should not fail due to missing flag
    [ "$status" -eq 0 ] || [ "$status" -eq 1 ]
}

@test "deploy.sh pull phase is buildable-image safe" {
    run grep -n -- '--ignore-buildable' "$DEPLOY_SCRIPT"
    assert_success
}

@test "deploy.sh exits non-zero on validation failure" {
    # Force a validation failure with invalid environment
    run "$DEPLOY_SCRIPT" --validate --environment invalid-env --evidence-root "$TEST_EVIDENCE_ROOT"

    assert_failure
}

@test "deploy.sh supports --profiles flag" {
    skip "Requires .env setup"

    run "$DEPLOY_SCRIPT" --profiles

    assert_success
    # Should show active profiles
}

@test "deploy.sh blueprint reference is present" {
    run "$DEPLOY_SCRIPT" --validate --evidence-root "$TEST_EVIDENCE_ROOT" 2>&1 || true

    # Check that output references the blueprint
    echo "$output" | grep -q "B-FLOW-001" || echo "$output" | grep -q "Blueprint"
}

@test "deploy.sh fail-closed behavior on phase failure" {
    skip "Requires controlled failure scenario"

    # Test that any phase failure exits non-zero
    run "$DEPLOY_SCRIPT" --environment dev --evidence-root "$TEST_EVIDENCE_ROOT"

    # If any gate fails, should exit non-zero
    if [ "$status" -ne 0 ]; then
        # Verify evidence was still captured
        [ -d "$TEST_EVIDENCE_ROOT" ]
    fi
}

@test "deploy.sh includes all B-FLOW-001 contract phases" {
    skip "Requires .env and full deployment"

    run "$DEPLOY_SCRIPT" --environment dev --evidence-root "$TEST_EVIDENCE_ROOT"

    # Verify all phases are present in output
    echo "$output" | grep -q "PHASE: INITIALIZATION"
    echo "$output" | grep -q "PHASE: PREFLIGHT VALIDATION"
    echo "$output" | grep -q "PHASE: PRE-DEPLOY BACKUP"
    echo "$output" | grep -q "PHASE: ROLLBACK PREPARATION"
    echo "$output" | grep -q "PHASE: DEPLOYMENT APPLICATION"
    echo "$output" | grep -q "PHASE: POST-DEPLOY CONFIDENCE CHECKS"
    echo "$output" | grep -q "PHASE: EVIDENCE CAPTURE"
}
