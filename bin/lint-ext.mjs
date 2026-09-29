// Runs `web-ext lint` on a copy of only the files that ship in the extension. Linting the
// repo root directly would also walk docs/, memory/, editor lock files (.#*) and the like.
//
// web-ext is Mozilla's linter, so it flags things that are wrong for Firefox but fine for
// this Chrome-only extension. Those codes are listed in FIREFOX_ONLY; anything else, error
// or warning, fails the run.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SHIPPED = [
  'manifest.json', 'background.js', 'popup.html', 'popup.js', 'popup.css',
  'shared', 'icons', '_locales',
];

const FIREFOX_ONLY = new Set([
  'BACKGROUND_SERVICE_WORKER_NOFALLBACK', // Firefox wants background.scripts
  'ADDON_ID_REQUIRED',                    // gecko add-on ID
  'MANIFEST_PERMISSIONS',                 // "favicon" is a Chrome-only permission
  'MISSING_DATA_COLLECTION_PERMISSIONS',  // Firefox data-consent key
]);

const dir = mkdtempSync(join(tmpdir(), 'shush-ext-'));
try {
  for (const entry of SHIPPED) cpSync(entry, join(dir, entry), { recursive: true });
  const result = spawnSync(process.execPath,
    ['node_modules/web-ext/bin/web-ext.js', 'lint', '--source-dir', dir, '--output', 'json'],
    { encoding: 'utf8' });
  const start = result.stdout.indexOf('{');
  if (start === -1) {
    console.error(result.stdout, result.stderr);
    process.exitCode = 1;
  } else {
    const report = JSON.parse(result.stdout.slice(start));
    const findings = [...report.errors, ...report.warnings].filter(m => !FIREFOX_ONLY.has(m.code));
    for (const m of findings) console.error(`${m.file ?? ''}:${m.line ?? ''} ${m.code} ${m.message}`);
    console.log(`web-ext lint: ${findings.length} finding(s), ${report.errors.length + report.warnings.length - findings.length} Firefox-only ignored`);
    process.exitCode = findings.length ? 1 : 0;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
