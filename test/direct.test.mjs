import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';

process.env.SWITCHBOARD_LANG = 'fr';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-direct-'));
process.env.SWITCHBOARD_HOME = root;
const {setup, write} = await import('../src/store.mjs');
const {processStamp} = await import('../src/tracking.mjs');
const {inventory} = await import('../src/adapters/direct.mjs');
setup();
test.after(() => fs.rmSync(root, {recursive: true, force: true}));

test('ignores an old supervisor after its conversation resumes in a new process', async t => {
  // Arrange
  const sessionId = crypto.randomUUID(), stale = '00000000-0000-4000-8000-000000000001', current = crypto.randomUUID();
  const record = {sessionId, pid: process.pid, processStamp: processStamp(process.pid), cwd: root, state: 'idle', at: Date.now() - 2000};
  const socket = path.join(root, 's');
  const server = net.createServer(client => client.once('data', () => client.end(JSON.stringify({ok: true, result: {pid: process.pid, lastInputAt: 0, lastOutputAt: 0}}) + '\n')));
  await new Promise(resolve => server.listen(socket, resolve));
  fs.chmodSync(socket, 0o600);
  t.after(async () => {await new Promise(resolve => server.close(resolve)); fs.rmSync(path.join(root, 'supervisors'), {recursive: true, force: true});});
  write(path.join(root, 'sessions', sessionId + '.json'), record);
  for (const id of [stale, current]) {
    write(path.join(root, 'supervisors', id + '.json'), {id, pid: process.pid, socket: id === stale ? path.join(root, 'gone') : socket, cwd: root});
    write(path.join(root, 'supervisors', id + '.session.json'), id === stale ? {...record, processStamp: 'previous process incarnation'} : record);
  }
  // Act
  const rows = await inventory({records: [record]});
  // Assert
  assert.deepEqual(rows.map(row => row.supervisorId), [current]);
  assert.equal(rows[0].shells.known, true);
});

test('still refuses an unreachable supervisor for the current live process', async t => {
  // Arrange
  const id = crypto.randomUUID(), sessionId = crypto.randomUUID();
  const record = {sessionId, pid: process.pid, processStamp: processStamp(process.pid), cwd: root, state: 'idle', at: Date.now() - 2000};
  write(path.join(root, 'sessions', sessionId + '.json'), record);
  write(path.join(root, 'supervisors', id + '.json'), {id, pid: process.pid, socket: path.join(root, 'gone'), cwd: root});
  write(path.join(root, 'supervisors', id + '.session.json'), record);
  t.after(() => fs.rmSync(path.join(root, 'supervisors'), {recursive: true, force: true}));
  // Act
  const result = inventory({records: [record]});
  // Assert
  await assert.rejects(result, /Superviseur direct inaccessible/);
});
