import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {ROOT, CLAUDE_HOME, UUID, read, write, setup, binary, run, quote, clean, alive, refresh} from './store.mjs';
import {profiles, profile, auth, usable, environment, newProfile, renameProfile, removeProfile, syncSkills} from './accounts.mjs';
import {inventory, adapters} from './adapters/index.mjs';
import {render} from './menu.mjs';
import {loadUsage} from './usage.mjs';
import {t, language} from './i18n.mjs';

const SELF = fileURLToPath(import.meta.url), HERE = path.dirname(SELF);
export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'StopFailure', 'Notification', 'PermissionRequest', 'SessionEnd'];
export const hookSettings = (directory = HERE, node = process.execPath) => Object.fromEntries(EVENTS.map(event => [event, [{...(event === 'Notification' ? {matcher: 'idle_prompt'} : {}), hooks: [{type: 'command', command: [node, path.join(directory, 'hook.mjs'), event].map(quote).join(' ') + ' # switchboard-hook', timeout: 5}]}]]));

export function passthrough(args, env = process.env) {
  return !!env.CLAUDECODE || args.some(a => ['-p', '--print', '--version', '-v', '--help', '-h', '--bg', '--background', '--cloud', '--desktop', '--tmux', '--tmux=classic', '-w', '--worktree'].includes(a)) ||
    ['auth', 'update', 'upgrade', 'install', 'uninstall', 'doctor', 'mcp', 'plugin', 'plugins', 'setup-token', 'agents', 'attach', 'logs', 'stop', 'kill', 'rm', 'respawn', 'purge', 'auto-mode', 'gateway', 'import', 'ultrareview'].includes(args[0]);
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error(t('Impossible de lancer le programme. Vérifie l’installation.'))));
    child.once('exit', (code, signal) => {process.exitCode = code ?? (signal ? 1 : 0); resolve();});
  });
}

export function resumeArguments(args) {
  const values = new Set(['--model', '--effort', '--permission-mode', '--add-dir', '--settings', '--mcp-config', '--allowedTools', '--disallowedTools', '--tools', '--append-system-prompt', '--system-prompt', '--agents', '--agent', '--fallback-model', '--setting-sources']);
  const switches = new Set(['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--strict-mcp-config', '--verbose', '--disable-slash-commands']);
  const kept = [];
  for (let i = 0; i < args.length; i++) {
    const [flag] = args[i].split('=');
    if (switches.has(args[i])) kept.push(args[i]);
    else if (values.has(flag)) {
      kept.push(args[i]);
      if (!args[i].includes('=')) {
        if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error(t('Valeur {flag} manquante.', {flag}));
        kept.push(args[++i]);
      }
    }
  }
  return kept;
}

export async function startClaude(id, {sessionId, receiptId, args = []} = {}) {
  const p = profile(id), account = await usable(p);
  syncSkills(p.dir);
  if (sessionId && (!UUID.test(sessionId) || !UUID.test(receiptId || ''))) throw new Error(t('Identifiant de reprise invalide.'));
  const supplied = [...args];
  let config = {};
  const settingsIndex = supplied.findIndex(arg => arg === '--settings' || arg.startsWith('--settings='));
  if (settingsIndex !== -1) {
    const inline = supplied[settingsIndex].startsWith('--settings=');
    const value = inline ? supplied[settingsIndex].slice(11) : supplied[settingsIndex + 1];
    if (!value) throw new Error(t('Valeur {flag} manquante.', {flag: '--settings'}));
    config = value.trim().startsWith('{') ? JSON.parse(value) : read(path.resolve(value), null);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(t('Fichier --settings absent ou invalide.'));
    supplied.splice(settingsIndex, inline ? 1 : 2);
  }
  config = {...config, hooks: {...config.hooks}};
  for (const [event, groups] of Object.entries(hookSettings())) config.hooks[event] = [...(config.hooks[event] || []), ...groups];
  const settingsFile = path.join(ROOT, 'launch', `${receiptId || crypto.randomUUID()}.json`);
  write(settingsFile, config);
  const flags = [...supplied, '--settings', settingsFile];
  const common = read(path.join(os.homedir(), '.claude.json'), {});
  if (!args.some(a => a === '--mcp-config' || a.startsWith('--mcp-config=')) && common.mcpServers && Object.keys(common.mcpServers).length) {
    const mcpFile = path.join(ROOT, 'shared/mcp.json');
    write(mcpFile, {mcpServers: common.mcpServers}); flags.push('--mcp-config', mcpFile);
  }
  if (sessionId) flags.push('--resume', sessionId);
  const env = environment(p.dir);
  for (const [key, value] of Object.entries(process.env)) if (key.startsWith('ORCA_')) env[key] = value;
  env.SWITCHBOARD_ACCOUNT_ID = id;
  env.SWITCHBOARD_ACCOUNT_EMAIL = account.email;
  if (receiptId) env.SWITCHBOARD_RECEIPT = receiptId;
  try {await childExit(spawn(binary('claude') || 'claude', flags, {env, stdio: 'inherit'}));}
  finally {fs.rmSync(settingsFile, {force: true});}
}

function textDialog(prompt, title, initial = '') {
  try {return run('/usr/bin/osascript', ['-e', 'on run argv\ntext returned of (display dialog (item 1 of argv) with title (item 2 of argv) default answer (item 3 of argv) buttons {item 4 of argv, item 5 of argv} default button (item 5 of argv) cancel button (item 4 of argv))\nend run', prompt, title, initial, t('Annuler'), t('Continuer')]).trim();}
  catch {return null;}
}

async function login(id) {
  const p = profile(id);
  if ((await auth(p)).loggedIn) throw new Error(t('Ce compte est déjà connecté. Ajoute un profil pour un autre compte.'));
  await childExit(spawn(binary('claude') || 'claude', ['auth', 'login', '--claudeai'], {env: environment(p.dir), cwd: os.homedir(), stdio: 'inherit'}));
  if (!process.exitCode) await usable(p);
  refresh();
}

async function menu() {
  const accounts = await Promise.all(profiles().map(async p => {
    try {const a = {...p, ...await auth(p, {cached: true})}; return {...a, usage: loadUsage(a)};}
    catch {return {...p, error: true};}
  }));
  const snapshot = await inventory({checkShells: true});
  const job = read(path.join(ROOT, 'transfer.json'), null);
  if (job?.running && !alive(job.pid)) {
    job.running = false;
    for (const row of job.rows) if (!['done', 'error', 'cancelled'].includes(row.stage)) {row.stage = 'error'; row.error = t('Bascule interrompue. Ouvre la session avant de réessayer.');}
    write(path.join(ROOT, 'transfer.json'), job);
  }
  const failure = read(path.join(ROOT, 'error.json'), {});
  let update = null;
  try {update = await (await import('./update.mjs')).check();} catch {}
  console.log(render({accounts, update, ...snapshot, selected: read(path.join(ROOT, 'selection.json'), {id: 'system'}).id,
    error: failure.at > Date.now() - 10 * 60 * 1000 ? failure.message : null, job}));
}

async function direct(args) {
  if (passthrough(args) || !process.stdin.isTTY) return childExit(spawn(binary('claude') || 'claude', args, {stdio: 'inherit'}));
  const id = read(path.join(ROOT, 'selection.json'), {id: 'system'}).id;
  await usable(profile(id));
  const python = binary('python3');
  if (!python) throw new Error(t('Python 3 est requis pour le mode direct. Relance Install.command.'));
  return childExit(spawn(python, [path.join(HERE, 'supervisor.py'), process.execPath, SELF, id, ...args], {stdio: 'inherit', env: {...process.env, SWITCHBOARD_LANG: language()}}));
}

async function doctor() {
  console.log(t('Claude Switchboard · diagnostic local'));
  for (const name of ['claude', 'python3', 'tmux']) console.log(`${name}: ${t(binary(name) ? 'disponible' : 'absent')}`);
  const {sessions, errors} = await inventory({checkShells: true});
  console.log(t('{profiles} profils · {controllable}/{total} sessions contrôlables', {profiles: profiles().length, controllable: sessions.filter(s => !s.unsupported).length, total: sessions.length}));
  for (const [name, adapter] of Object.entries(adapters)) console.log(`${name}: ${t(adapter.available() ? 'disponible' : 'non installé')}`);
  for (const message of errors) console.log(message);
  if (errors.length) process.exitCode = 1;
}

export async function main(argv = process.argv.slice(2)) {
  setup();
  const [command = 'menu', id, ...args] = argv;
  if (command === 'menu') return menu();
  if (command === 'direct' || command === 'claude') return direct(argv.slice(1));
  if (command === 'start') return startClaude(id, {args});
  if (command === 'resume') return startClaude(id, {sessionId: args[0], receiptId: args[1], args: resumeArguments(args.slice(2))});
  if (command === 'transfer') return (await import('./transfer.mjs')).transfer(id, args[0]);
  if (command === 'doctor') return doctor();
  write(path.join(ROOT, 'error.json'), {});
  if (command === 'add') {
    const name = id || textDialog(t('Nom court du compte'), t('Ajouter un compte Claude'), t('Personnel'));
    if (name) await login(newProfile(name));
  } else if (command === 'login') await login(id);
  else if (command === 'rename') {
    const p = profile(id), name = args[0] || textDialog(t('Nom affiché dans la barre'), t('Renommer le compte'), p.name);
    if (name) renameProfile(id, name);
  } else if (command === 'remove') {
    const p = profile(id), state = await auth(p);
    const snapshot = await inventory();
    if (snapshot.errors.length && state.loggedIn) throw new Error(t('Vérifie les sessions ouvertes avant de retirer ce compte.'));
    if (state.loggedIn) {
      try {run('/usr/bin/osascript', ['-e', 'on run argv\ndisplay dialog (item 1 of argv) buttons {item 2 of argv, item 3 of argv} default button (item 2 of argv) cancel button (item 2 of argv)\nend run', t('Retirer {name} du menu ? Le profil sera archivé localement.', {name: p.name}), t('Annuler'), t('Retirer')]);} catch {return;}
    }
    removeProfile(id, ROOT, snapshot.sessions);
  } else if (command === 'switch') {
    await usable(profile(id));
    if (alive(read(path.join(ROOT, 'transfer.lock'), {})?.pid)) throw new Error(t('Une bascule est déjà en cours.'));
    const child = spawn(process.execPath, [SELF, 'transfer', id], {detached: true, stdio: 'ignore'});
    child.once('error', () => {write(path.join(ROOT, 'error.json'), {message: t('Impossible de lancer la bascule.'), at: Date.now()}); refresh();});
    child.unref();
  } else if (command === 'cancel') {
    const job = read(path.join(ROOT, 'transfer.json'), null);
    if (job?.running) write(path.join(ROOT, 'cancel.json'), {id: job.id});
  } else if (command === 'focus') {
    const row = (await inventory()).sessions.find(s => s.handle === id);
    if (!row) throw new Error(t('Session terminée ou inaccessible.'));
    await adapters[row.adapter].focus(row);
  } else if (command === 'dismiss') {
    // error.json was cleared above.
  } else if (command === 'update') await (await import('./update.mjs')).install();
  else if (command === 'help') run('/usr/bin/open', [path.join(HERE, '../README.md')]);
  else throw new Error(t('Commande inconnue. Commandes : claude, menu, doctor, add, switch, cancel.'));
  refresh();
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main().catch(error => {
  const message = /spawn|Command failed/.test(error.message) ? t('Service indisponible. Lance le diagnostic depuis le menu.') : error.message;
  try {write(path.join(ROOT, 'error.json'), {message: clean(message), at: Date.now()}); refresh();} catch {}
  if (!process.argv[2] || process.argv[2] === 'menu') console.log(`${t('Claude · à vérifier')} | sfimage=exclamationmark.triangle\n---\n${t('Installation à vérifier. Lance Install.command.')}`);
  else {console.error(message); process.exitCode = 1;}
});
