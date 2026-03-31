#!/usr/bin/env bash
# arch-008 wave 9: data sovereignty baseline (export/migrate/delete report).
# ci: set ARCH008_SOVEREIGNTY_REPORT_DIR or rely on RUNNER_TEMP; requires node 20+ and npm deps in social app.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
core_root="$(cd "$script_dir/../.." && pwd)"
workspace_root="$(cd "$core_root/../.." && pwd)"
app_dir="$core_root/modules/social/app"

if [[ -n "${ARCH008_SOVEREIGNTY_REPORT_DIR:-}" ]]; then
  reports_dir="$ARCH008_SOVEREIGNTY_REPORT_DIR"
elif [[ -d "$workspace_root/.dev/ai" ]]; then
  reports_dir="$workspace_root/.dev/ai/reports"
else
  reports_dir="${RUNNER_TEMP:-/tmp}/arch008-sovereignty-reports"
fi

ts="$(date -u +%Y-%m-%d-%H-%M-%SZ)"
mkdir -p "$reports_dir"
transcript="$reports_dir/${ts}-arch-008-wave9-sovereignty-transcript.txt"
report_json="$reports_dir/${ts}-arch-008-wave9-sovereignty-report.json"
report_md="$reports_dir/${ts}-arch-008-wave9-sovereignty-report.md"

if [[ ! -d "$app_dir" ]]; then
  echo "[sovereignty] error: missing social app $app_dir" >&2
  exit 2
fi

exec > >(tee "$transcript") 2>&1

echo "[sovereignty] app_dir=$app_dir"
echo "[sovereignty] reports_dir=$reports_dir"

cd "$app_dir"

if [[ ! -d node_modules ]]; then
  echo "[sovereignty] npm ci (no node_modules)"
  npm ci
fi

echo "[sovereignty] running node tests: data-layer.sovereignty-workflow.test.js"
node --test test/data-layer.sovereignty-workflow.test.js

echo "[sovereignty] running workflow runner (json -> $report_json)"
node scripts/run-data-sovereignty-workflow.mjs --json-out "$report_json"

echo "[sovereignty] writing markdown summary -> $report_md"
node -e "
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const lines = [
  '# arch-008 wave 9 — data sovereignty workflow',
  '',
  '- harness: ' + j.harnessVersion,
  '- timestamp: ' + j.timestamp,
  '- overallPass: ' + j.overallPass,
  '',
  '## migration (solid -> sql)',
  '',
  '- pathway: ' + j.migration.pathway,
  '- targetImported: ' + j.migration.targetImported,
  '- targetProfileCount: ' + j.migration.targetProfileCount,
  '- checksumMatch: ' + j.migration.checksumMatch,
  '- pass: ' + j.migration.pass,
  '',
  '## delete behavior',
  '',
];
for (const d of j.deleteBehavior) {
  lines.push('- **' + d.backendId + '**: ' + d.classification + ', declaresTrueDeletion=' + d.declaresTrueDeletion + ', readableAfterDelete=' + d.readableAfterDelete + ', pass=' + d.pass);
}
lines.push('', '## artifact', '', '- json: \`' + process.argv[1] + '\`', '');
fs.writeFileSync(process.argv[2], lines.join('\n'));
" "$report_json" "$report_md"

echo "[sovereignty] done. transcript=$transcript"
