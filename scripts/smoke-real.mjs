// Explicit opt-in: one real response and same-account resume in an isolated tmux pane.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
assert.ok(process.argv.includes('--real-claude'), 'Pass --real-claude explicitly; this test uses your signed-in account for one response.');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-real-')), root = path.join(temp, 'state'), socket = path.join(temp, 'tmux');
process.env.SWITCHBOARD_HOME = root;
process.env.SWITCHBOARD_NO_REFRESH = '1';
delete process.env.SWITCHBOARD_CLAUDE_HOME;
const {setup, write, read, quote, binary} = await import('../src/store.mjs');
const {inventory} = await import('../src/adapters/index.mjs');
setup();
const tmux = binary('tmux'), claude = binary('claude'), python3 = binary('python3');
assert.ok(tmux && claude && python3);
write(path.join(root, 'config.json'), {binaries: {tmux, claude, python3}, adapters: ['direct']});
const id = crypto.randomUUID(), cli = path.join(source, 'src/cli.mjs');
const env = {...process.env};
for (const key of Object.keys(env)) if (/^(ORCA_|CLAUDE_|CLAUDECODE$|ANTHROPIC_|TMUX)/.test(key)) delete env[key];
const tm = (...args) => execFileSync(tmux, ['-S', socket, ...args], {encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe']});
async function until(fn, message, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {const value = await fn(); if (value) return value; await delay(400);}
  throw new Error(message);
}
let worker;
try {
  tm('new-session', '-d', '-s', 'switchboard-real-test', '-x', '140', '-y', '45', '-c', temp, '/bin/bash --noprofile --norc');
  const pane = tm('display-message', '-p', '#{pane_id}').trim();
  const send = text => {tm('send-keys', '-t', pane, '-l', '--', text); tm('send-keys', '-t', pane, 'Enter');};
  const settings = {statusLine: {type: 'command', command: [process.execPath, path.join(source, 'src/statusline.mjs')].map(quote).join(' ')}};
  send([process.execPath, cli, 'direct', '--session-id', id, '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--model', 'haiku', '--settings', JSON.stringify(settings)].map(quote).join(' '));
  let trusted = false;
  const initial = await until(async () => {
    const screen = tm('capture-pane', '-p', '-t', pane);
    if (!trusted && /trust this folder|trust the files|trust this directory/i.test(screen)) {
      await delay(1000);
      if (/❯\s*No, exit/.test(screen)) tm('send-keys', '-t', pane, 'Down');
      tm('send-keys', '-t', pane, 'Enter'); trusted = true;
    }
    return (await inventory()).sessions.find(s => s.provider?.id === id && s.adapter === 'direct' && s.state === 'idle');
  }, 'Real Claude did not reach the idle prompt');
  send('Reply exactly SWITCHBOARD_REAL_TEST. Do not use tools.');
  await until(() => read(path.join(root, 'sessions', `${id}.json`), {})?.event === 'Stop', 'Real response did not finish', 120000);
  worker = spawn(process.execPath, [cli, 'transfer', 'system', initial.handle], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let error = ''; worker.stderr.on('data', data => error += data);
  const exit = new Promise(resolve => worker.once('exit', resolve));
  await until(() => ['done', 'error'].includes(read(path.join(root, 'transfer.json'), {})?.rows?.[0]?.stage), 'Real resume did not complete');
  assert.equal(await exit, 0, error);
  const job = read(path.join(root, 'transfer.json'));
  assert.equal(job.rows[0].stage, 'done', job.rows[0].error);
  const final = await until(async () => (await inventory()).sessions.find(s => s.provider?.id === id && s.adapter === 'direct' && s.state === 'idle'), 'Resumed real session not idle');
  assert.equal(final.handle, initial.handle); assert.notEqual(final.claudePid, initial.claudePid);
  assert.equal(final.accountId, 'system'); assert.ok(final.accountEmail);
  const transcript = fs.readFileSync(final.provider.transcriptPath, 'utf8');
  assert.match(transcript, /SWITCHBOARD_REAL_TEST/);
  const usage = read(path.join(root, 'usage/system.json'), null);
  console.log(JSON.stringify({realClaude: 'same-account resume verified',sameConversation: true, samePane: true, newPid: true, usageCaptured: !!usage}));
  send('/exit');
  await until(() => read(path.join(root, 'sessions', `${id}.json`), {})?.state === 'ended', 'Real test session did not exit');
} finally {
  if (worker?.exitCode === null) worker.kill('SIGTERM');
  try {tm('kill-server');} catch {}
  fs.rmSync(temp, {recursive: true, force: true});
}
