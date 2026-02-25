#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  smoke-example-app.sh --app <ghost|matrix|wordpress|python-api> --base-url <url>

Examples:
  smoke-example-app.sh --app ghost --base-url https://ghost.example.com
  smoke-example-app.sh --app matrix --base-url https://matrix.example.com
  smoke-example-app.sh --app wordpress --base-url https://wordpress.example.com
  smoke-example-app.sh --app python-api --base-url https://api.example.com
USAGE
}

app=""
base_url=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      app="${2:-}"
      shift 2
      ;;
    --base-url)
      base_url="${2:-}"
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

if [[ -z "$app" || -z "$base_url" ]]; then
  echo "--app and --base-url are required" >&2
  usage >&2
  exit 2
fi

case "$app" in
  ghost)
    "$(dirname "$0")/smoke-http.sh" --url "$base_url/" --expect-status 200 --contains "Ghost"
    ;;
  matrix)
    "$(dirname "$0")/smoke-http.sh" --url "$base_url/_matrix/client/versions" --expect-status 200 --contains "versions"
    ;;
  wordpress)
    "$(dirname "$0")/smoke-http.sh" --url "$base_url/wp-login.php" --expect-status 200 --contains "user_login"
    ;;
  python-api)
    "$(dirname "$0")/smoke-http.sh" --url "$base_url/get" --expect-status 200 --contains "\"url\""
    ;;
  *)
    echo "Unsupported app: $app (supported: ghost, matrix, wordpress, python-api)" >&2
    exit 2
    ;;
esac

echo "Example app smoke passed: app=$app base_url=$base_url"
