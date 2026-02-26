#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  smoke-http.sh --url <url> [--expect-status <code>] [--contains <text>] [--timeout <seconds>]

Examples:
  smoke-http.sh --url http://localhost --expect-status 200
  smoke-http.sh --url https://example.com/health --expect-status 200 --contains ok
USAGE
}

url=""
expected_status="200"
contains_text=""
timeout_seconds="15"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      url="${2:-}"
      shift 2
      ;;
    --expect-status)
      expected_status="${2:-}"
      shift 2
      ;;
    --contains)
      contains_text="${2:-}"
      shift 2
      ;;
    --timeout)
      timeout_seconds="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$url" ]]; then
  echo "--url is required" >&2
  usage >&2
  exit 2
fi

response_body="$(mktemp)"
trap 'rm -f "$response_body"' EXIT

actual_status="$(curl -sS --max-time "$timeout_seconds" -o "$response_body" -w '%{http_code}' "$url")"

if [[ "$actual_status" != "$expected_status" ]]; then
  echo "Smoke check failed: expected status $expected_status, got $actual_status for $url" >&2
  exit 1
fi

if [[ -n "$contains_text" ]]; then
  if ! grep -Fq "$contains_text" "$response_body"; then
    echo "Smoke check failed: response from $url does not contain expected text: $contains_text" >&2
    exit 1
  fi
fi

echo "Smoke check passed: $url status=$actual_status"
