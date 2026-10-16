import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.argv.includes('--terminal') ? 'macos' : 'orca';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), `csb-${host}-`));
const root = path.join(temp, 'state'), claudeHome = path.join(temp, 'claude');
process.env.SWITCHBOARD_HOME = root;
process.env.SWITCHBOARD_CLAUDE_HOME = claudeHome;
process.env.SWITCHBOARD_NO_REFRESH = '1';
const {setup, write, read, quote, binary} = await import('../src/store.mjs');
const {newProfile} = await import('../src/accounts.mjs');
const {inventory} = await import('../src/adapters/index.mjs');
const adapter = await import(`../src/adapters/${host}.mjs`);
const orca = binary('orca');
if (host === 'orca') assert.ok(orca, 'Install and open Orca to run this test.');
setup();
for (const dir of ['projects', 'sessions']) fs.mkdirSync(path.join(claudeHome, dir), {recursive: true});
fs.mkdirSync(path.join(temp, 'bin'));
const fake = path.join(temp, 'bin/claude'), cli = path.join(source, 'src/cli.mjs');
execFileSync('cc', ['-Wall', '-Wextra', '-Werror', path.join(source, 'test/fake-claude.c'), '-o', fake]);
write(path.join(root, 'config.json'), {binaries: {claude: fake, orca}, adapters: [host]});
const target = newProfile('Second'), id = crypto.randomUUID();
const env = {...process.env, TEST_NODE: process.execPath, TEST_HOOK: path.join(source, 'src/hook.mjs'), TEST_CWD: temp};
for (const key of Object.keys(env)) if (/^(ORCA_|CLAUDE_|CLAUDECODE$|ANTHROPIC_|TMUX|HERDR_)/.test(key)) delete env[key];
const call = (...args) => JSON.parse(execFileSync(orca, [...args, '--json'], {encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe']}));
const jxa = (script, ...args) => execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, ...args], {encoding: 'utf8'}).trim();
async function until(fn, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {try {const value = await fn(); if (value) return value;} catch {} await delay(200);}
  throw new Error(message);
}
let worker, handle, terminalPane;
try {
  const assignments = Object.entries(env).filter(([key]) => /^(SWITCHBOARD_|TEST_)/.test(key)).map(([key, value]) => `${key}=${value}`);
  const command = 'export ' + [...assignments, `TEST_SESSION=${id}`, 'TEST_NATIVE_ONLY=1'].map(quote).join(' ') + ` && cd ${quote(temp)} && ${quote(fake)}`;
  if (host === 'orca') {
    const created = call('terminal', 'create', '--worktree', `path:${source}`, '--title', 'Switchboard isolated smoke', '--command', command);
    handle = (created.result?.terminal || created.terminal)?.handle;
  } else {
    terminalPane = jxa('function run(a) { var app = Application("Terminal"); var t = app.doScript(a[0]); var tty = t.tty(); var id; app.windows().forEach(function(w) { w.tabs().forEach(function(s) { if(s.tty()===tty) id=w.id()+":"+tty; }); }); return id; }', command);
    handle = `Terminal:${terminalPane}`;
  }
  assert.ok(handle, 'Host did not return a terminal handle');
  const send = text => host === 'orca' ? call('terminal', 'send', '--terminal', handle, '--text', text, '--enter') : adapter.control('Terminal', 'send', terminalPane, text);
  const initial = await until(async () => (await inventory()).sessions.find(s => s.provider.id === id && s.adapter === host && s.state === 'idle'), `Native ${host} session not discovered`);
  assert.equal(fs.existsSync(path.join(root, 'sessions', `${id}.json`)), false, 'adoption must not require previous hooks');
  send('work');
  await until(async () => (await inventory()).sessions.some(s => s.provider.id === id && s.state === 'working'), 'Working state missing');
  worker = spawn(process.execPath, [cli, 'transfer', target, initial.handle], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let error = ''; worker.stderr.on('data', data => error += data);
  const exit = new Promise(resolve => worker.once('exit', resolve));
  await until(() => {if (worker.exitCode !== null) throw new Error(error); return read(path.join(root, 'transfer.json'), null);}, 'Transfer worker failed to start');
  assert.equal(read(path.join(root, 'transfer.json')).rows[0].stage, 'waiting');
  assert.equal((await inventory()).sessions.find(s => s.provider.id === id)?.claudePid, initial.claudePid);
  try {await until(() => ['done', 'error'].includes(read(path.join(root, 'transfer.json'), {})?.rows?.[0]?.stage), 'Orca transfer timed out', 60000);}
  catch (error) {console.error(read(path.join(root, 'transfer.json'), {})?.rows?.map(r => ({stage:r.stage, reason:r.waitReason, error:r.error}))); throw error;}
  assert.equal(await exit, 0, error);
  const job = read(path.join(root, 'transfer.json'));
  assert.equal(job.rows[0].stage, 'done', job.rows[0].error);
  const final = await until(async () => (await inventory()).sessions.find(s => s.provider.id === id && s.adapter === host && s.state === 'idle'), `${host} resume missing`);
  assert.equal(final.handle, initial.handle);
  assert.notEqual(final.claudePid, initial.claudePid);
  assert.equal(final.accountId, target); assert.equal(final.accountEmail, 'second@example.test');
  const history = fs.readFileSync(path.join(claudeHome, 'projects', `${id}.jsonl`), 'utf8');
  assert.ok(history.indexOf('answer-finished') < history.indexOf('exit'));
  assert.match(history, /resume/);
  await adapter.stopClaude(final);
  await until(() => read(path.join(root, 'sessions', `${id}.json`), {})?.state === 'ended', 'Fixture did not stop');
  console.log(`${host}: adopted native session without hooks, waited for reply, resumed same conversation and pane with second fake account`);
} finally {
  if (worker?.exitCode === null) worker.kill('SIGTERM');
  if (handle && host === 'orca') {try {call('terminal', 'close', '--terminal', handle);} catch {}}
  if (terminalPane) {try {jxa('function run(a) { Application("Terminal").windows.byId(Number(a[0])).close({saving:"no"}); }', terminalPane.split(':')[0]);} catch {}}
  fs.rmSync(temp, {recursive: true, force: true});
}
