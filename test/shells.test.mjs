import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProcesses, shellJobs} from '../src/shells.mjs';

test('parses executable names only and rejects incomplete process snapshots', () => {
  assert.deepEqual(parseProcesses(' 10 1 claude\n 20 10 zsh\n'), [{pid: 10, ppid: 1, name: 'claude'}, {pid: 20, ppid: 10, name: 'zsh'}]);
  assert.equal(parseProcesses('10 1 Google Chrome')[0].name, 'Google Chrome');
  for (const raw of ['', 'bad', '10 1 claude\n10 1 claude']) assert.throws(() => parseProcesses(raw));
});
test('counts a nested monitoring shell tree once, not each sleep or bash child', () => {
  const rows = parseProcesses('10 1 claude\n20 10 zsh\n21 20 bash\n22 21 sleep\n30 10 watch');
  assert.deepEqual(shellJobs(rows, 10), {known: true, count: 2});
});
test('finds shells behind intermediate processes, not in unrelated terminals', () => {
  const rows = parseProcesses('10 1 claude\n20 10 node\n21 20 bash\n30 1 zsh\n31 30 watch');
  assert.deepEqual(shellJobs(rows, 10), {known: true, count: 1});
});
test('ordinary MCP Node children are not called shell jobs', () => {
  const rows = parseProcesses('10 1 claude\n20 10 node\n21 20 node\n30 10 mcp-server-darwi');
  assert.deepEqual(shellJobs(rows, 10), {known: true, count: 0});
});
test('missing or cyclic process identities fail closed', () => {
  assert.deepEqual(shellJobs(parseProcesses('20 1 zsh'), 10), {known: false, count: 0});
  assert.deepEqual(shellJobs(parseProcesses('10 20 claude\n20 10 node'), 10), {known: false, count: 0});
});
test('supports native Claude version-number executable names after caller fence verification', () => {
  assert.deepEqual(shellJobs(parseProcesses('10 1 2.1.292\n20 10 bash'), 10), {known: true, count: 1});
});
