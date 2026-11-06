import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SWITCHBOARD_LANG = 'fr';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-vault-'));
process.env.SWITCHBOARD_HOME = path.join(base, 'state');
process.env.SWITCHBOARD_CLAUDE_HOME = path.join(base, 'claude');
const {setup, read, write} = await import('../src/store.mjs');
const {newProfile, profile} = await import('../src/accounts.mjs');
const {activate, adopt, current, slot, VAULT} = await import('../src/vault.mjs');
test.after(() => fs.rmSync(base, {recursive: true, force: true}));

const ROOT = process.env.SWITCHBOARD_HOME, HOME = process.env.SWITCHBOARD_CLAUDE_HOME, config = path.join(HOME, '.claude.json');
const who = (email, org) => ({emailAddress: email, organizationUuid: org, organizationName: org});
// In-memory keychain: same calls as the real one.
function keychain() {
  const items = new Map(), key = (s, a = 'me') => `${s}|${a}`;
  return {items, read: (s, a) => items.has(key(s, a)) ? structuredClone(items.get(key(s, a))) : null,
    write: (s, d, a) => items.set(key(s, a), structuredClone(d)), remove: (s, a) => items.delete(key(s, a))};
}
// Work is live; Perso is saved in the vault.
function fixture() {
  fs.rmSync(base, {recursive: true, force: true});
  setup(); fs.mkdirSync(HOME, {recursive: true});
  write(path.join(ROOT, 'system.json'), {identity: {email: 'work@x', orgId: 'o1'}});
  const perso = newProfile('Perso');
  write(path.join(ROOT, 'profiles', perso, 'profile.json'), {...read(path.join(ROOT, 'profiles', perso, 'profile.json')), identity: {email: 'me@x', orgId: 'o2'}});
  write(path.join(ROOT, 'vault', `${perso}.json`), {email: 'me@x', orgId: 'o2', oauthAccount: who('me@x', 'o2')});
  write(config, {oauthAccount: who('work@x', 'o1'), projects: {keep: true}});
  const keys = keychain();
  keys.write(slot(), {mcpOAuth: {server: 'kept'}, claudeAiOauth: {accessToken: 'work'}});
  keys.write(VAULT, {claudeAiOauth: {accessToken: 'perso'}}, perso);
  return {perso, keys};
}

test('a switch swaps only the Claude login under open sessions and keeps the outgoing one', () => {
  const {perso, keys} = fixture();
  activate(perso, keys);
  assert.deepEqual(keys.read(slot()), {mcpOAuth: {server: 'kept'}, claudeAiOauth: {accessToken: 'perso'}});
  assert.deepEqual(keys.read(VAULT, 'system'), {claudeAiOauth: {accessToken: 'work'}});
  assert.equal(read(config).oauthAccount.emailAddress, 'me@x');
  assert.deepEqual(read(config).projects, {keep: true});
  assert.equal(read(path.join(ROOT, 'selection.json')).id, perso);
  assert.ok(!fs.existsSync(path.join(HOME, '.storage-write.lock')));
  // Claude refreshed the token while Perso was live: switching back keeps the fresh one.
  keys.write(slot(), {mcpOAuth: {server: 'kept'}, claudeAiOauth: {accessToken: 'perso-refreshed'}});
  activate('system', keys);
  assert.deepEqual(keys.read(slot()).claudeAiOauth, {accessToken: 'work'});
  assert.deepEqual(keys.read(VAULT, perso).claudeAiOauth, {accessToken: 'perso-refreshed'});
  assert.equal(read(config).oauthAccount.emailAddress, 'work@x');
});

test('an account never connected cannot be switched to, and nothing changes', () => {
  const {keys} = fixture(), empty = newProfile('Vide');
  const before = keys.read(slot());
  assert.throws(() => activate(empty, keys), /Connecte Vide/);
  assert.deepEqual(keys.read(slot()), before);
  assert.equal(keys.read(VAULT, 'system'), null);
});

test('a login made outside the menu becomes an account instead of being lost on the next switch', () => {
  const {perso, keys} = fixture();
  write(config, {oauthAccount: who('stray@x', 'o9')});
  const found = current();
  assert.equal(found.name, 'stray');
  activate(perso, keys);
  assert.deepEqual(keys.read(VAULT, found.id), {claudeAiOauth: {accessToken: 'work'}});
});

test('a new login is stored for later, made live for the active account, and refused for the wrong one', () => {
  const {perso, keys} = fixture(), dir = path.join(base, 'login');
  fs.mkdirSync(dir);
  const login = (email, org, token) => {write(path.join(dir, '.claude.json'), {oauthAccount: who(email, org)}); keys.write(slot(dir), {claudeAiOauth: {accessToken: token}});};
  login('me@x', 'o2', 'perso-new'); adopt(profile(perso), dir, keys);
  assert.deepEqual(keys.read(VAULT, perso), {claudeAiOauth: {accessToken: 'perso-new'}});
  assert.equal(keys.read(slot()).claudeAiOauth.accessToken, 'work');
  login('work@x', 'o1', 'work-new'); adopt(profile('system'), dir, keys);
  assert.deepEqual(keys.read(slot()), {mcpOAuth: {server: 'kept'}, claudeAiOauth: {accessToken: 'work-new'}});
  login('intruder@x', 'o7', 'nope');
  assert.throws(() => adopt(profile(perso), dir, keys), /pas au compte attendu/);
  assert.deepEqual(keys.read(VAULT, perso).claudeAiOauth, {accessToken: 'perso-new'});
});
