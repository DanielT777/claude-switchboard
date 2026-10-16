import test from 'node:test';
import assert from 'node:assert/strict';
import {advance, receiptMatches, validateRows, runQueue, resumeCommand} from '../src/transfer.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

process.env.SWITCHBOARD_LANG = 'fr'; // Assertions below use the French source strings.
const row = () => ({handle: 'h', connected: true, incarnationId: 'i', provider: {id: 'session'}, stage: 'waiting', startedAt: 100});
test('resume requires the original directory and quotes it as shell data', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "csb cwd ' $-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const command = resumeCommand('system', {...row(), worktreePath: directory, receiptId: 'receipt'});
  const cd = command.split(' && ')[0];
  assert.equal(execFileSync('/bin/sh', ['-c', `${cd} && pwd -P`], {encoding: 'utf8'}).trim(), fs.realpathSync(directory));
  assert.throws(() => resumeCommand('system', {...row(), worktreePath: '/does-not-exist-switchboard'}));
  assert.throws(() => resumeCommand('system', {...row(), worktreePath: 'relative'}));
});
function mock(state = 'done') {
  const calls = [];
  const deps = {current: async r => ({...r, state}), activity: async () => ({known: true, count: 0}), authenticate: async () => calls.push('auth'),
    checkpoint: async () => calls.push('backup'), save: async s => calls.push(s),
    stop: async () => calls.push('exit'), waitShell: async () => calls.push('shell'),
    start: async () => calls.push('resume'), verify: async () => calls.push('proof')};
  return {calls, deps};
}
test('waits for work or permission without any mutation', async () => {
  for (const state of ['working', 'permission', 'unknown']) {
    const {calls, deps} = mock(state); await advance(row(), deps); assert.deepEqual(calls, []);
  }
});
test('shell jobs and unverifiable process trees delay migration before auth, backup or exit', async () => {
  for (const activity of [{known: true, count: 2}, {known: false, count: 0}]) {
    const r = row(), {calls, deps} = mock();
    deps.activity = async () => activity;
    await advance(r, deps);
    assert.deepEqual(calls, []);
    assert.equal(r.stage, 'waiting');
    assert.match(r.waitReason, /shell/i);
  }
});
test('migration continues once shell work ends and clears the waiting reason', async () => {
  const r = row(), {calls, deps} = mock();
  deps.activity = async () => ({known: true, count: 1});
  await advance(r, deps);
  deps.activity = async () => ({known: true, count: 0});
  await advance(r, deps);
  assert.equal(r.waitReason, undefined);
  assert.equal(calls.filter(c => c === 'exit').length, 1);
  assert.equal(calls.at(-1), 'done');
});
test('backs up and authenticates before exit, proves resume before done', async () => {
  const {calls, deps} = mock(); await advance(row(), deps);
  assert.deepEqual(calls, ['auth', 'backup', 'stopping', 'exit', 'shell', 'auth', 'starting', 'resume', 'proof', 'done']);
});
test('missing target authentication never stops a conversation', async () => {
  const {calls, deps} = mock(); deps.authenticate = async () => {throw Error('signed out');};
  await assert.rejects(advance(row(), deps)); assert.deepEqual(calls, []);
});
test('checkpoint failure leaves live session intact', async () => {
  const {calls, deps} = mock(); deps.checkpoint = async () => {throw Error('disk full');};
  await assert.rejects(advance(row(), deps)); assert.deepEqual(calls, ['auth']);
});
test('never types a launch before shell is confirmed', async () => {
  const {calls, deps} = mock(); deps.waitShell = async () => {throw Error('not a shell');};
  await assert.rejects(advance(row(), deps)); assert.ok(!calls.includes('resume'));
});
test('unknown delivery does not get retried and cannot be marked done', async () => {
  const {calls, deps} = mock(); deps.verify = async () => {throw Error('timeout');};
  await assert.rejects(advance(row(), deps)); assert.equal(calls.filter(c => c === 'resume').length, 1); assert.ok(!calls.includes('done'));
});
test('changed process incarnation is refused', async () => {
  const {calls, deps} = mock(); deps.current = async r => ({...r, incarnationId: 'new', state: 'done'});
  await assert.rejects(advance(row(), deps)); assert.deepEqual(calls, []);
});
test('only matching fresh resume receipt counts', () => {
  const r = row();
  assert.ok(receiptMatches({sessionId: 'session', event: 'SessionStart', source: 'resume', at: 101}, r));
  for (const patch of [{sessionId: 'other'}, {source: 'startup'}, {at: 99}, {event: 'Stop'}]) {
    assert.ok(!receiptMatches({sessionId: 'session', event: 'SessionStart', source: 'resume', at: 101, ...patch}, r));
  }
});
test('duplicate or unidentified conversations refuse entire switch before stopping', () => {
  assert.throws(() => validateRows([row(), row()]));
  assert.throws(() => validateRows([{...row(), provider: undefined}]));
});
test('subsequent hooks preserve resume evidence without accepting exited sessions', () => {
  const receipt = {sessionId: 'session', event: 'Stop', resumedAt: 101, at: 105, state: 'idle'};
  assert.ok(receiptMatches(receipt, row()));
  assert.ok(!receiptMatches({...receipt, state: 'ended'}, row()));
  assert.ok(!receiptMatches({...receipt, sessionId: 'different'}, row()));
  assert.ok(!receiptMatches({...receipt, resumedAt: 99}, row()));
});

test('a receipt for another account cannot confirm a successful transfer', () => {
  const r = {...row(), targetId: 'b', targetEmail: 'b@example.com'};
  assert.ok(!receiptMatches({sessionId: 'session', resumedAt: 101, accountId: 'a', email: 'a@example.com'}, r));
  assert.ok(receiptMatches({sessionId: 'session', resumedAt: 101, accountId: 'b', email: 'b@example.com'}, r));
});
test('a failed session does not block other sessions and is never retried automatically', async () => {
  const rows = [{...row(), handle: 'bad'}, {...row(), handle: 'good'}], calls = [];
  await runQueue(rows, {now: () => 0, deadline: 100, cancelled: () => false, persist() {}, delay: async () => {},
    advance: async r => {calls.push(r.handle); if (r.handle === 'bad') throw Error('refused'); r.stage = 'done';}});
  assert.deepEqual(calls, ['bad', 'good']); assert.deepEqual(rows.map(r => r.stage), ['error', 'done']);
});
test('cancellation and timeout cancel waiting sessions without advancing them', async () => {
  for (const cancelled of [true, false]) {
    const rows = [row()];
    await runQueue(rows, {now: () => cancelled ? 0 : 200, deadline: 100, cancelled: () => cancelled, persist() {}, delay: async () => {}, advance: async () => assert.fail('must not stop')});
    assert.equal(rows[0].stage, 'cancelled');
  }
});
test('waiting sessions progress after a later idle signal with at most three concurrent resumes', async () => {
  const rows = Array.from({length: 7}, row); let active = 0, maximum = 0, iteration = 0;
  await runQueue(rows, {now: () => 0, deadline: 100, cancelled: () => false, persist() {}, delay: async () => {iteration++;},
    advance: async r => {active++; maximum = Math.max(maximum, active); await Promise.resolve(); if (iteration) r.stage = 'done'; active--;}});
  assert.equal(maximum, 3); assert.equal(iteration, 1); assert.ok(rows.every(r => r.stage === 'done'));
});
