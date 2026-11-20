#!/usr/bin/env node
/**
 * Master E2E Test Suite Runner for Leostryx Aether Architecture Integration
 * Runs Tiers 1-4 using Node.js native test runner.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testFiles = [
  'tier1_features.test.mjs',
  'tier2_boundaries.test.mjs',
  'tier3_pairwise.test.mjs',
  'tier4_scenarios.test.mjs'
];

console.log('================================================================');
console.log('Leostryx Aether Architecture Integration: E2E Test Suite Runner');
console.log('================================================================\n');

let totalPass = 0;
let totalFail = 0;
let hasError = false;

async function runTestFile(file) {
  const filePath = join(__dirname, file);
  return new Promise((resolve) => {
    console.log(`▶ Executing ${file}...`);
    const proc = spawn('node', ['--test', filePath], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      // Parse output for test counts
      const passMatch = stdout.match(/ℹ pass (\d+)/);
      const failMatch = stdout.match(/ℹ fail (\d+)/);
      const passCount = passMatch ? parseInt(passMatch[1], 10) : 0;
      const failCount = failMatch ? parseInt(failMatch[1], 10) : (code !== 0 ? 1 : 0);

      totalPass += passCount;
      totalFail += failCount;

      if (code === 0 && failCount === 0) {
        console.log(`✔ ${file}: ALL ${passCount} TESTS PASSED\n`);
      } else {
        console.error(`✖ ${file} FAILED (Exit Code ${code})`);
        if (stderr) console.error(stderr);
        console.error(stdout);
        hasError = true;
      }
      resolve();
    });
  });
}

async function main() {
  const startTime = Date.now();
  for (const file of testFiles) {
    await runTestFile(file);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('================================================================');
  console.log('E2E TEST SUITE EXECUTION SUMMARY');
  console.log('================================================================');
  console.log(`Total Tests Run:    ${totalPass + totalFail}`);
  console.log(`Total Passed:       ${totalPass}`);
  console.log(`Total Failed:       ${totalFail}`);
  console.log(`Execution Time:     ${duration}s`);
  console.log('Status:             ' + (hasError ? 'FAILURE' : '100% PASS - ALL CRITERIA SATISFIED'));
  console.log('================================================================\n');

  if (hasError) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
