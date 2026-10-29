// Password removal (owner approval 2026-10-28, "drop passwords"; sign-in and intents spike §6.3): no user-account
// password path remains in product code. This scans the shipped sources for the removed routes, operations, stored
// fields, request shapes and form inputs. The operator boot principal keeps its own password until the owner answers
// spike N5, so the admin service and the boot console views are the only allowed holders; the password retirement reset
// and the legacy-session refusal name the old fields on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCANNED = ['packages', 'apps/web/src', 'apps/worker', 'apps/node', 'apps/server', 'apps/parlay'];
// The operator boot principal (N5 open) and the code that deliberately recognises or erases legacy password state.
const BOOT = new Set(['packages/identity/admin.mjs', 'packages/identity/crypto.mjs', 'apps/worker/password.mjs', 'apps/web/src/ui/admin-access.mjs', 'apps/web/src/bl/admin-access.mjs', 'apps/web/src/ui/admin-console.mjs', 'apps/web/src/bl/admin-console.mjs', 'apps/web/src/admin-entry.mjs', 'packages/core/abuse-policy.mjs']);
const LEGACY = new Set(['packages/identity/password-retirement.mjs', 'packages/identity/service.mjs', 'packages/runtime/export-contributors.mjs']);
async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!['node_modules', 'vendor', '.output'].includes(entry.name)) yield* files(path); }
    else if (/\.(mjs|js)$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name)) yield path;
  }
}
const RULES = [
  ['removed password routes', /\/api\/auth\/(?:login\/password|password\/pending)/],
  ['removed password operations', /\b(?:loginPassword|setPendingPassword|SetPendingPassword|verifyPendingPassword)\b/],
  ['password projection', /\bhasPassword\b/],
  ['password request shape', /method\s*:\s*['"]password['"]|method\s*===\s*['"]password['"]/],
  ['password form inputs', /(?:current|new)-password/],
  ['stored password fields', /\bpassword(?:Hash|SetAt)\b/],
];

test('no user-account password path remains in product code', async () => {
  const hits = [];
  for (const base of SCANNED) for await (const path of files(join(ROOT, base))) {
    const name = relative(ROOT, path), text = await readFile(path, 'utf8');
    if (BOOT.has(name)) continue;
    for (const [rule, pattern] of RULES) {
      for (const [index, line] of text.split('\n').entries()) {
        if (!pattern.test(line)) continue;
        // Legacy handling (the reset, the export private-key filter, and the service's erasing statements, which the next
        // test pins to deletions only) may name the stored fields.
        if (LEGACY.has(name) && rule === 'stored password fields') continue;
        hits.push(`${name}:${index + 1} ${rule}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

test('the identity service stores no password field and reads none', async () => {
  const text = await readFile(join(ROOT, 'packages/identity/service.mjs'), 'utf8');
  const code = text.split('\n').filter(line => !/^\s*(?:\/\/|\*|\/\*\*)/.test(line)).join('\n');
  const uses = [...code.matchAll(/[^\n;]*\bpassword(?:Hash|SetAt)\b[^\n;]*/g)].map(match => match[0].trim());
  assert.ok(uses.length > 0, 'the erasing statements exist');
  for (const use of uses) assert.match(use, /^delete account\.password(?:Hash|SetAt)$|delete account\.password(?:Hash|SetAt)$/, `only deletions: ${use}`);
});
