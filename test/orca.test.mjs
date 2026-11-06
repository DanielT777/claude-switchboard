import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-orca-'));
process.env.SWITCHBOARD_HOME = root;
process.env.SWITCHBOARD_CLAUDE_HOME = path.join(root, 'claude');
const {write, setup} = await import('../src/store.mjs');
setup();
const client = path.join(root, 'Orca.app/Contents/Resources/app.asar.unpacked/out/cli/runtime-client.js');
fs.mkdirSync(path.dirname(client), {recursive: true});
fs.writeFileSync(client, `exports.RuntimeClient = class {
  async call(method, args) {
    if (method === 'terminal.list') return {ok: true, result: {terminals: [{handle: 'term-test', executionHostId: 'local', agentIdentity: 'claude'}]}};
    if (method === 'session.tabs.listAll') return {ok: true, result: {snapshots: [{tabs: [{terminal: 'term-test', agentStatus: {providerSession: {id: 'conversation'}}}]}]}};
    if (method !== 'terminal.focus') throw new Error('Unknown method: ' + method);
    return {ok: true, result: args};
  }
};\n`);
write(path.join(root, 'config.json'), {orcaApp: path.join(root, 'Orca.app')});
const {focus} = await import('../src/adapters/orca.mjs');
const direct = await import('../src/adapters/direct.mjs');
test.after(() => fs.rmSync(root, {recursive: true, force: true}));

test('focus uses the runtime method behind the public terminal switch command', async () => {
  // Arrange
  const row = {handle: 'term-test'};
  // Act
  const result = await focus(row);
  // Assert
  assert.deepEqual(result, {terminal: row.handle, navigation: 'host'});
});

test('a supervised Orca session focuses the tab with the same conversation', async () => {
  // Arrange
  const row = {terminal: 'Orca', provider: {id: 'conversation'}};
  // Act
  const result = await direct.focus(row);
  // Assert
  assert.deepEqual(result, {terminal: 'term-test', navigation: 'host'});
});

test('a supervised Orca session refuses to focus an unrelated conversation', async () => {
  // Arrange
  const row = {terminal: 'Orca', provider: {id: 'different'}};
  // Act
  const result = async () => direct.focus(row);
  // Assert
  await assert.rejects(result);
});
