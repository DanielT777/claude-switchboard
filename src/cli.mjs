import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import readline from 'node:readline/promises';
import {ROOT, read, write, setup, binary, run, clean, refresh} from './store.mjs';
import {profiles, profile, environment, newProfile, renameProfile, removeProfile} from './accounts.mjs';
import {render} from './menu.mjs';
import {loadUsage, saveUsage, fetchUsage, cachedLimits, claudeConfig} from './usage.mjs';
import * as vault from './vault.mjs';
import {t} from './i18n.mjs';

const SELF = fileURLToPath(import.meta.url), HERE = path.dirname(SELF);

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error(t('Impossible de lancer le programme. Vérifie l’installation.'))));
    child.once('exit', (code, signal) => {process.exitCode = code ?? (signal ? 1 : 0); resolve();});
  });
}

// osascript runs in the background: without `activate` its dialog shows but typing goes to the window behind it.
function textDialog(prompt, title, initial = '') {
  try {return run('/usr/bin/osascript', ['-e', 'on run argv\nactivate\ntext returned of (display dialog (item 1 of argv) with title (item 2 of argv) default answer (item 3 of argv) buttons {item 4 of argv, item 5 of argv} default button (item 5 of argv) cancel button (item 4 of argv))\nend run', prompt, title, initial, t('Annuler'), t('Continuer')]).trim();}
  catch {return null;}
}

// Empty keeps the fallback; Ctrl+C or Ctrl+D cancels (null).
async function ask(question, fallback) {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  try {return (await rl.question(question)).trim() || fallback;} catch {return null;} finally {rl.close();}
}

// Logs in inside a throwaway folder, so the live login and every open session stay untouched.
async function login(id) {
  const p = profile(id), dir = fs.mkdtempSync(path.join(ROOT, 'login-'));
  try {
    const flags = ['auth', 'login', '--claudeai', ...(p.identity?.email ? ['--email', p.identity.email] : [])];
    await childExit(spawn(binary('claude') || 'claude', flags, {env: {...environment(dir), CLAUDE_SECURESTORAGE_CONFIG_DIR: dir}, cwd: os.homedir(), stdio: 'inherit'}));
    if (!process.exitCode) vault.adopt(p, dir);
  } finally {vault.keychain.remove(vault.slot(dir)); fs.rmSync(dir, {recursive: true, force: true});}
}

// Small file reads only: no process scan, no `claude auth status`.
async function menu() {
  const live = vault.current();
  const accounts = profiles().map(p => {
    const meta = p.id === live?.id ? live : vault.saved(p.id), plan = vault.saved(p.id);
    const a = {...p, loggedIn: !!meta, email: meta?.email, orgId: meta?.orgId, plan: plan?.email === meta?.email ? plan?.plan : undefined};
    return {...a, usage: loadUsage(a), limits: p.id === live?.id ? cachedLimits(a, claudeConfig()) : null};
  });
  const failure = read(path.join(ROOT, 'error.json'), {});
  let update = null;
  try {update = await (await import('./update.mjs')).check();} catch {}
  console.log(render({accounts, update, selected: live?.id, legacy: vault.legacySessions(), switchedAt: read(path.join(ROOT, 'selection.json'), {}).at,
    error: failure.at > Date.now() - 10 * 60 * 1000 ? failure.message : null}));
  // Quotas refresh in the background, so opening the menu never waits on the network.
  if (due().length) spawn(process.execPath, [SELF, 'poll'], {detached: true, stdio: 'ignore'}).unref();
}

// Only this poll writes quota/: older versions and other tools wrote usage/ for whichever login was live, and old idle sessions replay stale limits.
const POLLED = path.join(ROOT, 'quota', 'polled.json'), EVERY = 60000;
const due = (now = Date.now(), last = read(POLLED, {})) => profiles().filter(p => !(now - (last[p.id] || 0) < EVERY));

// One read-only request per account and minute. An inactive account is asked only while its saved token is still valid.
async function poll() {
  const live = vault.current(), now = Date.now(), list = due(now);
  write(POLLED, {...read(POLLED, {}), ...Object.fromEntries(list.map(p => [p.id, now]))});
  await Promise.all(list.map(async p => {
    const active = p.id === live?.id, email = active ? live.email : vault.saved(p.id)?.email;
    const oauth = email && (active ? vault.keychain.read(vault.slot()) : vault.keychain.read(vault.VAULT, p.id))?.claudeAiOauth;
    if (!oauth?.accessToken || !(oauth.expiresAt > now + EVERY)) return;
    const windows = await fetchUsage(oauth.accessToken).catch(() => null);
    if (windows) saveUsage(p.id, windows, email);
  }));
}

function doctor() {
  console.log(t('Claude Switchboard · diagnostic local'));
  console.log(`claude: ${t(binary('claude') ? 'disponible' : 'absent')}`);
  const live = vault.current();
  console.log(live ? t('Compte actif : {name} ({email})', {name: live.name, email: live.email}) : t('Aucune connexion Claude active.'));
  for (const p of profiles()) if (p.id !== live?.id) console.log(`${p.name}: ${vault.saved(p.id) ? vault.saved(p.id).email : t('à connecter')}`);
}

export async function main(argv = process.argv.slice(2)) {
  setup();
  const [command = 'menu', id, ...args] = argv;
  if (command === 'menu') return menu();
  if (command === 'poll') return poll().catch(() => {}); // A missed refresh is retried next minute.
  // ponytail: shells opened before the update still define claude() as `… direct`; pass straight through.
  if (command === 'direct' || command === 'claude') return childExit(spawn(binary('claude') || 'claude', argv.slice(1), {stdio: 'inherit'}));
  if (command === 'doctor') return doctor();
  write(path.join(ROOT, 'error.json'), {});
  if (command === 'switch') vault.activate(id);
  else if (command === 'add') {
    // The menu opens a terminal for the login anyway; a dialog shown beside it loses the keyboard to that terminal.
    const name = id || (process.stdin.isTTY ? await ask(`${t('Nom court du compte')} [${t('Personnel')}] : `, t('Personnel'))
      : textDialog(t('Nom court du compte'), t('Ajouter un compte Claude'), t('Personnel')));
    if (name) await login(newProfile(name));
  } else if (command === 'login' || command === 'reconnect') await login(id);
  else if (command === 'rename') {
    const p = profile(id), name = args[0] || textDialog(t('Nom affiché dans la barre'), t('Renommer le compte'), p.name);
    if (name) renameProfile(id, name);
  } else if (command === 'remove') {
    const p = profile(id);
    // A session started before hot switching may still run in this profile's folder: archiving it would cut that session off.
    if (vault.legacySessions([p]).length) throw new Error(t('Ce compte est encore utilisé par une session.'));
    if (vault.saved(id)) {
      try {run('/usr/bin/osascript', ['-e', 'on run argv\nactivate\ndisplay dialog (item 1 of argv) buttons {item 2 of argv, item 3 of argv} default button (item 2 of argv) cancel button (item 2 of argv)\nend run', t('Retirer {name} du menu ? Le profil sera archivé localement.', {name: p.name}), t('Annuler'), t('Retirer')]);} catch {return;}
    }
    removeProfile(id);
    vault.forget(id);
  } else if (command === 'dismiss') {
    // error.json was cleared above.
  } else if (command === 'update') await (await import('./update.mjs')).install();
  else if (command === 'help') run('/usr/bin/open', [path.join(HERE, '../README.md')]);
  else throw new Error(t('Commande inconnue. Commandes : menu, switch, add, rename, remove, doctor.'));
  refresh();
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main().catch(error => {
  const message = /spawn|Command failed/.test(error.message) ? t('Service indisponible. Lance le diagnostic depuis le menu.') : error.message;
  try {write(path.join(ROOT, 'error.json'), {message: clean(message), at: Date.now()}); refresh();} catch {}
  if (!process.argv[2] || process.argv[2] === 'menu') console.log(`${t('Claude · à vérifier')} | sfimage=exclamationmark.triangle\n---\n${t('Installation à vérifier. Lance Install.command.')}`);
  else {console.error(message); process.exitCode = 1;}
});
