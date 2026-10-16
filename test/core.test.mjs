import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {clean, quote, setup, read, write, lock} from '../src/store.mjs';
import {environment, newProfile, profile, renameProfile, removeProfile, syncSkills} from '../src/accounts.mjs';
import {render, sessionStyle} from '../src/menu.mjs';
import {setLanguage} from '../src/i18n.mjs';
import {normalizeUsage, saveUsage, loadUsage, percentage, resetLabel} from '../src/usage.mjs';
import {hookRecord} from '../src/hook.mjs';
import {claudeAncestor, accountFromEnvironment} from '../src/tracking.mjs';
import {passthrough} from '../src/cli.mjs';
import {validateTranscript} from '../src/adapters/index.mjs';
import {parsePanes, descendsFrom} from '../src/adapters/tmux.mjs';

process.env.SWITCHBOARD_LANG = 'fr'; // Assertions below use the French source strings.

const temp = t => {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-test-')); t.after(() => fs.rmSync(root, {recursive: true, force: true})); setup(root); return root;};
const account = {id: 'system', name: 'Principal', email: 'person@example.com', loggedIn: true, method: 'claude.ai'};

test('menu labels and shell arguments cannot inject commands', () => {
  assert.equal(clean('hello\nEvil | bash=/bad'), 'hello Evil   bash=/bad');
  assert.ok(!clean(':terminal:').includes(':'));
  assert.equal(quote("x'$(bad)"), "'x'\\''$(bad)'");
  const output = render({accounts: [{...account, name: 'A\nInjected | bash=/bad'}]});
  assert.ok(!output.includes('\nInjected'));
});
test('account environments remove foreign credentials and session markers', () => {
  const env = environment('/private', {HOME: '/home', PATH: '/bin', ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'secret', CLAUDECODE: '1', ORCA_PAIRING_CODE: 'secret', SWITCHBOARD_ACCOUNT_EMAIL: 'old@example.com'});
  assert.deepEqual(env, {HOME: '/home', PATH: '/bin', CLAUDE_CONFIG_DIR: '/private'});
});
test('profiles link shared settings and history but never copy credentials', t => {
  const root = temp(t), source = path.join(root, 'source');
  fs.mkdirSync(source); write(path.join(source, 'settings.json'), {x: 1}); write(path.join(source, '.credentials.json'), {secret: 'test'});
  const id = newProfile('Personnel', root, source), p = profile(id, root);
  assert.equal(fs.statSync(p.dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(p.dir, 'profile.json')).mode & 0o777, 0o600);
  assert.equal(fs.realpathSync(path.join(p.dir, 'projects')), fs.realpathSync(path.join(source, 'projects')));
  assert.ok(!fs.existsSync(path.join(p.dir, '.credentials.json')));
  renameProfile(id, 'Secondaire', root); assert.equal(profile(id, root).name, 'Secondaire');
  fs.mkdirSync(path.join(source, 'skills/new'), {recursive: true}); fs.mkdirSync(path.join(source, 'skills/synced'));
  syncSkills(p.dir, source);
  assert.ok(fs.lstatSync(path.join(p.dir, 'skills/new')).isSymbolicLink());
  assert.ok(!fs.existsSync(path.join(p.dir, 'skills/synced')));
});
test('invalid profile names and ids are rejected before mutation', t => {
  const root = temp(t);
  for (const name of ['', '\n', 'x|bash=bad', 'x'.repeat(51)]) assert.throws(() => newProfile(name, root));
  for (const id of ['../../secrets', 'other', '', undefined]) assert.throws(() => profile(id, root));
  assert.equal(fs.readdirSync(path.join(root, 'profiles')).length, 0);
});
test('removing a pending account preserves shared histories and permits recovery', t => {
  const root = temp(t), source = path.join(root, 'source');
  const id = newProfile('Pending', root, source);
  fs.writeFileSync(path.join(source, 'projects/keep.jsonl'), 'keep');
  const archive = removeProfile(id, root);
  assert.ok(fs.existsSync(path.join(archive, 'profile.json')));
  assert.equal(fs.readFileSync(path.join(source, 'projects/keep.jsonl'), 'utf8'), 'keep');
  assert.throws(() => profile(id, root));
});
test('active, in-use and switching accounts cannot be removed', t => {
  const root = temp(t), id = newProfile('Busy', root, path.join(root, 'source'));
  assert.throws(() => removeProfile('system', root));
  assert.throws(() => removeProfile(id, root, [{accountId: id, state: 'working', connected: true}]));
  write(path.join(root, 'selection.json'), {id}); assert.throws(() => removeProfile(id, root));
  write(path.join(root, 'selection.json'), {id: 'system'});
  const release = lock(root); assert.throws(() => removeProfile(id, root)); release();
});
test('locking is exclusive and leaves a live owner intact', t => {
  const root = temp(t), release = lock(root);
  assert.throws(() => lock(root));
  assert.equal(read(path.join(root, 'transfer.lock')).pid, process.pid);
  release(); assert.ok(!fs.existsSync(path.join(root, 'transfer.lock')));
});
test('corrupt state is not silently replaced by defaults', t => {
  const root = temp(t), file = path.join(root, 'bad.json'); fs.writeFileSync(file, '{');
  assert.throws(() => read(file, {}));
  assert.deepEqual(read(path.join(root, 'missing'), {}), {});
});
test('usage rejects invalid percentages without fabricating quota', () => {
  for (const value of [undefined, null, NaN, Infinity, -1, 101, '30']) assert.equal(normalizeUsage({five_hour: {used_percentage: value}}), null);
  assert.deepEqual(normalizeUsage({five_hour: {used_percentage: 0}}), {five_hour: {used_percentage: 0}});
  assert.equal(percentage(undefined), '—');
});
test('usage is account-scoped, ages visibly and expires at reset', t => {
  const root = temp(t), now = 1000000;
  saveUsage('system', {five_hour: {used_percentage: 33.4, resets_at: 2000}}, account.email, root, now);
  assert.equal(loadUsage(account, root, now).stale, false);
  assert.equal(loadUsage(account, root, now + 310000).stale, true);
  assert.equal(loadUsage({...account, email: 'other@example.com'}, root, now), null);
  assert.equal(percentage(loadUsage(account, root, now).windows.five_hour, 2000001), '—');
  assert.match(resetLabel({resets_at: 0}, now), /inconnue/);
});
const other = {id: '11111111-1111-4111-8111-111111111111', name: 'Perso', email: 'perso@example.com', loggedIn: true, method: 'claude.ai'};
const conversation = () => ({provider: {id: crypto.randomUUID(), key: 'session_id'}});
test('menu bar shows quotas, and the account name once there is a second account', () => {
  const usage = {windows: {five_hour: {used_percentage: 25}, seven_day: {used_percentage: 65}}, at: 1000, stale: false};
  assert.match(render({accounts: [{...account, usage}], now: 1000}).split('\n')[0], /^:person\.crop\.circle: 5h 25% · 7j 65% \|/);
  const out = render({accounts: [{...account, usage}, other], sessions: [{name: 'Example', handle: 'a', accountId: 'other', state: 'idle', adapter: 'orca', ...conversation()}], now: 1000});
  assert.match(out.split('\n')[0], /^:person\.crop\.circle: Principal · 5h 25% · 7j 65% \|/);
  assert.match(out, /compte non confirmé/);
  assert.match(out, /Relancées à la bascule · 1/);
});
test('clicking the selected account never starts a switch', () => {
  const out = render({accounts: [account, other]});
  assert.match(out, /^Principal \| checked=true refresh=true/m);
  assert.equal(out.match(/param2=switch/g).length, 1);
});
test('a clickable item never owns a submenu', () => {
  const out = render({accounts: [account, other], sessions: [{name: 'A', handle: 'a', state: 'idle', ...conversation()}, {name: 'B', unsupported: 'Hôte inconnu'}], error: 'Oups'}).split('\n');
  out.forEach((item, i) => {
    const depth = item.match(/^(-*)/)[1].length, next = out[i + 1]?.match(/^(-*)/)[1].length ?? 0;
    if (/bash=|href=/.test(item) && !/^-+$/.test(item)) assert.ok(next <= depth || /^-+$/.test(out[i + 1]), item);
  });
});
test('busy account actions have no executable command and partial state is visible', () => {
  const job = {running: true, targetName: 'Other', rows: [{stage: 'waiting', name: 'Project', waitReason: 'Fin de réponse'}]};
  const out = render({accounts: [account], job});
  assert.ok(!out.includes('param2=switch'));
  assert.match(out, /0\/1 reprises/);
  assert.match(out, /Fin de réponse/);
  assert.match(render({accounts: [account], job: {...job, running: false}}), /Bascule partielle/);
});
test('signed-out accounts offer connection and removal without a switch', () => {
  const out = render({accounts: [{id: crypto.randomUUID(), name: 'Pending', loggedIn: false}]});
  assert.ok(!out.includes('param2=switch')); assert.ok(out.includes('param2=login'));
  assert.match(out, /Supprimer le profil en attente/);
});
test('sessions a switch would restart are listed apart from the ones it leaves alone', () => {
  const sessions = [{name: 'Ready', state: 'done', ...conversation()}, {name: 'Shell', state: 'done', shells: {known: true, count: 1}, ...conversation()},
    {name: 'Busy', state: 'working', ...conversation()}, {name: 'Elsewhere', unsupported: 'Hôte inconnu', ...conversation()}, {name: 'Gone', connected: false, ...conversation()}];
  const out = render({sessions});
  assert.ok(out.indexOf('\nBusy') < out.indexOf('\nShell')); assert.ok(out.indexOf('\nShell') < out.indexOf('\nReady'));
  assert.match(out, /Non touchées · 2[^\n]*\n--Elsewhere[^\n]*\n--Gone/);
  assert.equal(sessionStyle({state: 'idle', shells: {known: false}, ...conversation()}).label, 'À vérifier');
  assert.match(sessionStyle({state: 'permission', ...conversation()}).label, /Autorisation/);
});
test('every submenu parent is clickable so macOS keeps it enabled', () => {
  const many = Array.from({length: 12}, (_, i) => ({name: `S${i}`, handle: `h${i}`, state: 'idle', ...conversation()}));
  const job = {running: false, rows: [{stage: 'error', name: 'Failed', handle: 'f'}]};
  const out = render({accounts: [account, other], sessions: [...many, {name: 'Elsewhere', unsupported: 'Hôte inconnu'}], errors: ['tmux indisponible'], job}).split('\n');
  const depth = item => /^(--)*---$/.test(item) ? null : item.match(/^((?:--)*)/)[1].length / 2;
  out.forEach((item, i) => {
    if (depth(item) !== null && depth(out[i + 1] ?? '') > depth(item)) assert.match(item, /refresh=true|bash=|href=/, item);
  });
  assert.ok(out.some(item => /^Plus \|/.test(item)) && out.some(item => /^Bascule partielle/.test(item)) && out.some(item => /^4 autres sessions/.test(item)));
});
test('the menu follows the selected language', t => {
  setLanguage('en'); t.after(() => setLanguage('fr'));
  const usage = {windows: {five_hour: {used_percentage: 25, resets_at: 4000}, seven_day: {used_percentage: 65}}, at: 1000, stale: false};
  const out = render({accounts: [{...account, usage}, other], sessions: [{name: 'A', handle: 'a', state: 'idle', ...conversation()}, {name: 'B', unsupported: 'x'}], now: 1000});
  assert.match(out.split('\n')[0], /5h 25% · 7d 65%/);
  for (const label of ['Accounts', 'Restarted on switch · 1', 'Left alone · 1', 'Ready', 'Add Account…', 'More', 'Run Diagnostics…', 'in 1 h']) assert.ok(out.includes(label), label);
  for (const word of ['Comptes', 'Prête', 'Réglages', 'Plus |', 'Relancée', 'Mesuré', 'jours']) assert.ok(!out.includes(word), word);
});
test('hook evidence is bounded to the exact process and account', () => {
  const id = crypto.randomUUID(), data = {session_id: id, source: 'resume'}, identity = {pid: 22, processStamp: 'stamp', accountId: 'system'};
  const started = hookRecord(data, 'SessionStart', null, identity, 100);
  const stopped = hookRecord(data, 'Stop', started, identity, 200);
  assert.equal(stopped.resumedAt, 100);
  assert.equal(hookRecord(data, 'Stop', started, {...identity, pid: 23}, 300).resumedAt, undefined);
  assert.equal(hookRecord({...data, agent_id: 'subagent'}, 'Stop', null, identity), null);
  assert.equal(hookRecord({session_id: '../../x'}, 'Stop', null, identity), null);
});
test('background work, crons and continuation hooks do not look idle', () => {
  const data = {session_id: crypto.randomUUID()};
  for (const patch of [{background_tasks: [{type: 'monitor'}]}, {session_crons: [{}]}, {stop_hook_active: true}]) assert.equal(hookRecord({...data, ...patch}, 'Stop', null, {}).state, 'unknown');
  assert.equal(hookRecord(data, 'StopFailure', null, {}).state, 'idle');
  assert.equal(hookRecord({...data, notification_type: 'permission_prompt'}, 'Notification', null, {}), null);
});
test('process ancestry is cycle-safe and recognizes the native Claude binary', () => {
  const rows = [{pid: 30, ppid: 20, name: 'sh'}, {pid: 20, ppid: 10, name: '2.1.296'}];
  assert.equal(claudeAncestor(rows, 30), 20);
  assert.equal(claudeAncestor([{pid: 3, ppid: 3, name: 'node'}], 3), null);
  assert.equal(descendsFrom(rows, 30, 10), true);
  assert.equal(descendsFrom(rows, 30, 5), false);
});
test('unknown config directories never masquerade as the system account', () => {
  assert.equal(accountFromEnvironment({CLAUDE_CONFIG_DIR: '/somewhere/custom'}), null);
  assert.equal(accountFromEnvironment({}), 'system');
});
test('noninteractive and native management commands bypass the PTY', () => {
  for (const args of [['auth', 'status'], ['-p', 'hello'], ['--print'], ['--version'], ['mcp', 'list']]) assert.equal(passthrough(args, {}), true);
  assert.equal(passthrough([], {CLAUDECODE: '1'}), true);
  assert.equal(passthrough(['--resume', 'id'], {}), false);
});
test('tmux pane parsing rejects ambiguous rows', () => {
  const row = '%1\t123\tclaude\t/dev/ttys001\t/tmp/my project\t0\t0';
  assert.equal(parsePanes(row, '/tmp/socket')[0].cwd, '/tmp/my project');
  assert.equal(parsePanes(row.replace('\t0\t0', '\t1\t0'), '/tmp/socket')[0].blocked, true);
  assert.throws(() => parsePanes('broken', '/tmp/socket'));
  assert.throws(() => parsePanes(row + '\textra', '/tmp/socket'));
});
test('transcripts must be exact shared conversation files and cannot escape via symlinks', t => {
  const root = temp(t), base = path.join(root, 'projects'), id = crypto.randomUUID(); fs.mkdirSync(base);
  const file = path.join(base, `${id}.jsonl`); fs.writeFileSync(file, '{}\n');
  const row = {provider: {id, key: 'session_id', transcriptPath: file}};
  assert.equal(validateTranscript(row, base), fs.realpathSync(file));
  const outside = path.join(root, `${id}.jsonl`); fs.writeFileSync(outside, '{}\n');
  fs.unlinkSync(file); fs.symlinkSync(outside, file);
  assert.throws(() => validateTranscript(row, base));
});
test('no module shadows the translator t() with a parameter named t', () => {
  const files = fs.readdirSync('src', {recursive: true}).filter(f => f.endsWith('.mjs')).map(f => path.join('src', f));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (/import \{t\} from/.test(text)) assert.doesNotMatch(text, /(?:^|[^\w.$])t\s*=>|\(\s*(?:async\s+)?t\s*[,)]/m, file);
  }
});
