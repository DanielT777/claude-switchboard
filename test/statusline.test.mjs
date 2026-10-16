import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {write, read} from '../src/store.mjs';

test('statusline forwards the original payload and captures only account-scoped quota data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-status-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  write(path.join(root, 'statusline-original.json'), {type: 'command', command: 'cat'});
  const input = JSON.stringify({rate_limits: {five_hour: {used_percentage: 42, resets_at: Date.now() / 1000 + 3600}}, unrelated: 'must only reach original statusline'});
  const file = fileURLToPath(new URL('../src/statusline.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [file], {input, encoding: 'utf8', env: {...process.env, SWITCHBOARD_HOME: root, SWITCHBOARD_ACCOUNT_ID: 'system', SWITCHBOARD_ACCOUNT_EMAIL: 'fixture@example.test'}});
  assert.equal(output, input);
  const saved = read(path.join(root, 'usage/system.json'));
  assert.equal(saved.windows.five_hour.used_percentage, 42);
  assert.ok(!JSON.stringify(saved).includes('must only reach'));
});
test('malformed usage never prevents forwarding a valid original statusline payload', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-status-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  write(path.join(root, 'statusline-original.json'), {type: 'command', command: 'cat'});
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../src/statusline.mjs', import.meta.url))], {input: 'not-json', encoding: 'utf8', env: {...process.env, SWITCHBOARD_HOME: root}});
  assert.equal(output, 'not-json');
  assert.equal(fs.existsSync(path.join(root, 'usage/system.json')), false);
});
