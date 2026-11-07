import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {clean, quote, setup, read, write} from '../src/store.mjs';
import {environment, newProfile, profile, renameProfile, removeProfile} from '../src/accounts.mjs';
import {render} from '../src/menu.mjs';
import {normalizeUsage, saveUsage, loadUsage, percentage, resetLabel, cachedLimits, fetchUsage} from '../src/usage.mjs';

process.env.SWITCHBOARD_LANG = 'fr'; // Assertions below use the French source strings.

const temp = t => {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-test-')); t.after(() => fs.rmSync(root, {recursive: true, force: true})); setup(root); return root;};
const account = {id: 'system', name: 'Principal', email: 'person@example.com', loggedIn: true};
const other = {id: '11111111-1111-4111-8111-111111111111', name: 'Perso', email: 'perso@example.com', loggedIn: true};
const pending = {id: '22222222-2222-4222-8222-222222222222', name: 'Nouveau', loggedIn: false};

test('menu labels and shell arguments cannot inject commands', () => {
  assert.equal(clean('hello\nEvil | bash=/bad'), 'hello Evil   bash=/bad');
  assert.ok(!clean(':terminal:').includes(':'));
  assert.equal(quote("x'$(bad)"), "'x'\\''$(bad)'");
  const output = render({accounts: [{...account, name: 'A\nInjected | bash=/bad'}], selected: 'system'});
  assert.ok(!output.includes('\nInjected'));
});
test('the login environment drops foreign credentials and points at its own folder', () => {
  const env = environment('/private', {HOME: '/home', PATH: '/bin', ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'secret', CLAUDECODE: '1'});
  assert.deepEqual(env, {HOME: '/home', PATH: '/bin', CLAUDE_CONFIG_DIR: '/private'});
});
test('profiles are private, renamable, validated and archived on removal', t => {
  const root = temp(t), id = newProfile('Personnel', root), p = profile(id, root);
  assert.equal(fs.statSync(p.dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(p.dir, 'profile.json')).mode & 0o777, 0o600);
  renameProfile(id, 'Secondaire', root); assert.equal(profile(id, root).name, 'Secondaire');
  for (const name of ['', '\n', 'x|bash=bad', 'x'.repeat(51)]) assert.throws(() => newProfile(name, root));
  for (const bad of ['../../secrets', 'other', '', undefined]) assert.throws(() => profile(bad, root));
  assert.throws(() => removeProfile('system', root));
  write(path.join(root, 'selection.json'), {id}); assert.throws(() => removeProfile(id, root));
  write(path.join(root, 'selection.json'), {id: 'system'});
  assert.ok(fs.existsSync(path.join(removeProfile(id, root), 'profile.json')));
  assert.throws(() => profile(id, root));
});
test('corrupt state is not silently replaced by defaults', t => {
  const root = temp(t), file = path.join(root, 'bad.json'); fs.writeFileSync(file, '{');
  assert.throws(() => read(file, {}));
  assert.deepEqual(read(path.join(root, 'missing'), {}), {});
});
test('usage is validated, account-scoped, ages visibly and expires at reset', t => {
  for (const value of [undefined, null, NaN, Infinity, -1, 101, '30']) assert.equal(normalizeUsage({five_hour: {used_percentage: value}}), null);
  const root = temp(t), now = 1000000;
  saveUsage('system', {five_hour: {used_percentage: 33.4, resets_at: 2000}}, account.email, root, now);
  assert.equal(loadUsage(account, root, now).stale, false);
  assert.equal(loadUsage(account, root, now + 310000).stale, true);
  assert.equal(loadUsage({...account, email: 'other@example.com'}, root, now), null);
  assert.equal(percentage(loadUsage(account, root, now).windows.five_hour, 2000001), '—');
  assert.match(resetLabel({resets_at: 0}, now), /inconnue/);
});
test('fresh quotas come from Anthropic\'s usage endpoint, and a refused token gives nothing', async () => {
  let asked;
  const reply = (ok, body) => async (url, options) => {asked = {url, auth: options.headers.Authorization}; return {ok, json: async () => body};};
  const body = {five_hour: {utilization: 3, resets_at: '2026-11-07T10:10:00.43+00:00'}, seven_day: {utilization: 65, resets_at: '2026-11-12T07:00:00+00:00'}, seven_day_opus: null};
  assert.deepEqual(await fetchUsage('token', reply(true, body)), {five_hour: {used_percentage: 3, resets_at: 1794046200}, seven_day: {used_percentage: 65, resets_at: 1794466800}});
  assert.deepEqual(asked, {url: 'https://api.anthropic.com/api/oauth/usage', auth: 'Bearer token'});
  assert.equal(await fetchUsage('expired', reply(false, {type: 'error'})), null);
  assert.deepEqual(await fetchUsage('token', reply(true, {five_hour: null, seven_day: body.seven_day})), {five_hour: {used_percentage: 0}, seven_day: {used_percentage: 65, resets_at: 1794466800}});
});
test('model and credit rows come from Claude\'s own cache, scoped to the account, aged and graded by Anthropic', t => {
  const file = path.join(temp(t), '.claude.json'), owner = {emailAddress: account.email, accountUuid: 'u1'};
  const limits = [{kind: 'session', percent: 11, scope: null}, {kind: 'weekly_all', percent: 94, scope: null},
    {kind: 'weekly_scoped', percent: 96, severity: 'critical', resets_at: '1970-01-01T01:00:00.5+00:00', scope: {model: {display_name: 'Fable'}}},
    {kind: 'weekly_scoped', percent: 101, scope: {surface: {display_name: 'Bad'}}}];
  const extra_usage = {is_enabled: true, utilization: 40, used_credits: 1200, monthly_limit: 3000, currency: 'USD', decimal_places: 2};
  fs.writeFileSync(file, JSON.stringify({oauthAccount: owner, cachedUsageUtilization: {fetchedAtMs: 1000, accountUuid: 'u1', utilization: {limits, extra_usage}}}));
  const extra = cachedLimits(account, file);
  assert.deepEqual(extra.rows, [{name: 'Fable', severity: 'critical', used_percentage: 96, resets_at: 3600}]);
  assert.equal(cachedLimits({...account, email: 'other@example.com'}, file), null);
  fs.writeFileSync(file, '{');
  assert.equal(cachedLimits(account, file), null);
  const out = render({accounts: [{...account, limits: extra}], selected: 'system', now: 1000 + 6 * 60000});
  assert.match(out, /^· Fable +━+─* +≈96% \|[^\n]*color=#FF453A[^\n]*Relevé par \/usage il y a 6 min/m);
  assert.match(out, /^Crédits +━━━━─+ +≈40% \|[^\n]*12\.00 USD \/ 30\.00 USD/m);
  assert.match(out.split('\n')[0], /sfcolor=#FF453A/);
});
test('one click switches; the active account does nothing; an unconnected one opens a login', () => {
  const usage = {windows: {five_hour: {used_percentage: 25}, seven_day: {used_percentage: 65}}, at: 1000, stale: false};
  const out = render({accounts: [{...account, usage}, other, pending], selected: 'system', now: 1000});
  assert.match(out.split('\n')[0], /^:person\.crop\.circle: Principal · 5h 25% · 7j 65% \|/);
  assert.match(out, /^Principal \| checked=true refresh=true/m);
  assert.doesNotMatch(out, /param2=switch param3=system/);
  assert.match(out, /^Perso \|[^\n]*param2=switch param3=11111111-1111-4111-8111-111111111111 terminal=false/m);
  assert.match(out, /^Nouveau \|[^\n]*param2=login[^\n]*terminal=true[^\n]*badge='à connecter'/m);
  assert.doesNotMatch(out, /session\(s\) lancée/);
});
test('right after a switch the bar shows it is settling, and older sessions are named once', () => {
  const out = render({accounts: [account, other], selected: other.id, switchedAt: 1000, now: 20000, legacy: ['main-4', 'Sievy', 'main-5']});
  assert.match(out.split('\n')[0], /^:arrow\.triangle\.2\.circlepath: Perso \|[^\n]*Les sessions ouvertes passent sur Perso/);
  assert.match(out, /3 session\(s\) lancée\(s\) avant la mise à jour[^\n]*tooltip='main-4, Sievy, main-5'/);
  assert.match(render({accounts: [account, other], selected: other.id, switchedAt: 1000, now: 40000}).split('\n')[0], /^:person\.crop\.circle:/);
});
test('every submenu parent is clickable so macOS keeps it enabled', () => {
  const out = render({accounts: [account, other, pending], selected: 'system', error: 'Oups'}).split('\n');
  const depth = item => /^(--)*---$/.test(item) ? null : item.match(/^((?:--)*)/)[1].length / 2;
  out.forEach((item, i) => {
    if (depth(item) !== null && depth(out[i + 1] ?? '') > depth(item)) assert.match(item, /refresh=true|bash=|href=/, item);
  });
  assert.ok(out.some(item => /^Plus \|/.test(item)));
  assert.ok(out.some(item => /^Oups \|[^\n]*param2=dismiss/.test(item)));
});
