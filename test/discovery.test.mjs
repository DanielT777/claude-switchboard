import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {nativeRecord, terminalHost, emptyPrompt, shellAncestor} from '../src/native.mjs';
import {resolve} from '../src/adapters/index.mjs';
import {request} from '../src/socket.mjs';
import {resumeArguments} from '../src/cli.mjs';

process.env.SWITCHBOARD_LANG = 'fr'; // Assertions below use the French source strings.

const id = '11111111-1111-4111-8111-111111111111';
const native = {pid: 42, sessionId: id, kind: 'interactive', procStart: 'Fri Oct 16 08:07:14 2026', status: 'idle'};
const table = [{pid: 42, ppid: 20, name: '2.1.301'}];
const utc = `${native.procStart} ttys002`;
test('native discovery requires the exact live process, start time and conversation', () => {
  assert.equal(nativeRecord(native, table, utc).state, 'idle');
  for (const patch of [{kind: 'bg'}, {pid: 99}, {sessionId: 'bad'}, {procStart: 'old'}, {pid: '42'}]) assert.equal(nativeRecord({...native, ...patch}, table, utc), null);
  assert.equal(nativeRecord(native, [{pid: 42, name: 'node'}], utc), null);
  assert.equal(nativeRecord({...native, status: 'future-state'}, table, utc).state, 'unknown');
});
test('registry UTC timestamps match the same process observed in a local timezone', () => {
  const local = 'Fri Oct 16 10:07:14 2026 ttys002';
  assert.equal(nativeRecord(native, table, local), null);
  assert.equal(nativeRecord(native, table, local, utc).processStamp, local);
});
test('terminal discovery follows ancestry and stops at the nearest controller', () => {
  const rows = [...table, {pid: 20, ppid: 10, name: 'tmux: server'}, {pid: 10, ppid: 1, name: 'ghostty'}];
  assert.equal(terminalHost(42, rows), 'tmux');
  assert.equal(terminalHost(10, rows), 'ghostty');
  assert.equal(terminalHost(42, [{pid: 42, ppid: 42, name: 'claude'}]), 'Terminal non identifié');
});
test('macOS tabs retain a shell incarnation and refuse exec-only or cyclic ancestry', () => {
  assert.equal(shellAncestor(42, [...table, {pid: 20, ppid: 1, name: 'zsh'}]), 20);
  assert.equal(shellAncestor(42, [{pid: 42, ppid: 42, name: 'claude'}]), null);
  assert.equal(shellAncestor(42, table), null);
});
test('nested controllers resolve once without hiding duplicate conversations in different processes', () => {
  const base = {claudePid: 42, processStamp: utc, provider: {id}};
  assert.equal(resolve(['orca', 'tmux', 'herdr', 'direct'].map(adapter => ({...base, adapter})))[0].adapter, 'direct');
  assert.equal(resolve([{...base, adapter: 'tmux'}, {...base, claudePid: 43, adapter: 'orca'}]).length, 2);
  assert.equal(resolve([{adapter: 'orca', provider: {id}}, {...base, adapter: 'tmux'}]).length, 2);
});
test('prompt detection refuses drafts and unknown output', () => {
  assert.equal(emptyPrompt('previous output\n❯ \n'), true);
  assert.equal(emptyPrompt('\x1b[32m❯\x1b[0m '), true);
  for (const text of ['❯ unfinished', '❯ \n❯ later draft', '❯ \n  wrapped draft', 'shell $', '']) assert.equal(emptyPrompt(text), false);
});
test('resume preserves explicit supported flags without replaying prompts or old session selectors', () => {
  assert.deepEqual(resumeArguments(['--resume', id, '--model=sonnet', 'old prompt', '--permission-mode', 'plan', '--settings', '/tmp/settings.json', '--fork-session']), ['--model=sonnet', '--permission-mode', 'plan', '--settings', '/tmp/settings.json']);
  assert.deepEqual(resumeArguments(['--dangerously-skip-permissions']), ['--dangerously-skip-permissions']);
  assert.throws(() => resumeArguments(['--model']), /manquante/);
});

async function socketFixture(t, reply) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-sock-')), file = path.join(dir, 's');
  const server = net.createServer(socket => socket.once('data', data => reply(socket, JSON.parse(data))));
  await new Promise(resolve => server.listen(file, resolve));
  fs.chmodSync(file, 0o600);
  t.after(async () => {await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, {recursive: true, force: true});});
  return file;
}
test('local RPC accepts bounded fragmented JSON from private sockets', async t => {
  const file = await socketFixture(t, (socket, message) => {socket.write('{"id":'); socket.end(JSON.stringify(message.id) + ',"result":true}\n');});
  assert.deepEqual(await request(file, {id: 'test'}), {id: 'test', result: true});
});
test('local RPC rejects truncated, oversized and public sockets', async t => {
  const truncated = await socketFixture(t, socket => socket.end('{"broken":'));
  await assert.rejects(request(truncated, {}));
  const oversized = await socketFixture(t, socket => socket.end('x'.repeat(100)));
  await assert.rejects(request(oversized, {}, 20));
  fs.chmodSync(oversized, 0o666);
  assert.throws(() => request(oversized, {}), /non privé/);
});
