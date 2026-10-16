import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-herdr-'));
const root = path.join(temp, 'state'), claudeHome = path.join(temp, 'claude');
process.env.SWITCHBOARD_HOME = root;
process.env.SWITCHBOARD_CLAUDE_HOME = claudeHome;
process.env.SWITCHBOARD_NO_REFRESH = '1';
const {setup, write, read, quote, binary} = await import('../src/store.mjs');
const {newProfile} = await import('../src/accounts.mjs');
const {inventory} = await import('../src/adapters/index.mjs');
const herdr = process.env.HERDR_TEST_BINARY || binary('herdr');
assert.ok(herdr, 'Install Herdr or set HERDR_TEST_BINARY to its executable.');
setup();
for (const dir of ['projects', 'sessions']) fs.mkdirSync(path.join(claudeHome, dir), {recursive: true});
fs.mkdirSync(path.join(temp, 'bin'));
const fake = path.join(temp, 'bin/claude'), cli = path.join(source, 'src/cli.mjs');
execFileSync('cc', ['-Wall', '-Wextra', '-Werror', path.join(source, 'test/fake-claude.c'), '-o', fake]);
write(path.join(root, 'config.json'), {binaries: {claude: fake, herdr}, adapters: ['herdr']});
const target = newProfile('Second'), session = `switchboard-test-${crypto.randomUUID().slice(0, 8)}`, id = crypto.randomUUID();
const env = {...process.env, TEST_NODE: process.execPath, TEST_HOOK: path.join(source, 'src/hook.mjs'), TEST_CWD: temp};
for (const key of Object.keys(env)) if (/^(ORCA_|CLAUDE_|CLAUDECODE$|ANTHROPIC_|TMUX|HERDR_)/.test(key)) delete env[key];
const h = (...args) => execFileSync(herdr, ['--session', session, ...args], {encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe']});
async function until(fn, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {try {const value = await fn(); if (value) return value;} catch {} await delay(200);}
  throw new Error(message);
}
const server = spawn(herdr, ['--session', session, 'server'], {env, stdio: 'ignore'});
let worker;
try {
  await until(() => JSON.parse(h('pane', 'list')).result, 'Herdr test server did not start');
  const assignments = Object.entries(env).filter(([key]) => /^(SWITCHBOARD_|TEST_)/.test(key)).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  const {root_pane: pane} = JSON.parse(h('workspace', 'create', '--cwd', temp, '--label', 'Switchboard fixture', '--no-focus', ...assignments)).result;
  const send = text => h('pane', 'run', pane.pane_id, text);
  send(`TEST_SESSION=${quote(id)} TEST_NATIVE_ONLY=1 ${quote(fake)}`);
  const initial = await until(async () => (await inventory()).sessions.find(s => s.provider.id === id && s.adapter === 'herdr' && s.state === 'idle'), 'Native Herdr session not discovered');
  assert.equal(fs.existsSync(path.join(root, 'sessions', `${id}.json`)), false, 'adoption must not require previous hooks');
  send('work');
  await until(async () => (await inventory()).sessions.some(s => s.provider.id === id && s.state === 'working'), 'Working state missing');
  worker = spawn(process.execPath, [cli, 'transfer', target, initial.handle], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let error = ''; worker.stderr.on('data', data => error += data);
  const exit = new Promise(resolve => worker.once('exit', resolve));
  await until(() => {if (worker.exitCode !== null) throw new Error(error); return read(path.join(root, 'transfer.json'), null);}, 'Transfer worker failed to start');
  assert.equal(read(path.join(root, 'transfer.json')).rows[0].stage, 'waiting');
  assert.equal((await inventory()).sessions.find(s => s.provider.id === id)?.claudePid, initial.claudePid);
  await until(() => ['done', 'error'].includes(read(path.join(root, 'transfer.json'), {})?.rows?.[0]?.stage), 'Herdr transfer timed out', 30000);
  assert.equal(await exit, 0, error);
  const job = read(path.join(root, 'transfer.json'));
  assert.equal(job.rows[0].stage, 'done', job.rows[0].error);
  const final = await until(async () => (await inventory()).sessions.find(s => s.provider.id === id && s.state === 'idle'), 'Herdr resume missing');
  assert.equal(final.handle, initial.handle);
  assert.notEqual(final.claudePid, initial.claudePid);
  assert.equal(final.accountId, target); assert.equal(final.accountEmail, 'second@example.test');
  const history = fs.readFileSync(path.join(claudeHome, 'projects', `${id}.jsonl`), 'utf8');
  assert.ok(history.indexOf('answer-finished') < history.indexOf('exit'));
  assert.match(history, /resume/);
  send('/exit');
  await until(() => read(path.join(root, 'sessions', `${id}.json`), {})?.state === 'ended', 'Fixture did not stop');
  console.log('Herdr: adopted native session without hooks, waited for reply, resumed same conversation and pane with second fake account');
} finally {
  if (worker?.exitCode === null) worker.kill('SIGTERM');
  try {h('server', 'stop');} catch {}
  if (server.exitCode === null) server.kill('SIGTERM');
  fs.rmSync(path.join(os.homedir(), '.config/herdr/sessions', session), {recursive: true, force: true});
  fs.rmSync(temp, {recursive: true, force: true});
}
