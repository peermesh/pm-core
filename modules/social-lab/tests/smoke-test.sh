#!/usr/bin/env bash
# smoke-test.sh — Automated endpoint smoke tests for Social Lab
# Runs against the live deployment. All tests use curl.
# Exit non-zero if any test fails.

set -euo pipefail

BASE_URL="${BASE_URL:-https://social.dockerlab.peermesh.org}"

# ── Counters ──────────────────────────────────────────────────────────
PASS=0
FAIL=0
TOTAL=0
FAILURES=""

# ── Colors (disabled when not a tty) ─────────────────────────────────
if [ -t 1 ]; then
  GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[0;33m"; RESET="\033[0m"
else
  GREEN=""; RED=""; YELLOW=""; RESET=""
fi

# ── Helpers ───────────────────────────────────────────────────────────

section() {
  printf -- '%s\n' "${YELLOW}--- $1 ---${RESET}"
}

log_pass() {
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
  printf -- '%s\n' "${GREEN}PASS${RESET}  $1"
}

log_fail() {
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  FAILURES="${FAILURES}\n  - $1: $2"
  printf -- '%s\n' "${RED}FAIL${RESET}  $1 -- $2"
}

# test_endpoint LABEL METHOD PATH EXPECTED_CODE [EXPECTED_BODY] [EXTRA_HEADERS]
#   EXPECTED_BODY can be empty string to skip body check.
test_endpoint() {
  local label="$1"
  local expected_code="$2"
  local expected_body="${3:-}"
  local extra_header="${4:-}"
  local url="${BASE_URL}${5:-}"

  local curl_args=( -s -o /dev/null -w "%{http_code}\n%{redirect_url}" --max-time 10 )
  if [ -n "$extra_header" ]; then
    curl_args+=( -H "$extra_header" )
  fi

  # We need the body too if checking content
  if [ -n "$expected_body" ]; then
    curl_args=( -s --max-time 10 )
    if [ -n "$extra_header" ]; then
      curl_args+=( -H "$extra_header" )
    fi
    local tmpfile
    tmpfile=$(mktemp)
    local http_code
    http_code=$(curl "${curl_args[@]}" -o "$tmpfile" -w "%{http_code}" "$url" 2>/dev/null) || http_code="000"
    local body
    body=$(cat "$tmpfile" 2>/dev/null || true)
    rm -f "$tmpfile"

    if [ "$http_code" != "$expected_code" ]; then
      log_fail "$label" "expected HTTP $expected_code, got $http_code"
      return
    fi
    if ! printf '%s' "$body" | grep -qF "$expected_body"; then
      log_fail "$label" "body missing '$expected_body'"
      return
    fi
    log_pass "$label"
  else
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
      ${extra_header:+-H "$extra_header"} "$url" 2>/dev/null) || http_code="000"

    if [ "$http_code" != "$expected_code" ]; then
      log_fail "$label" "expected HTTP $expected_code, got $http_code"
      return
    fi
    log_pass "$label"
  fi
}

# test_redirect LABEL PATH HEADER EXPECTED_CODE
#   Checks status code with -L disabled (no follow redirects).
test_redirect() {
  local label="$1"
  local path="$2"
  local header="$3"
  local expected_code="$4"
  local url="${BASE_URL}${path}"

  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    -H "$header" "$url" 2>/dev/null) || http_code="000"

  if [ "$http_code" != "$expected_code" ]; then
    log_fail "$label" "expected HTTP $expected_code, got $http_code"
    return
  fi
  log_pass "$label"
}

# test_signup_and_login — Create account via /signup, capture session cookie + profile ID
#   Sets PROFILE_ID and SESSION_COOKIE for subsequent tests.
PROFILE_ID=""
SESSION_COOKIE=""
SMOKE_HANDLE="smoketest_$$"
SMOKE_USERNAME="smokeuser_$$"

test_signup() {
  local label="POST /signup (create account)"
  local url="${BASE_URL}/signup"
  local header_file
  header_file=$(mktemp)

  local http_code
  http_code=$(curl -s -X POST -o /dev/null -w "%{http_code}" \
    -D "$header_file" \
    -d "displayName=Smoke+Test+User&handle=${SMOKE_HANDLE}&username=${SMOKE_USERNAME}&password=smoketest12345" \
    --max-time 15 "$url" 2>/dev/null) || http_code="000"

  # Extract session cookie from Set-Cookie header
  SESSION_COOKIE=$(grep -i 'set-cookie.*sl_session=' "$header_file" 2>/dev/null | sed 's/.*sl_session=//;s/;.*//' || true)
  rm -f "$header_file"

  if [ "$http_code" != "302" ]; then
    log_fail "$label" "expected HTTP 302, got $http_code"
    return
  fi

  if [ -z "$SESSION_COOKIE" ]; then
    log_fail "$label" "no session cookie received"
    return
  fi

  # Look up profile ID from /api/profiles endpoint
  local profiles_body
  profiles_body=$(curl -s --max-time 10 "${BASE_URL}/api/profiles" 2>/dev/null)
  PROFILE_ID=$(printf '%s' "$profiles_body" | grep -oE "\"id\":\"[^\"]+\"[^}]*\"username\":\"${SMOKE_HANDLE}\"" | head -1 | grep -oE '"id":"[^"]+"' | grep -oE '"[^"]+"\s*$' | tr -d '"' || true)

  if [ -z "$PROFILE_ID" ]; then
    log_fail "$label" "account created but could not find profile for handle ${SMOKE_HANDLE}"
    return
  fi

  log_pass "$label (handle=${SMOKE_HANDLE}, id=${PROFILE_ID})"
}

test_login() {
  local label="POST /login (authenticate)"
  local url="${BASE_URL}/login"
  local header_file
  header_file=$(mktemp)

  local http_code
  http_code=$(curl -s -X POST -o /dev/null -w "%{http_code}" \
    -D "$header_file" \
    -d "username=${SMOKE_USERNAME}&password=smoketest12345" \
    --max-time 10 "$url" 2>/dev/null) || http_code="000"

  local login_cookie
  login_cookie=$(grep -i 'set-cookie.*sl_session=' "$header_file" 2>/dev/null | sed 's/.*sl_session=//;s/;.*//' || true)
  rm -f "$header_file"

  if [ "$http_code" != "302" ]; then
    log_fail "$label" "expected HTTP 302, got $http_code"
    return
  fi

  if [ -n "$login_cookie" ]; then
    SESSION_COOKIE="$login_cookie"
    log_pass "$label"
  else
    log_fail "$label" "no session cookie received"
  fi
}

test_auth_pages() {
  # Verify /login and /signup pages are accessible
  test_endpoint "GET /login" 200 'Log In' '' '/login'
  test_endpoint "GET /signup" 200 'Sign Up' '' '/signup'

  # Verify /studio redirects to /login when not authenticated
  local label="GET /studio (unauthenticated -> redirect)"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    "${BASE_URL}/studio" 2>/dev/null) || http_code="000"
  if [ "$http_code" = "302" ]; then
    log_pass "$label"
  else
    log_fail "$label" "expected HTTP 302, got $http_code"
  fi
}

# ── Banner ────────────────────────────────────────────────────────────
printf "\n"
printf "=%.0s" {1..60}; printf "\n"
printf "  Social Lab Smoke Tests\n"
printf "  Target: %s\n" "$BASE_URL"
printf "  Date:   %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf "=%.0s" {1..60}; printf "\n\n"

# ── Health ────────────────────────────────────────────────────────────
section "Health"
test_endpoint "GET /health" 200 '"status":"healthy"' '' '/health'

# ── Landing Page ──────────────────────────────────────────────────────
section "Landing Page"
test_endpoint "GET /" 200 'PeerMesh Social Lab' '' '/'

# ── Auth ─────────────────────────────────────────────────────────────
section "Authentication"
test_auth_pages
test_signup
test_login

# ── Profile CRUD ──────────────────────────────────────────────────────
section "Profile CRUD"

if [ -n "$PROFILE_ID" ]; then
  test_endpoint "GET /api/profiles" 200 '"profiles"' '' '/api/profiles'
  test_endpoint "GET /api/profile/$PROFILE_ID" 200 '"display_name"' '' "/api/profile/$PROFILE_ID"

  # Verify PUT without auth returns 401
  label="PUT /api/profile/$PROFILE_ID (no auth -> 401)"
  url="${BASE_URL}/api/profile/$PROFILE_ID"
  http_code=$(curl -s -X PUT -o /dev/null -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -d '{"displayName":"Unauthorized"}' \
    --max-time 10 "$url" 2>/dev/null) || http_code="000"
  if [ "$http_code" = "401" ]; then
    log_pass "$label"
  else
    log_fail "$label" "expected HTTP 401, got $http_code"
  fi

  # Update the profile (with auth cookie)
  label="PUT /api/profile/$PROFILE_ID (with auth)"
  url="${BASE_URL}/api/profile/$PROFILE_ID"
  update_payload='{"displayName":"Smoke Test Updated","bio":"Updated by smoke test"}'
  tmpfile=$(mktemp)
  http_code=$(curl -s -X PUT -o "$tmpfile" -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -b "sl_session=${SESSION_COOKIE}" \
    -d "$update_payload" \
    --max-time 10 "$url" 2>/dev/null) || http_code="000"
  body=$(cat "$tmpfile" 2>/dev/null || true)
  rm -f "$tmpfile"
  if [ "$http_code" = "200" ] && printf '%s' "$body" | grep -qF '"display_name"'; then
    log_pass "$label"
  else
    log_fail "$label" "expected HTTP 200 with display_name, got $http_code"
  fi

  # Delete the profile (with auth cookie)
  label="DELETE /api/profile/$PROFILE_ID (with auth)"
  url="${BASE_URL}/api/profile/$PROFILE_ID"
  http_code=$(curl -s -X DELETE -o /dev/null -w "%{http_code}" \
    -b "sl_session=${SESSION_COOKIE}" \
    --max-time 10 "$url" 2>/dev/null) || http_code="000"
  if [ "$http_code" = "204" ] || [ "$http_code" = "200" ]; then
    log_pass "$label"
  else
    log_fail "$label" "expected HTTP 204 or 200, got $http_code"
  fi

  # Verify deleted
  test_endpoint "GET /api/profile/$PROFILE_ID (deleted)" 404 '"error"' '' "/api/profile/$PROFILE_ID"
else
  printf "  SKIP  Profile CRUD tests (no ID captured)\n"
fi

# ── WebFinger ─────────────────────────────────────────────────────────
section "WebFinger"
test_endpoint "GET /.well-known/webfinger" 200 '"subject"' '' \
  '/.well-known/webfinger?resource=acct:alice@social.dockerlab.peermesh.org'

# ── ActivityPub Actor ─────────────────────────────────────────────────
section "ActivityPub"
test_endpoint "GET /ap/actor/alice (AP)" 200 '"publicKey"' \
  'Accept: application/activity+json' '/ap/actor/alice'

# ── AP Collections ────────────────────────────────────────────────────
section "AP Collections"
test_endpoint "GET /ap/actor/alice/followers" 200 '"OrderedCollection"' '' '/ap/actor/alice/followers'
test_endpoint "GET /ap/outbox/alice" 200 '"OrderedCollection"' '' '/ap/outbox/alice'

# ── Nostr ─────────────────────────────────────────────────────────────
section "Nostr"
test_endpoint "GET /.well-known/nostr.json" 200 '"names"' '' \
  '/.well-known/nostr.json?name=alice'

# ── RSS / Atom / JSON Feed ───────────────────────────────────────────
section "Feeds"
test_endpoint "GET /@alice/feed.xml" 200 '<rss' '' '/@alice/feed.xml'
test_endpoint "GET /@alice/feed.atom" 200 '<feed' '' '/@alice/feed.atom'
test_endpoint "GET /@alice/feed.json" 200 '"version"' '' '/@alice/feed.json'

# ── AT Protocol ───────────────────────────────────────────────────────
section "AT Protocol"
test_endpoint "GET /.well-known/atproto-did" 200 'did:web' '' \
  '/.well-known/atproto-did?handle=alice.social.dockerlab.peermesh.org'
test_endpoint "GET /.well-known/did.json" 200 '"did:web:' '' \
  '/.well-known/did.json'

# ── IndieWeb ──────────────────────────────────────────────────────────
section "IndieWeb"
test_endpoint 'GET /@alice (h-card)' 200 'h-card' '' '/@alice'
test_endpoint 'GET /@alice (webmention)' 200 'rel="webmention"' '' '/@alice'
test_endpoint "GET /.well-known/oauth-authorization-server" 200 'authorization_endpoint' '' \
  '/.well-known/oauth-authorization-server'

# ── Content Negotiation ──────────────────────────────────────────────
section "Content Negotiation"
test_redirect "GET /@alice (conneg redirect)" '/@alice' \
  'Accept: application/activity+json' 302

# ── Profile Page ──────────────────────────────────────────────────────
section "Profile Page"
test_endpoint "GET /@alice" 200 'alice' '' '/@alice'

# ── Matrix Identity Bridge ────────────────────────────────────────────
section "Matrix Identity Bridge"
test_endpoint "GET /api/matrix/identity/alice" 200 '"matrix_id"' '' '/api/matrix/identity/alice'
test_endpoint "GET /api/matrix/identity/alice (bridge note)" 200 '"bridge_status"' '' '/api/matrix/identity/alice'
test_endpoint "GET /api/matrix/identity/nonexistent" 404 '"error"' '' '/api/matrix/identity/nonexistent'
test_endpoint "GET /.well-known/matrix/server" 200 '"m.server"' '' '/.well-known/matrix/server'
test_endpoint "GET /.well-known/matrix/client" 200 '"m.homeserver"' '' '/.well-known/matrix/client'

# ── XMTP Identity Bridge ─────────────────────────────────────────────
section "XMTP Identity Bridge"
test_endpoint "GET /api/xmtp/identity/alice" 200 '"bridge_status"' '' '/api/xmtp/identity/alice'
test_endpoint "GET /api/xmtp/identity/nonexistent" 404 '"error"' '' '/api/xmtp/identity/nonexistent'

# ── Profile Page Badges (Matrix + XMTP) ──────────────────────────────
section "Profile Page Badges (Matrix + XMTP)"
test_endpoint "GET /@alice (Matrix badge)" 200 'Matrix' '' '/@alice'
test_endpoint "GET /@alice (XMTP badge)" 200 'XMTP' '' '/@alice'

# ── Blockchain Protocols (Lens + Farcaster) ──────────────────────────
section "Blockchain Protocols"
test_endpoint "GET /api/lens/profile/alice" 200 '"protocol":"lens"' '' '/api/lens/profile/alice'
test_endpoint "GET /api/lens/profile/nonexistent" 404 '"error"' '' '/api/lens/profile/nonexistent'
test_endpoint "GET /api/farcaster/identity/alice" 200 '"protocol":"farcaster"' '' '/api/farcaster/identity/alice'
test_endpoint "GET /api/farcaster/identity/alice (opt-in)" 200 '"optInOnly":true' '' '/api/farcaster/identity/alice'
test_endpoint "GET /api/farcaster/identity/nonexistent" 404 '"error"' '' '/api/farcaster/identity/nonexistent'

# ── Profile Page Badges (Lens + Farcaster) ───────────────────────────
section "Profile Page Badges"
test_endpoint "GET /@alice (Lens badge)" 200 'Lens' '' '/@alice'
test_endpoint "GET /@alice (Farcaster badge)" 200 'Farcaster' '' '/@alice'

# ── DSNP Protocol ─────────────────────────────────────────────────────
section "DSNP Protocol (F-011)"
test_endpoint "GET /api/dsnp/profile/alice" 200 '"dsnpUserId"' '' '/api/dsnp/profile/alice'
test_endpoint "GET /api/dsnp/profile/alice (stub flag)" 200 '"_stub":true' '' '/api/dsnp/profile/alice'
test_endpoint "GET /api/dsnp/profile/alice (cross-protocol)" 200 '"crossProtocolIdentity"' '' '/api/dsnp/profile/alice'
test_endpoint "GET /api/dsnp/graph/alice" 200 '"connections"' '' '/api/dsnp/graph/alice'
test_endpoint "GET /api/dsnp/graph/alice (empty graph)" 200 '"connectionCount":0' '' '/api/dsnp/graph/alice'
test_endpoint "GET /api/dsnp/profile/nonexistent" 404 '"error"' '' '/api/dsnp/profile/nonexistent'
test_endpoint "GET /api/dsnp/graph/nonexistent" 404 '"error"' '' '/api/dsnp/graph/nonexistent'

# ── Zot Protocol ──────────────────────────────────────────────────────
section "Zot Protocol (F-012)"
test_endpoint "GET /api/zot/channel/alice" 200 '"success":true' '' '/api/zot/channel/alice'
test_endpoint "GET /api/zot/channel/alice (guid)" 200 '"guid"' '' '/api/zot/channel/alice'
test_endpoint "GET /api/zot/channel/alice (address)" 200 '"address"' '' '/api/zot/channel/alice'
test_endpoint "GET /api/zot/channel/alice (zot6)" 200 '"protocol":"zot6"' '' '/api/zot/channel/alice'
test_endpoint "GET /api/zot/xchan/alice" 200 '"xchan_hash"' '' '/api/zot/xchan/alice'
test_endpoint "GET /api/zot/xchan/alice (webid)" 200 '"webid"' '' '/api/zot/xchan/alice'
test_endpoint "GET /api/zot/xchan/alice (network)" 200 '"xchan_network":"zot6"' '' '/api/zot/xchan/alice'
test_endpoint "GET /api/zot/channel/nonexistent" 404 '"error"' '' '/api/zot/channel/nonexistent'
test_endpoint "GET /api/zot/xchan/nonexistent" 404 '"error"' '' '/api/zot/xchan/nonexistent'

# ── Profile Page Badges (DSNP + Zot) ─────────────────────────────────
section "Profile Page Badges (DSNP + Zot)"
test_endpoint "GET /@alice (DSNP badge)" 200 'DSNP' '' '/@alice'
test_endpoint "GET /@alice (Zot badge)" 200 'Zot' '' '/@alice'

# ── Data Sync Protocols (Hypercore + Braid) ──────────────────────────
section "Data Sync Protocols (F-013 Hypercore + F-014 Braid)"
test_endpoint "GET /api/hypercore/feed/alice" 200 '"protocol":"hypercore"' '' '/api/hypercore/feed/alice'
test_endpoint "GET /api/hypercore/feed/alice (stub)" 200 '"_stub":true' '' '/api/hypercore/feed/alice'
test_endpoint "GET /api/hypercore/feed/alice (status)" 200 '"status"' '' '/api/hypercore/feed/alice'
test_endpoint "GET /api/hypercore/feed/nonexistent" 404 '"error"' '' '/api/hypercore/feed/nonexistent'
test_endpoint "GET /api/hypercore/status" 200 '"runtime":"not_running"' '' '/api/hypercore/status'
test_endpoint "GET /api/hypercore/status (pear)" 200 '"detected":false' '' '/api/hypercore/status'
test_endpoint "GET /api/hypercore/status (swarm)" 200 '"joined":false' '' '/api/hypercore/status'
test_endpoint "GET /api/braid/version/profile%2Fcard" 200 '"protocol":"braid-http"' '' '/api/braid/version/profile%2Fcard'
test_endpoint "GET /api/braid/version/profile%2Fcard (stub)" 200 '"_stub":true' '' '/api/braid/version/profile%2Fcard'
test_endpoint "GET /api/braid/version/profile%2Fcard (versions)" 200 '"versionCount":0' '' '/api/braid/version/profile%2Fcard'

# ── Profile Page Badges (Hypercore + Braid) ──────────────────────────
section "Profile Page Badges (Hypercore + Braid)"
test_endpoint "GET /@alice (Hypercore badge)" 200 'Hypercore' '' '/@alice'
test_endpoint "GET /@alice (Braid badge)" 200 'Braid' '' '/@alice'

# ── 404s ──────────────────────────────────────────────────────────────
section "404 Handling"
test_endpoint "GET /api/profile/nonexistent" 404 '' '' '/api/profile/nonexistent'
test_endpoint "GET /@nonexistent" 404 '' '' '/@nonexistent'

# ── Summary ───────────────────────────────────────────────────────────
printf "\n"
printf "=%.0s" {1..60}; printf "\n"
printf "  Results: %d passed, %d failed, %d total\n" "$PASS" "$FAIL" "$TOTAL"
if [ "$FAIL" -gt 0 ]; then
  printf -- "  Failures:${FAILURES}\n"
fi
printf "=%.0s" {1..60}; printf "\n\n"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
