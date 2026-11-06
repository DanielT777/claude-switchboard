import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {write, read} from '../src/store.mjs';

const script = fileURLToPath(new URL('../src/statusline.mjs', import.meta.url));
const env = root => {const e = {...process.env, SWITCHBOARD_HOME: root}; delete e.CLAUDE_CONFIG_DIR; delete e.SWITCHBOARD_CLAUDE_HOME; return e;};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-status-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  write(path.join(root, 'statusline-original.json'), {type: 'command', command: 'cat'});
  write(path.join(root, 'system.json'), {identity: {email: 'fixture@example.test', orgId: 'o'}});
  return root;
}
const payload = (percent, resets) => JSON.stringify({rate_limits: {five_hour: {used_percentage: percent, resets_at: resets}, seven_day: {used_percentage: 1, resets_at: resets + 1}}, unrelated: 'must only reach original statusline'});

test('statusline forwards the original payload and credits the live account with its quota', t => {
  const root = fixture(t), input = payload(42, Math.floor(Date.now() / 1000) + 3600);
  assert.equal(execFileSync(process.execPath, [script], {input, encoding: 'utf8', env: env(root)}), input);
  const saved = read(path.join(root, 'usage/system.json'));
  assert.equal(saved.windows.five_hour.used_percentage, 42);
  assert.equal(saved.email, 'fixture@example.test');
  assert.ok(!JSON.stringify(saved).includes('must only reach'));
});
test('right after a switch, limits still showing the previous account are not credited to the new one', t => {
  const root = fixture(t), resets = Math.floor(Date.now() / 1000) + 3600, perso = '11111111-1111-4111-8111-111111111111';
  write(path.join(root, 'profiles', perso, 'profile.json'), {id: perso, name: 'Perso', identity: {email: 'perso@example.test', orgId: 'p'}});
  write(path.join(root, 'usage/system.json'), {windows: JSON.parse(payload(42, resets)).rate_limits, email: 'fixture@example.test', at: Date.now()});
  write(path.join(root, 'selection.json'), {id: perso, at: Date.now()});
  execFileSync(process.execPath, [script], {input: payload(42, resets), env: env(root)});
  assert.equal(fs.existsSync(path.join(root, 'usage', `${perso}.json`)), false);
  execFileSync(process.execPath, [script], {input: payload(3, resets + 999), env: env(root)});
  assert.equal(read(path.join(root, 'usage', `${perso}.json`)).windows.five_hour.used_percentage, 3);
});
test('malformed usage never prevents forwarding a valid original statusline payload', t => {
  const root = fixture(t);
  assert.equal(execFileSync(process.execPath, [script], {input: 'not-json', encoding: 'utf8', env: env(root)}), 'not-json');
  assert.equal(fs.existsSync(path.join(root, 'usage/system.json')), false);
});
