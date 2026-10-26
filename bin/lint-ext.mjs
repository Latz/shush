// Runs `web-ext lint` on a copy of only the files that ship in the extension. Linting the
// repo root directly would also walk docs/, memory/, editor lock files (.#*) and the like.
//
// web-ext is Mozilla's linter, so it flags things that are wrong for Firefox but fine for
// this Chrome-only extension. Those codes are listed in FIREFOX_ONLY; anything else, error
// or warning, fails the run.
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const SHIPPED = [
  'manifest.json', 'background.js', 'popup.html', 'popup.js', 'popup.css',
  'shared', 'icons', '_locales',
];

// A missing entry here is skipped; any other missing file must fail the run.
const OPTIONAL = new Set(['shared', 'icons', '_locales']);

const FIREFOX_ONLY = new Set([
  'BACKGROUND_SERVICE_WORKER_NOFALLBACK', // Firefox wants background.scripts
  'ADDON_ID_REQUIRED',                    // gecko add-on ID
  'MANIFEST_PERMISSIONS',                 // "favicon" is a Chrome-only permission
  'MISSING_DATA_COLLECTION_PERMISSIONS',  // Firefox data-consent key
]);

const dir = mkdtempSync(path.join(tmpdir(), 'shush-ext-'));
try {
  for (const entry of SHIPPED) {
    if (OPTIONAL.has(entry) && !existsSync(entry)) continue;
    cpSync(entry, path.join(dir, entry), { recursive: true });
  }
  // Via npx, not a devDependency: web-ext pulls in node-forge (adb), which has an open
  // high-severity advisory with no fixed release, and that would keep `npm run audit` red.
  // Lint never touches adb or signatures. The pinned version is the one that was installed.
  const result = spawnSync(
    `npx --yes web-ext@10.7.0 lint --source-dir ${JSON.stringify(dir)} --output json`,
    { encoding: 'utf8', shell: true });
  const start = result.stdout.indexOf('{');
  if (start === -1) {
    console.error(result.stdout, result.stderr);
    process.exitCode = 1;
  } else {
    const report = JSON.parse(result.stdout.slice(start));
    const findings = [...report.errors, ...report.warnings].filter(m => !FIREFOX_ONLY.has(m.code));
    for (const m of findings) console.error(`${m.file ?? ''}:${m.line ?? ''} ${m.code} ${m.message}`);
    console.log(`web-ext lint: ${findings.length} finding(s), ${report.errors.length + report.warnings.length - findings.length} Firefox-only ignored`);
    process.exitCode = findings.length > 0 ? 1 : 0;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
