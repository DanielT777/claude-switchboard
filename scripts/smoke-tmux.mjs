import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-e2e-'));
const root = path.join(temp, 'state'), claudeHome = path.join(temp, 'claude');
const socketDir = `/tmp/tmux-${process.getuid()}`;
fs.mkdirSync(socketDir, {recursive: true, mode: 0o700});
const socket = path.join(socketDir, `switchboard-test-${crypto.randomUUID()}`);
process.env.SWITCHBOARD_HOME = root;
process.env.SWITCHBOARD_CLAUDE_HOME = claudeHome;
process.env.SWITCHBOARD_NO_REFRESH = '1';
const {setup, write, read, quote, binary} = await import('../src/store.mjs');
const {newProfile} = await import('../src/accounts.mjs');
const {inventory} = await import('../src/adapters/index.mjs');
setup(); fs.mkdirSync(path.join(claudeHome, 'projects'), {recursive: true});
fs.mkdirSync(path.join(claudeHome, 'sessions'));
fs.mkdirSync(path.join(temp, 'bin'));
const fake = path.join(temp, 'bin/claude');
execFileSync('cc', ['-Wall', '-Wextra', '-Werror', path.join(source, 'test/fake-claude.c'), '-o', fake]);
const tmux = binary('tmux');
assert.ok(tmux, 'Install tmux to run the isolated PTY integration tests.');
write(path.join(root, 'config.json'), {binaries: {claude: fake, tmux, python3: binary('python3')}, adapters: ['direct', 'tmux']});
const target = newProfile('Second');
const cli = path.join(source, 'src/cli.mjs');
const env = {...process.env, TEST_NODE: process.execPath, TEST_HOOK: path.join(source, 'src/hook.mjs'), TEST_CWD: temp};
for (const key of Object.keys(env)) if (/^(ORCA_|CLAUDE_|CLAUDECODE$|ANTHROPIC_|TMUX)/.test(key)) delete env[key];
const tm = (...args) => execFileSync(tmux, ['-S', socket, ...args], {encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe']});
async function until(fn, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {const value = await fn(); if (value) return value; await delay(150);}
  throw new Error(message);
}
const workers = [];
try {
  tm('new-session', '-d', '-s', 'switchboard-test', '-c', temp, '/bin/bash --noprofile --norc');
  const pane = tm('display-message', '-p', '#{pane_id}').trim();
  const send = (text, enter = true) => {tm('send-keys', '-t', pane, '-l', '--', text); if (enter) tm('send-keys', '-t', pane, 'Enter');};
  for (const mode of ['direct', 'tmux']) {
    const sessionId = crypto.randomUUID();
    const command = `TEST_SESSION=${quote(sessionId)} ` + (mode === 'direct' ? [process.execPath, cli, 'direct', '--model', 'test-model'].map(quote).join(' ') : `TEST_NATIVE_ONLY=1 ${quote(fake)}`);
    send(command);
    const initial = await until(async () => (await inventory()).sessions.find(s => s.provider?.id === sessionId && s.adapter === mode && s.state === 'idle'), `${mode}: session never became idle`);
    assert.equal(initial.adapter, mode);
    if (mode === 'direct') {
      send('draft', false); await delay(1200);
      assert.equal((await inventory()).sessions.find(s => s.handle === initial.handle).state, 'unknown', 'unfinished user input must block stop');
      tm('send-keys', '-t', pane, 'C-u');
    }
    send('work');
    await until(async () => (await inventory()).sessions.find(s => s.provider?.id === sessionId && s.state === 'working'), 'working state missing');
    const worker = spawn(process.execPath, [cli, 'transfer', target, initial.handle], {env, stdio: ['ignore', 'pipe', 'pipe']}); workers.push(worker);
    let error = ''; worker.stderr.on('data', data => error += data);
    const exit = new Promise(resolve => worker.once('exit', code => resolve(code)));
    await delay(500);
    assert.equal((await inventory()).sessions.find(s => s.provider?.id === sessionId)?.claudePid, initial.claudePid, 'busy process was interrupted');
    assert.equal(read(path.join(root, 'transfer.json')).rows[0].stage, 'waiting');
    await until(() => read(path.join(root, 'transfer.json'), {})?.rows?.some(r => r.provider.id === sessionId && ['done', 'error'].includes(r.stage)), `${mode}: transfer timed out`, 25000);
    assert.equal(await exit, 0, error);
    const job = read(path.join(root, 'transfer.json'));
    assert.equal(job.rows[0].stage, 'done', job.rows[0].error);
    const final = await until(async () => (await inventory()).sessions.find(s => s.provider?.id === sessionId && s.state === 'idle'), 'resumed session missing');
    assert.equal(final.handle, initial.handle); assert.equal(final.accountId, target); assert.equal(final.accountEmail, 'second@example.test');
    assert.notEqual(final.claudePid, initial.claudePid);
    assert.equal(tm('display-message', '-p', '#{pane_id}').trim(), pane);
    const history = fs.readFileSync(path.join(claudeHome, 'projects', `${sessionId}.jsonl`), 'utf8');
    assert.ok(history.indexOf('answer-finished') < history.indexOf('exit'));
    assert.match(history, /resume/);
    assert.equal(fs.statSync(path.join(root, 'checkpoints', job.id, `${sessionId}.jsonl`)).mode & 0o777, 0o600);
    send('/exit');
    await until(() => read(path.join(root, 'sessions', `${sessionId}.json`), {})?.state === 'ended', 'test session did not exit');
    await until(() => tm('display-message', '-p', '#{pane_current_command}').trim() === 'bash', 'test shell did not return');
    console.log(`${mode}: waited for response, kept pane and history, resumed with the second fake account, checkpoint verified`);
  }
} finally {
  for (const worker of workers) if (worker.exitCode === null) worker.kill('SIGTERM');
  try {tm('kill-server');} catch {}
  fs.rmSync(socket, {force: true});
  fs.rmSync(temp, {recursive: true, force: true});
}
