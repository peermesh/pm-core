#!/bin/bash
# ==============================================================
# MongoDB Initialization Script
# ==============================================================
# Phase 1: Bootstrap - Create application users and databases
# Executes: First container start with empty data volume ONLY
#
# This script:
# - Creates application-specific database and user
# - Reads passwords from Docker secrets (NEVER hardcoded)
# - Sets up indexes for common query patterns
# - Is idempotent (safe to run multiple times conceptually,
#   but Docker only runs it on empty volumes)
#
# Per D2.3: Two-phase initialization model
# Per D3.1: File-based secrets pattern
# ==============================================================

set -e

echo "=========================================="
echo "MongoDB Initialization Script"
echo "=========================================="

# ==============================================================
# Read Secrets from Mounted Files
# ==============================================================
# CRITICAL: Never hardcode passwords. Always read from secrets.

# LibreChat MongoDB password
if [[ -f /run/secrets/librechat_mongo_password ]]; then
    LIBRECHAT_PASSWORD=$(cat /run/secrets/librechat_mongo_password)
    echo "[OK] Read librechat_mongo_password from secrets"
else
    echo "[ERROR] librechat_mongo_password secret not mounted at /run/secrets/"
    echo "        Ensure the secret is defined in docker-compose.yml"
    exit 1
fi

# Root password for authentication
# During init, MONGO_INITDB_ROOT_PASSWORD may be set from _FILE automatically
if [[ -f /run/secrets/mongodb_root_password ]]; then
    ROOT_PASSWORD=$(cat /run/secrets/mongodb_root_password)
    echo "[OK] Read mongodb_root_password from secrets"
elif [[ -n "${MONGO_INITDB_ROOT_PASSWORD:-}" ]]; then
    ROOT_PASSWORD="$MONGO_INITDB_ROOT_PASSWORD"
    echo "[OK] Using MONGO_INITDB_ROOT_PASSWORD from environment"
else
    echo "[ERROR] No root password available"
    echo "        Set MONGO_INITDB_ROOT_PASSWORD_FILE or MONGO_INITDB_ROOT_PASSWORD"
    exit 1
fi

# ==============================================================
# Create LibreChat Database and User
# ==============================================================
# LibreChat requires:
# - A dedicated database for conversation storage
# - A user with readWrite and dbAdmin permissions
# - Indexes on common query patterns

echo ""
echo "Creating LibreChat database and user..."

mongosh \
    --username "${MONGO_INITDB_ROOT_USERNAME:-mongo}" \
    --password "$ROOT_PASSWORD" \
    --authenticationDatabase admin \
    --quiet \
    <<EOF
// ============================================================
// LibreChat Database Setup
// ============================================================

// Switch to librechat database (creates if doesn't exist)
db = db.getSiblingDB('librechat');

// Check if user already exists (idempotency check)
var existingUser = db.getUser('librechat');
if (!existingUser) {
    print('[INFO] Creating librechat user...');
    db.createUser({
        user: 'librechat',
        pwd: '$LIBRECHAT_PASSWORD',
        roles: [
            { role: 'readWrite', db: 'librechat' },
            { role: 'dbAdmin', db: 'librechat' }
        ]
    });
    print('[OK] Created librechat user');
} else {
    print('[SKIP] librechat user already exists');
}

// ============================================================
// Create Indexes for Common LibreChat Queries
// ============================================================
// These indexes are safe to create multiple times (MongoDB handles idempotently)

print('[INFO] Creating indexes...');

// Conversations: Query by user, sort by update time
db.conversations.createIndex(
    { 'userId': 1, 'updatedAt': -1 },
    { name: 'idx_user_updated' }
);
print('[OK] Created conversations userId+updatedAt index');

// Messages: Query by conversation, sort by creation time
db.messages.createIndex(
    { 'conversationId': 1, 'createdAt': 1 },
    { name: 'idx_conversation_created' }
);
print('[OK] Created messages conversationId+createdAt index');

// Users: Unique email lookup
db.users.createIndex(
    { 'email': 1 },
    { unique: true, sparse: true, name: 'idx_email_unique' }
);
print('[OK] Created users email unique index');

// Additional useful indexes for LibreChat
db.messages.createIndex(
    { 'messageId': 1 },
    { unique: true, sparse: true, name: 'idx_message_id' }
);
print('[OK] Created messages messageId unique index');

db.conversations.createIndex(
    { 'conversationId': 1 },
    { unique: true, sparse: true, name: 'idx_conversation_id' }
);
print('[OK] Created conversations conversationId unique index');

print('');
print('============================================');
print('MongoDB initialization complete');
print('============================================');
EOF

echo ""
echo "=========================================="
echo "Initialization Complete"
echo "=========================================="
echo ""
echo "Created:"
echo "  - Database: librechat"
echo "  - User: librechat (readWrite, dbAdmin)"
echo "  - Indexes: 5 indexes for common query patterns"
echo ""
echo "Connection string for LibreChat:"
echo "  mongodb://librechat:<password>@mongodb:27017/librechat"
echo ""
