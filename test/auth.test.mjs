import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SWITCHBOARD_LANG = 'fr'; // Assertions below use the French source strings.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-auth-'));
process.env.SWITCHBOARD_HOME = root;
const {setup, write, quote} = await import('../src/store.mjs');
const {auth, usable} = await import('../src/accounts.mjs');
const {startClaude} = await import('../src/cli.mjs');
setup();
const executable = path.join(root, 'claude'), payload = path.join(root, 'auth-fixture.json');
fs.writeFileSync(executable, `#!/bin/sh\ncat ${quote(payload)}\nexit 1\n`, {mode: 0o700});
write(path.join(root, 'config.json'), {binaries: {claude: executable}});
test.after(() => fs.rmSync(root, {recursive: true, force: true}));
test('auth parses the official signed-out exit status without inventing a network error', async () => {
  write(payload, {loggedIn: false});
  assert.equal((await auth({id: 'system'})).loggedIn, false);
  await assert.rejects(usable({id: 'system'}), /Connecte/);
});
test('switch targets require a verified subscription identity', async () => {
  write(payload, {loggedIn: true, authMethod: 'api_key', email: 'a@example.test'});
  await assert.rejects(usable({id: 'system'}), /Connecte/);
  write(payload, {loggedIn: true, authMethod: 'claude.ai'});
  await assert.rejects(usable({id: 'system'}), /identité/);
  write(payload, {loggedIn: true, authMethod: 'claude.ai', email: 'a@example.test'});
  assert.equal((await usable({id: 'system'})).email, 'a@example.test');
});
test('an explicitly requested settings file cannot silently disappear on launch', async () => {
  write(payload, {loggedIn: true, authMethod: 'claude.ai', email: 'a@example.test'});
  await assert.rejects(startClaude('system', {args: ['--settings', path.join(root, 'missing.json')]}), /--settings absent/);
});
