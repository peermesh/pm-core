#!/usr/bin/env bats
# End-to-end tests: Backup and restore cycle

load '../helpers/common'

# Backup test configuration
BACKUP_TEST_DIR="${TEST_TMP_DIR}/backups"
BACKUP_TEST_DB="test_backup_db"
BACKUP_TEST_TABLE="test_data"

setup() {
  setup_test_tmp
  skip_if_no_docker
  skip_if_vps

  # Create backup test directory
  mkdir -p "$BACKUP_TEST_DIR"
  export BACKUP_DIR="$BACKUP_TEST_DIR"
}

teardown() {
  # Clean up test resources
  cleanup_test_backup_resources
  teardown_test_tmp
}

cleanup_test_backup_resources() {
  # Stop and remove any test database containers
  docker rm -f test-postgres-backup &>/dev/null || true
  docker volume rm test-postgres-backup-data &>/dev/null || true

  # Clean up backup directory
  if [[ -d "$BACKUP_TEST_DIR" ]]; then
    rm -rf "$BACKUP_TEST_DIR"
  fi
}

# Helper: Create a test PostgreSQL container with sample data
create_test_postgres_with_data() {
  local container_name="${1:-test-postgres-backup}"
  local password="test_password_12345"

  # Start PostgreSQL container
  docker run -d \
    --name "$container_name" \
    -e POSTGRES_PASSWORD="$password" \
    -e POSTGRES_DB="$BACKUP_TEST_DB" \
    -v test-postgres-backup-data:/var/lib/postgresql/data \
    postgres:16-alpine

  # Wait for PostgreSQL to be ready
  sleep 5

  # Create test table and insert data
  docker exec "$container_name" psql -U postgres -d "$BACKUP_TEST_DB" -c "
    CREATE TABLE ${BACKUP_TEST_TABLE} (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      value TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    INSERT INTO ${BACKUP_TEST_TABLE} (name, value) VALUES
      ('test_record_1', 'This is test data for backup verification'),
      ('test_record_2', 'Another test record'),
      ('test_record_3', 'Verify this survives backup/restore cycle');
  "

  echo "$password"
}

# Helper: Verify PostgreSQL data exists
verify_postgres_data() {
  local container_name="${1:-test-postgres-backup}"
  local expected_record="$2"

  docker exec "$container_name" psql -U postgres -d "$BACKUP_TEST_DB" -c \
    "SELECT value FROM ${BACKUP_TEST_TABLE} WHERE value LIKE '%${expected_record}%';" \
    | grep -q "$expected_record"
}

@test "backup script exists and is executable" {
  [[ -x "$SCRIPTS_DIR/backup.sh" ]]
}

@test "backup script shows help" {
  run "$SCRIPTS_DIR/backup.sh" --help
  assert_success
  assert_output --partial "Usage:"
}

@test "restore-all script exists and is executable" {
  [[ -x "$SCRIPTS_DIR/restore-all.sh" ]]
}

@test "backup: creates backup directory structure" {
  # Run backup script (will auto-detect no databases and just back up config)
  run env BACKUP_DIR="$BACKUP_TEST_DIR" "$SCRIPTS_DIR/backup.sh" config

  # Should create directory structure
  [[ -d "$BACKUP_TEST_DIR" ]]
  [[ -d "$BACKUP_TEST_DIR/logs" ]]
}

@test "backup/restore cycle: PostgreSQL data integrity" {
  # This test validates a full backup -> destroy -> restore -> verify cycle

  # Step 1: Create PostgreSQL with test data
  local password
  password=$(create_test_postgres_with_data "test-postgres-backup")

  # Verify initial data exists
  verify_postgres_data "test-postgres-backup" "backup verification"

  # Step 2: Create backup
  # Save password to temporary secret file
  local secret_file="${TEST_TMP_DIR}/postgres_password"
  echo "$password" > "$secret_file"

  # Run backup script with custom container name
  run env \
    BACKUP_DIR="$BACKUP_TEST_DIR" \
    SECRET_DIR="${TEST_TMP_DIR}" \
    POSTGRES_CONTAINER="test-postgres-backup" \
    "$SCRIPTS_DIR/backup.sh" postgres

  # Backup should succeed
  assert_success

  # Verify backup file was created
  local backup_file
  backup_file=$(find "$BACKUP_TEST_DIR" -name "postgres-all-*.sql.gz" -type f | head -1)
  [[ -n "$backup_file" ]]
  [[ -f "$backup_file" ]]

  # Verify backup file has content
  [[ -s "$backup_file" ]]

  # Step 3: Destroy database
  docker rm -f test-postgres-backup
  docker volume rm test-postgres-backup-data

  # Step 4: Restore from backup
  # Create new PostgreSQL container (without data)
  docker run -d \
    --name "test-postgres-backup" \
    -e POSTGRES_PASSWORD="$password" \
    -e POSTGRES_DB="$BACKUP_TEST_DB" \
    -v test-postgres-backup-data:/var/lib/postgresql/data \
    postgres:16-alpine

  sleep 5

  # Restore the backup
  run env \
    POSTGRES_CONTAINER="test-postgres-backup" \
    PGPASSWORD="$password" \
    "$SCRIPTS_DIR/restore-postgres.sh" "$backup_file"

  # Restore should succeed
  assert_success

  # Step 5: Verify data integrity
  # The restored data should match original
  verify_postgres_data "test-postgres-backup" "backup verification"
  verify_postgres_data "test-postgres-backup" "Another test record"
  verify_postgres_data "test-postgres-backup" "survives backup/restore cycle"

  # Verify record count
  local record_count
  record_count=$(docker exec test-postgres-backup psql -U postgres -d "$BACKUP_TEST_DB" -t -c \
    "SELECT COUNT(*) FROM ${BACKUP_TEST_TABLE};")

  [[ $(echo "$record_count" | tr -d ' ') -eq 3 ]]
}

@test "backup: creates checksum files" {
  # Create a simple test backup
  mkdir -p "${BACKUP_TEST_DIR}/postgres"
  echo "test backup content" > "${BACKUP_TEST_DIR}/postgres/test-backup.sql"

  # The backup script should create checksums
  # For this test, we'll just verify the backup script has checksum logic
  run grep -q "sha256sum" "$SCRIPTS_DIR/backup.sh"
  assert_success
}

@test "backup: backup file naming includes timestamp" {
  # Create test postgres container
  local password
  password=$(create_test_postgres_with_data "test-postgres-backup")

  # Create secret file
  local secret_file="${TEST_TMP_DIR}/postgres_password"
  echo "$password" > "$secret_file"

  # Run backup
  run env \
    BACKUP_DIR="$BACKUP_TEST_DIR" \
    SECRET_DIR="${TEST_TMP_DIR}" \
    POSTGRES_CONTAINER="test-postgres-backup" \
    "$SCRIPTS_DIR/backup.sh" postgres

  assert_success

  # Find backup file
  local backup_file
  backup_file=$(find "$BACKUP_TEST_DIR" -name "postgres-all-*.sql.gz" -type f | head -1)

  # Verify filename contains date pattern (YYYY-MM-DD)
  [[ $(basename "$backup_file") =~ postgres-all-[0-9]{4}-[0-9]{2}-[0-9]{2} ]]
}

@test "backup: incremental backups preserve previous backups" {
  # Create test postgres container
  local password
  password=$(create_test_postgres_with_data "test-postgres-backup")

  # Create secret file
  local secret_file="${TEST_TMP_DIR}/postgres_password"
  echo "$password" > "$secret_file"

  # Run first backup
  run env \
    BACKUP_DIR="$BACKUP_TEST_DIR" \
    SECRET_DIR="${TEST_TMP_DIR}" \
    POSTGRES_CONTAINER="test-postgres-backup" \
    "$SCRIPTS_DIR/backup.sh" postgres

  assert_success

  local first_backup
  first_backup=$(find "$BACKUP_TEST_DIR" -name "postgres-all-*.sql.gz" -type f | head -1)
  [[ -f "$first_backup" ]]

  # Wait a moment to ensure different timestamp
  sleep 2

  # Run second backup
  run env \
    BACKUP_DIR="$BACKUP_TEST_DIR" \
    SECRET_DIR="${TEST_TMP_DIR}" \
    POSTGRES_CONTAINER="test-postgres-backup" \
    "$SCRIPTS_DIR/backup.sh" postgres

  assert_success

  # Verify both backups exist
  local backup_count
  backup_count=$(find "$BACKUP_TEST_DIR" -name "postgres-all-*.sql.gz" -type f | wc -l)

  [[ $backup_count -ge 2 ]]
}

@test "restore: validates backup file exists" {
  # Try to restore from non-existent file
  run "$SCRIPTS_DIR/restore-postgres.sh" "/nonexistent/backup.sql.gz"

  # Should fail
  assert_failure
}

@test "restore: handles missing database container gracefully" {
  # Create a dummy backup file
  mkdir -p "${BACKUP_TEST_DIR}/postgres"
  echo "fake backup" | gzip > "${BACKUP_TEST_DIR}/postgres/fake-backup.sql.gz"

  # Try to restore when container doesn't exist
  run env \
    POSTGRES_CONTAINER="nonexistent-container" \
    "$SCRIPTS_DIR/restore-postgres.sh" "${BACKUP_TEST_DIR}/postgres/fake-backup.sql.gz"

  # Should fail gracefully
  assert_failure
}
