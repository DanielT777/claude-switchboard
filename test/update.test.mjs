import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {newer, check, install, VERSION} from '../src/update.mjs';

process.env.SWITCHBOARD_LANG = 'fr'; // Assertions below use the French source strings.

const temp = t => {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-update-')); t.after(() => fs.rmSync(root, {recursive: true, force: true})); return root;};
const json = body => ({ok: true, status: 200, json: async () => body, arrayBuffer: async () => Buffer.from(JSON.stringify(body))});
const bytes = data => ({ok: true, status: 200, arrayBuffer: async () => Buffer.from(data)});
const release = (tag, {sig = true} = {}) => ({tag_name: tag, html_url: `https://github.example/${tag}`, assets: [
  {name: `claude-switchboard-${tag}.tar.gz`, browser_download_url: 'https://dl/archive'},
  {name: `claude-switchboard-${tag}.tar.gz.sha256`, browser_download_url: 'https://dl/sum'},
  ...sig ? [{name: `claude-switchboard-${tag}.tar.gz.sig`, browser_download_url: 'https://dl/sig'}] : []]});
// Throwaway maintainer key: tests never touch the real signing key.
const keys = crypto.generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({type: 'spki', format: 'pem'});
const sign = data => crypto.sign(null, Buffer.from(data), keys.privateKey).toString('base64');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
// Serves a release whose archive, signature and checksum can each be forged independently.
const serve = ({archive = 'archive', signature = sign(archive), sum = sha(archive), sig = true} = {}) => async url =>
  url === 'https://dl/archive' ? bytes(archive) : url === 'https://dl/sig' ? bytes(signature) : url === 'https://dl/sum' ? bytes(`${sum}  file\n`) : json(release('v99.0.0', {sig}));
// Fake tar/node: lists the given entries, extracts an installer, records every command.
const runner = (entries = 'claude-switchboard/\nclaude-switchboard/scripts/install.mjs\n') => {
  const calls = [];
  const run = (file, args) => {
    calls.push([file, ...args]);
    if (args[0] === '-tzf') return {status: 0, stdout: entries};
    if (args[0] === '-xzf') {const dir = path.join(args[3], 'claude-switchboard/scripts'); fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, 'install.mjs'), '');}
    return {status: 0};
  };
  return {calls, run};
};

test('version comparison ignores the v prefix and compares numerically', () => {
  assert.equal(newer('v0.10.0', '0.9.9'), true);
  assert.equal(newer('1.0.0', 'v1.0.0'), false);
  assert.equal(newer('0.2.0', '0.2.1'), false);
  assert.equal(newer('v1', '0.9.0'), true);
});

test('check reports only a newer published release and reuses the cache for six hours', async t => {
  const root = temp(t), now = Date.now();
  let calls = 0;
  const fetchImpl = async () => {calls++; return json(release('v99.0.0'));};
  assert.deepEqual(await check({root, now, fetchImpl}), {latest: 'v99.0.0', url: 'https://github.example/v99.0.0'});
  assert.deepEqual(await check({root, now: now + 60 * 60 * 1000, fetchImpl}), {latest: 'v99.0.0', url: 'https://github.example/v99.0.0'});
  assert.equal(calls, 1);
  assert.equal(await check({root, now: now + 7 * 60 * 60 * 1000, fetchImpl: async () => json(release(`v${VERSION}`))}), null);
  assert.equal(await check({root, now: now + 14 * 60 * 60 * 1000, fetchImpl: async () => json({...release('v99.0.0'), prerelease: true})}), null);
});

test('check never throws and caches a failure so offline machines do not poll', async t => {
  const root = temp(t), now = Date.now();
  let calls = 0;
  const fetchImpl = async () => {calls++; throw new Error('offline');};
  assert.equal(await check({root, now, fetchImpl}), null);
  assert.equal(await check({root, now: now + 1000, fetchImpl}), null);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'update.json'), 'utf8')).checkedAt, now);
});

test('install refuses an archive whose checksum does not match', async t => {
  const root = temp(t), {calls, run} = runner();
  t.mock.method(console, 'log', () => {});
  await assert.rejects(install({root, publicKey, run, fetchImpl: serve({sum: sha('other')})}), /Somme de contrôle invalide/);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(path.join(root, 'updates')), false);
});

test('install runs the installer of an archive signed by the maintainer key', async t => {
  const root = temp(t), {calls, run} = runner();
  t.mock.method(console, 'log', () => {});
  fs.writeFileSync(path.join(root, 'update.json'), '{}');
  await install({root, publicKey, run, fetchImpl: serve()});
  assert.deepEqual(calls.map(c => c[1]), ['-tzf', '-xzf', calls[2][1]]);
  assert.equal(calls[2][0], process.execPath);
  assert.match(calls[2][1], /claude-switchboard\/scripts\/install\.mjs$/);
  assert.equal(fs.existsSync(path.join(root, 'update.json')), false);
});

test('install refuses a release without a signature before downloading anything', async t => {
  const root = temp(t), {calls, run} = runner();
  const downloads = [];
  const fetchImpl = async url => {downloads.push(url); return serve({sig: false})(url);};
  await assert.rejects(install({root, publicKey, run, fetchImpl}), /Signature de mise à jour absente ou invalide/);
  assert.deepEqual(downloads.filter(u => u.startsWith('https://dl/')), []);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(path.join(root, 'updates')), false);
});

test('install refuses a tampered archive even when its checksum was swapped to match', async t => {
  const root = temp(t), {calls, run} = runner();
  t.mock.method(console, 'log', () => {});
  await assert.rejects(install({root, publicKey, run, fetchImpl: serve({archive: 'evil', signature: sign('archive'), sum: sha('evil')})}), /Signature de mise à jour absente ou invalide/);
  await assert.rejects(install({root, run, fetchImpl: serve()}), /Signature de mise à jour absente ou invalide/); // signed by another key
  await assert.rejects(install({root, publicKey, run, fetchImpl: serve({signature: 'not base64 at all'})}), /Signature de mise à jour absente ou invalide/);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(path.join(root, 'updates')), false);
});

test('install refuses an archive with entries outside its release folder', async t => {
  t.mock.method(console, 'log', () => {});
  for (const entries of ['claude-switchboard/\nclaude-switchboard/../../.zshrc\n', '/etc/evil\n', 'claude-switchboard-other/x\n']) {
    const root = temp(t), {calls, run} = runner(entries);
    await assert.rejects(install({root, publicKey, run, fetchImpl: serve()}), /Archive de mise à jour non sûre/);
    assert.deepEqual(calls.map(c => c[1]), ['-tzf']);
  }
});
