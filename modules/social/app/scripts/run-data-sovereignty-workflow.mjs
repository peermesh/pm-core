#!/usr/bin/env node
// ci/local runner: prints summary, writes json when --json-out is set; exit 1 if workflow fails

import { writeFileSync } from 'node:fs';
import { runDataSovereigntyWorkflow } from '../lib/data-layer/sovereignty-workflow.js';

function parseArgs(argv) {
  let jsonOut = process.env.SOVEREIGNTY_REPORT_JSON || '';
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--json-out' && argv[i + 1]) {
      jsonOut = argv[i + 1];
      i += 1;
    }
  }
  return { jsonOut };
}

const { jsonOut } = parseArgs(process.argv);

const report = await runDataSovereigntyWorkflow();
const body = JSON.stringify(report, null, 2);

if (jsonOut) {
  writeFileSync(jsonOut, `${body}\n`, 'utf8');
  console.log(`[sovereignty] wrote ${jsonOut}`);
}

console.log('[sovereignty] harness', report.harnessVersion);
console.log('[sovereignty] migration.pass', report.migration.pass, report.migration.pathway);
console.log('[sovereignty] delete backends:', report.deleteBehavior.map((d) => `${d.backendId}:${d.classification}:${d.pass ? 'PASS' : 'FAIL'}`).join(' | '));
console.log('[sovereignty] overallPass', report.overallPass);

if (!report.overallPass) {
  process.exitCode = 1;
}
