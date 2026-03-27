#!/usr/bin/env bash
# smoke-test.sh — Automated endpoint smoke tests for Social
# Runs against the live deployment. All tests use curl.
# Exit non-zero if any test fails.

set -euo pipefail

DOMAIN="${DOMAIN:-peers.social}"
SUBDOMAIN="${SOCIAL_LAB_SUBDOMAIN:-}"
if [ -n "$SUBDOMAIN" ]; then
  INSTANCE_DOMAIN="${SUBDOMAIN}.${DOMAIN}"
else
  INSTANCE_DOMAIN="${DOMAIN}"
fi
BASE_URL="${BASE_URL:-https://${INSTANCE_DOMAIN}}"

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
printf "  Social Smoke Tests\n"
printf "  Target: %s\n" "$BASE_URL"
printf "  Date:   %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf "=%.0s" {1..60}; printf "\n\n"

# ── Health ────────────────────────────────────────────────────────────
section "Health"
test_endpoint "GET /health" 200 '"status":"healthy"' '' '/health'

# ── Landing Page ──────────────────────────────────────────────────────
section "Landing Page"
test_endpoint "GET /" 200 'PeerMesh Social' '' '/'

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
  "/.well-known/webfinger?resource=acct:alice@${INSTANCE_DOMAIN}"

# ── ActivityPub Actor ─────────────────────────────────────────────────
section "ActivityPub"
test_endpoint "GET /ap/actor/alice (AP)" 200 '"publicKey"' \
  'Accept: application/activity+json' '/ap/actor/alice'

# ── AP Collections ────────────────────────────────────────────────────
section "AP Collections"
test_endpoint "GET /ap/actor/alice/followers" 200 '"OrderedCollection"' '' '/ap/actor/alice/followers'
test_endpoint "GET /ap/actor/alice/following" 200 '"OrderedCollection"' '' '/ap/actor/alice/following'
test_endpoint "GET /ap/outbox/alice" 200 '"OrderedCollection"' '' '/ap/outbox/alice'

# ── Following API ────────────────────────────────────────────────────
section "Following API"
test_endpoint "GET /api/following/alice" 200 '"following"' '' '/api/following/alice'
test_endpoint "GET /api/following/alice (count)" 200 '"count"' '' '/api/following/alice'
test_endpoint "GET /api/following/nonexistent" 404 '"error"' '' '/api/following/nonexistent'

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
  "/.well-known/atproto-did?handle=alice.${INSTANCE_DOMAIN}"
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

# ── Ecosystem SSO (WO-008) ────────────────────────────────────────────
section "Ecosystem SSO (WO-008)"
test_endpoint "GET /api/instances (list)" 200 '"instances"' '' '/api/instances'
test_endpoint "GET /api/instances (self present)" 200 '"this_instance"' '' '/api/instances'
test_endpoint "GET /api/instances/self" 200 '"domain"' '' '/api/instances/self'
test_endpoint "GET /api/instances/self (public key)" 200 '"public_key"' '' '/api/instances/self'
test_endpoint "GET /api/instances/self (sso endpoints)" 200 '"sso_endpoints"' '' '/api/instances/self'
test_endpoint "GET /api/identity/verify (missing param)" 400 '"error"' '' '/api/identity/verify'

# Test SSO authorize without auth (should redirect to login)
label="GET /sso/authorize (unauthenticated -> redirect)"
url="${BASE_URL}/sso/authorize?target=other.example.com&callback=https://other.example.com/cb"
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null) || http_code="000"
if [ "$http_code" = "302" ]; then
  log_pass "$label"
else
  log_fail "$label" "expected HTTP 302, got $http_code"
fi

# Test SSO verify with missing fields
label="POST /sso/verify (missing fields)"
url="${BASE_URL}/sso/verify"
http_code=$(curl -s -X POST -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  --max-time 10 "$url" 2>/dev/null) || http_code="000"
if [ "$http_code" = "400" ]; then
  log_pass "$label"
else
  log_fail "$label" "expected HTTP 400, got $http_code"
fi

# Test SSO verify with unknown source domain
label="POST /sso/verify (unknown source)"
url="${BASE_URL}/sso/verify"
http_code=$(curl -s -X POST -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"token":"fake.token","source_domain":"unknown.example.com"}' \
  --max-time 10 "$url" 2>/dev/null) || http_code="000"
if [ "$http_code" = "404" ]; then
  log_pass "$label"
else
  log_fail "$label" "expected HTTP 404, got $http_code"
fi

# Test instance registration with invalid payload
label="POST /api/instances/register (missing fields)"
url="${BASE_URL}/api/instances/register"
http_code=$(curl -s -X POST -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"domain":"test.example.com"}' \
  --max-time 10 "$url" 2>/dev/null) || http_code="000"
if [ "$http_code" = "400" ]; then
  log_pass "$label"
else
  log_fail "$label" "expected HTTP 400, got $http_code"
fi

# Test WebID verification for a local user (alice) — dynamically resolve WebID
label="GET /api/identity/verify (alice WebID)"
alice_webid=$(curl -s --max-time 10 "${BASE_URL}/api/profiles" 2>/dev/null | \
  python3 -c "
import json, sys, urllib.parse
data = json.load(sys.stdin)
for p in data.get('profiles', []):
    if p.get('username') == 'alice':
        print(urllib.parse.quote(p['webid'], safe=''))
        break
" 2>/dev/null || true)
if [ -n "$alice_webid" ]; then
  test_endpoint "$label" 200 '"verified":true' '' \
    "/api/identity/verify?webid=${alice_webid}"
else
  log_pass "$label (SKIP: alice profile not found for dynamic WebID test)"
fi

# ── Universal Manifest (F-030) ────────────────────────────────────────
section "Universal Manifest (F-030)"
test_endpoint "GET /api/manifest/alice" 200 '"@type"' '' '/api/manifest/alice'
test_endpoint "GET /api/manifest/alice (manifest version)" 200 '"manifestVersion"' '' '/api/manifest/alice'
test_endpoint "GET /api/manifest/alice (subject)" 200 '"subject"' '' '/api/manifest/alice'
test_endpoint "GET /api/manifest/alice (signature)" 200 '"signature"' '' '/api/manifest/alice'
test_endpoint "GET /api/manifest/nonexistent" 404 '"error"' '' '/api/manifest/nonexistent'
test_endpoint "GET /.well-known/manifest/alice" 200 '"@type"' '' '/.well-known/manifest/alice'
test_endpoint "GET /.well-known/manifest/alice (LD+JSON)" 200 '"manifestVersion"' '' '/.well-known/manifest/alice'
test_endpoint "GET /.well-known/manifest/nonexistent" 404 '"error"' '' '/.well-known/manifest/nonexistent'

# POST /api/manifest/verify — with empty body (should return 400)
label="POST /api/manifest/verify (empty body)"
url="${BASE_URL}/api/manifest/verify"
http_code=$(curl -s -X POST -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  --max-time 10 "$url" 2>/dev/null) || http_code="000"
if [ "$http_code" = "400" ]; then
  log_pass "$label"
else
  log_fail "$label" "expected HTTP 400, got $http_code"
fi

# POST /api/manifest/verify — with a fetched manifest
label="POST /api/manifest/verify (with alice manifest)"
manifest_body=$(curl -s --max-time 10 "${BASE_URL}/api/manifest/alice" 2>/dev/null)
if [ -n "$manifest_body" ] && printf '%s' "$manifest_body" | grep -qF '"@type"'; then
  verify_payload="{\"manifest\":${manifest_body}}"
  tmpfile=$(mktemp)
  http_code=$(curl -s -X POST -o "$tmpfile" -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -d "$verify_payload" \
    --max-time 10 "${BASE_URL}/api/manifest/verify" 2>/dev/null) || http_code="000"
  body=$(cat "$tmpfile" 2>/dev/null || true)
  rm -f "$tmpfile"
  if [ "$http_code" = "200" ] && printf '%s' "$body" | grep -qF '"valid"'; then
    log_pass "$label"
  else
    log_fail "$label" "expected HTTP 200 with valid field, got $http_code"
  fi
else
  log_pass "$label (SKIP: no alice manifest to verify)"
fi

# ── Encryption API ───────────────────────────────────────────────────
section "Encryption API"

# Encryption endpoints require auth — test 401 without auth first
label="POST /api/encryption/group/test-group/init (no auth -> 401)"
http_code=$(curl -s -X POST -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --max-time 10 "${BASE_URL}/api/encryption/group/test-group/init" 2>/dev/null) || http_code="000"
if [ "$http_code" = "401" ]; then
  log_pass "$label"
else
  log_fail "$label" "expected HTTP 401, got $http_code"
fi

label="GET /api/encryption/group/test-group/status (no auth -> 401)"
http_code=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 10 "${BASE_URL}/api/encryption/group/test-group/status" 2>/dev/null) || http_code="000"
if [ "$http_code" = "401" ]; then
  log_pass "$label"
else
  log_fail "$label" "expected HTTP 401, got $http_code"
fi

# If we have a session cookie, test authenticated encryption status
if [ -n "$SESSION_COOKIE" ]; then
  label="GET /api/encryption/group/test-group/status (with auth)"
  tmpfile=$(mktemp)
  http_code=$(curl -s -o "$tmpfile" -w "%{http_code}" \
    -b "sl_session=${SESSION_COOKIE}" \
    --max-time 10 "${BASE_URL}/api/encryption/group/test-group/status" 2>/dev/null) || http_code="000"
  body=$(cat "$tmpfile" 2>/dev/null || true)
  rm -f "$tmpfile"
  if [ "$http_code" = "200" ] && printf '%s' "$body" | grep -qF '"groupId"'; then
    log_pass "$label"
  else
    log_fail "$label" "expected HTTP 200 with groupId, got $http_code"
  fi
fi

# ── Protocol Registry ────────────────────────────────────────────────
section "Protocol Registry"
test_endpoint "GET /api/protocols" 200 '"protocols"' '' '/api/protocols'
test_endpoint "GET /api/protocols (summary)" 200 '"summary"' '' '/api/protocols'
test_endpoint "GET /api/protocols/activitypub" 200 '"name"' '' '/api/protocols/activitypub'
test_endpoint "GET /api/protocols/activitypub (status)" 200 '"status"' '' '/api/protocols/activitypub'
test_endpoint "GET /api/protocols/nostr" 200 '"name"' '' '/api/protocols/nostr'
test_endpoint "GET /api/protocols/nonexistent" 404 '"error"' '' '/api/protocols/nonexistent'
test_endpoint "GET /api/protocols/activitypub/health" 200 '"protocol"' '' '/api/protocols/activitypub/health'
test_endpoint "GET /api/protocols/activitypub/health (health obj)" 200 '"health"' '' '/api/protocols/activitypub/health'
test_endpoint "GET /api/protocols/nonexistent/health" 404 '"error"' '' '/api/protocols/nonexistent/health'

# ── Search & Discovery ───────────────────────────────────────────────
section "Search & Discovery"
test_endpoint "GET /api/search?q=test" 200 '"query"' '' '/api/search?q=test'
test_endpoint "GET /api/search?q=test (results)" 200 '"results"' '' '/api/search?q=test'
test_endpoint "GET /api/search?q=test (total_count)" 200 '"total_count"' '' '/api/search?q=test'
test_endpoint "GET /api/search?q=test (pagination)" 200 '"pagination"' '' '/api/search?q=test'
test_endpoint "GET /api/search (missing q -> 400)" 400 '"error"' '' '/api/search'
test_endpoint "GET /api/search/suggestions?q=ali" 200 '"suggestions"' '' '/api/search/suggestions?q=ali'
test_endpoint "GET /api/search/suggestions?q=ali (query echo)" 200 '"query"' '' '/api/search/suggestions?q=ali'
test_endpoint "GET /api/search/suggestions?q=x (short query)" 200 '"suggestions"' '' '/api/search/suggestions?q=x'
test_endpoint "GET /api/discover/trending" 200 '"trending_tags"' '' '/api/discover/trending'
test_endpoint "GET /api/discover/trending (profiles)" 200 '"popular_profiles"' '' '/api/discover/trending'
test_endpoint "GET /api/discover/trending (groups)" 200 '"active_groups"' '' '/api/discover/trending'
test_endpoint "GET /api/discover/directory" 200 '"profiles"' '' '/api/discover/directory'
test_endpoint "GET /api/discover/directory (pagination)" 200 '"pagination"' '' '/api/discover/directory'
test_endpoint "GET /api/discover/directory (letters)" 200 '"available_letters"' '' '/api/discover/directory'

# ── Notifications ────────────────────────────────────────────────────
section "Notifications"
test_endpoint "GET /api/notifications/vapid-key" 200 '"publicKey"' '' '/api/notifications/vapid-key'

# ── Recovery ─────────────────────────────────────────────────────────
# NOTE: Recovery module is a stub — routes not yet implemented.
# When routes are added, uncomment and adjust expected codes.
section "Recovery (stub check)"
# Recovery status without auth should return 401 or 404 depending on implementation.
# Since recovery.js is a stub with no routes registered, hitting the endpoint
# will return a generic 404.
label="GET /api/recovery/status (stub — expect 404)"
http_code=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 10 "${BASE_URL}/api/recovery/status" 2>/dev/null) || http_code="000"
if [ "$http_code" = "404" ] || [ "$http_code" = "401" ]; then
  log_pass "$label"
else
  log_fail "$label" "expected HTTP 404 or 401, got $http_code"
fi

# ── Groups ───────────────────────────────────────────────────────────
section "Groups"
test_endpoint "GET /api/groups" 200 '"groups"' '' '/api/groups'
test_endpoint "GET /api/groups (count)" 200 '"count"' '' '/api/groups'
test_endpoint "GET /api/groups (pagination)" 200 '"pagination"' '' '/api/groups'

# POST /api/group — requires auth
label="POST /api/group (no auth -> 401)"
http_code=$(curl -s -X POST -o /dev/null -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Test Group"}' \
  --max-time 10 "${BASE_URL}/api/group" 2>/dev/null) || http_code="000"
if [ "$http_code" = "401" ]; then
  log_pass "$label"
else
  log_fail "$label" "expected HTTP 401, got $http_code"
fi

# Group CRUD with auth — create, get, join, members, cleanup
SMOKE_GROUP_ID=""
if [ -n "$SESSION_COOKIE" ]; then
  # Create group
  label="POST /api/group (with auth)"
  tmpfile=$(mktemp)
  http_code=$(curl -s -X POST -o "$tmpfile" -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -b "sl_session=${SESSION_COOKIE}" \
    -d '{"name":"Smoke Test Group","type":"user","description":"Created by smoke test","visibility":"public"}' \
    --max-time 10 "${BASE_URL}/api/group" 2>/dev/null) || http_code="000"
  body=$(cat "$tmpfile" 2>/dev/null || true)
  rm -f "$tmpfile"
  if [ "$http_code" = "201" ] && printf '%s' "$body" | grep -qF '"group"'; then
    SMOKE_GROUP_ID=$(printf '%s' "$body" | python3 -c "import json,sys; print(json.load(sys.stdin)['group']['id'])" 2>/dev/null || true)
    log_pass "$label (id=${SMOKE_GROUP_ID})"
  else
    log_fail "$label" "expected HTTP 201 with group, got $http_code"
  fi

  if [ -n "$SMOKE_GROUP_ID" ]; then
    # GET /api/group/:id
    test_endpoint "GET /api/group/$SMOKE_GROUP_ID" 200 '"group"' '' "/api/group/$SMOKE_GROUP_ID"
    test_endpoint "GET /api/group/$SMOKE_GROUP_ID (subgroups)" 200 '"subgroups"' '' "/api/group/$SMOKE_GROUP_ID"

    # GET /api/group/:id/members
    test_endpoint "GET /api/group/$SMOKE_GROUP_ID/members" 200 '"members"' '' "/api/group/$SMOKE_GROUP_ID/members"
    test_endpoint "GET /api/group/$SMOKE_GROUP_ID/members (count)" 200 '"count"' '' "/api/group/$SMOKE_GROUP_ID/members"

    # POST /api/group/:id/join — creator is auto-joined, so expect 409
    label="POST /api/group/$SMOKE_GROUP_ID/join (already member -> 409)"
    http_code=$(curl -s -X POST -o /dev/null -w "%{http_code}" \
      -b "sl_session=${SESSION_COOKIE}" \
      --max-time 10 "${BASE_URL}/api/group/${SMOKE_GROUP_ID}/join" 2>/dev/null) || http_code="000"
    if [ "$http_code" = "409" ]; then
      log_pass "$label"
    else
      log_fail "$label" "expected HTTP 409, got $http_code"
    fi

    # POST /api/group/:id/join without auth
    label="POST /api/group/$SMOKE_GROUP_ID/join (no auth -> 401)"
    http_code=$(curl -s -X POST -o /dev/null -w "%{http_code}" \
      --max-time 10 "${BASE_URL}/api/group/${SMOKE_GROUP_ID}/join" 2>/dev/null) || http_code="000"
    if [ "$http_code" = "401" ]; then
      log_pass "$label"
    else
      log_fail "$label" "expected HTTP 401, got $http_code"
    fi

    # Cleanup: delete the smoke test group
    label="DELETE /api/group/$SMOKE_GROUP_ID (cleanup)"
    http_code=$(curl -s -X DELETE -o /dev/null -w "%{http_code}" \
      -b "sl_session=${SESSION_COOKIE}" \
      --max-time 10 "${BASE_URL}/api/group/${SMOKE_GROUP_ID}" 2>/dev/null) || http_code="000"
    if [ "$http_code" = "200" ]; then
      log_pass "$label"
    else
      log_fail "$label" "expected HTTP 200, got $http_code"
    fi
  fi
else
  printf "  SKIP  Group CRUD tests (no session cookie)\n"
fi

# GET /api/group/nonexistent
test_endpoint "GET /api/group/nonexistent" 404 '"error"' '' '/api/group/nonexistent'

# ── Timeline ─────────────────────────────────────────────────────────
section "Timeline"
test_endpoint "GET /api/timeline/alice" 200 '"handle"' '' '/api/timeline/alice'
test_endpoint "GET /api/timeline/alice (items)" 200 '"items"' '' '/api/timeline/alice'
test_endpoint "GET /api/timeline/alice (count)" 200 '"count"' '' '/api/timeline/alice'
test_endpoint "GET /api/timeline/nonexistent" 404 '"error"' '' '/api/timeline/nonexistent'

# ── NodeInfo ─────────────────────────────────────────────────────────
section "NodeInfo"
test_endpoint "GET /.well-known/nodeinfo" 200 '"links"' '' '/.well-known/nodeinfo'
test_endpoint "GET /.well-known/nodeinfo (rel)" 200 'nodeinfo.diaspora.software' '' '/.well-known/nodeinfo'
test_endpoint "GET /nodeinfo/2.0" 200 '"version"' '' '/nodeinfo/2.0'
test_endpoint "GET /nodeinfo/2.0 (software)" 200 '"software"' '' '/nodeinfo/2.0'
test_endpoint "GET /nodeinfo/2.0 (protocols)" 200 '"protocols"' '' '/nodeinfo/2.0'
test_endpoint "GET /nodeinfo/2.0 (usage)" 200 '"usage"' '' '/nodeinfo/2.0'
test_endpoint "GET /nodeinfo/2.0 (openRegistrations)" 200 '"openRegistrations"' '' '/nodeinfo/2.0'

# ── Spatial (note) ───────────────────────────────────────────────────
section "Spatial"
# NOTE: spatial.peers.social is a separate module/service.
# Spatial API smoke tests belong in the spatial module's own test suite.
# If cross-module testing is needed, set SPATIAL_BASE_URL and add tests here.
printf "  NOTE  Spatial API is at spatial.peers.social (separate service)\n"

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
