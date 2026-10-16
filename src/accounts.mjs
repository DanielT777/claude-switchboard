import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT, CLAUDE_HOME, UUID, read, write, binary, alive} from './store.mjs';
import {t} from './i18n.mjs';
const exec = promisify(execFile);

export function environment(directory, source = process.env) {
  const env = {...source};
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$|ORCA_|SWIFTBAR|SWITCHBOARD_ACCOUNT_|SWITCHBOARD_RECEIPT)/.test(key)) delete env[key];
  }
  if (directory) env.CLAUDE_CONFIG_DIR = directory;
  else if (CLAUDE_HOME !== path.join(os.homedir(), '.claude')) env.CLAUDE_CONFIG_DIR = CLAUDE_HOME;
  return env;
}

export function profile(id, root = ROOT) {
  if (id === 'system') return {id, name: read(path.join(root, 'system.json'), {}).name || t('Principal')};
  if (!UUID.test(id || '')) throw new Error(t('Identifiant de connexion invalide.'));
  const dir = path.join(root, 'profiles', id);
  const meta = read(path.join(dir, 'profile.json'), null);
  if (meta?.id !== id || typeof meta.name !== 'string') throw new Error(t('Ce compte n’existe plus. Le menu a été actualisé.'));
  return {id, name: meta.name, dir};
}

export function profiles(root = ROOT) {
  return [profile('system', root), ...fs.readdirSync(path.join(root, 'profiles')).filter(id => UUID.test(id)).map(id => profile(id, root))];
}

export async function auth(p, {cached = false} = {}) {
  const file = path.join(ROOT, 'auth', `${p.id}.json`);
  const previous = read(file, null);
  if (cached && previous?.at > Date.now() - 60000) return previous;
  let stdout;
  try {
    ({stdout} = await exec(binary('claude') || 'claude', ['auth', 'status', '--json'], {
      encoding: 'utf8', timeout: 7000, maxBuffer: 1024 * 1024, env: environment(p.dir), cwd: os.homedir(),
    }));
  } catch (error) {
    if (error.code === 1 && error.stdout) stdout = error.stdout;
    else throw new Error(t('Connexion Claude non vérifiable pour le moment.'));
  }
  let data;
  try {data = JSON.parse(stdout);} catch {throw new Error(t('Réponse de connexion Claude non reconnue.'));}
  if (typeof data.loggedIn !== 'boolean') throw new Error(t('État de connexion non reconnu.'));
  const value = {loggedIn: data.loggedIn, method: data.authMethod, email: data.email, plan: data.subscriptionType, at: Date.now()};
  write(file, value);
  return value;
}

export async function usable(p) {
  const info = await auth(p);
  if (!info.loggedIn || info.method !== 'claude.ai') throw new Error(t('Connecte ce compte Claude avant de le sélectionner.'));
  if (typeof info.email !== 'string' || !info.email.trim()) throw new Error(t('L’identité du compte Claude ne peut pas être confirmée.'));
  return info;
}

export function validName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 50 || /[\x00-\x1f\x7f|]/.test(name)) throw new Error(t('Utilise un nom de 1 à 50 caractères sans caractères de contrôle.'));
  return name.trim();
}

export function newProfile(name, root = ROOT, source = CLAUDE_HOME) {
  name = validName(name);
  const id = crypto.randomUUID(), dir = path.join(root, 'profiles', id);
  fs.mkdirSync(dir, {mode: 0o700});
  fs.mkdirSync(path.join(source, 'projects'), {recursive: true, mode: 0o700});
  for (const entry of ['settings.json', 'commands', 'agents', 'projects', 'plugins', 'file-history', 'tasks', 'plans', 'todos', 'CLAUDE.md', 'keybindings.json', 'output-styles', 'hooks']) {
    if (fs.existsSync(path.join(source, entry))) fs.symlinkSync(path.join(source, entry), path.join(dir, entry));
  }
  fs.mkdirSync(path.join(dir, 'skills'), {mode: 0o700});
  syncSkills(dir, source);
  write(path.join(dir, 'profile.json'), {id, name});
  return id;
}

export function syncSkills(dir, source = CLAUDE_HOME) {
  if (!dir || !fs.existsSync(path.join(source, 'skills'))) return;
  fs.mkdirSync(path.join(dir, 'skills'), {recursive: true, mode: 0o700});
  for (const entry of fs.readdirSync(path.join(source, 'skills'))) {
    const target = path.join(dir, 'skills', entry);
    if (entry !== 'synced' && !fs.existsSync(target)) {
      try {fs.symlinkSync(path.join(source, 'skills', entry), target);} catch (error) {if (error.code !== 'EEXIST') throw error;}
    }
  }
}

export function renameProfile(id, name, root = ROOT) {
  const p = profile(id, root);
  write(id === 'system' ? path.join(root, 'system.json') : path.join(p.dir, 'profile.json'), {id, name: validName(name)});
}

export function removeProfile(id, root = ROOT, sessions = []) {
  if (id === 'system') throw new Error(t('Le compte principal est géré par Claude Code.'));
  const p = profile(id, root);
  const job = read(path.join(root, 'transfer.json'), null);
  if (alive(read(path.join(root, 'transfer.lock'), {})?.pid) || (job?.running && alive(job.pid))) throw new Error(t('Attends la fin de la bascule.'));
  if (read(path.join(root, 'selection.json'), {id: 'system'}).id === id) throw new Error(t('Sélectionne un autre compte avant de retirer celui-ci.'));
  if (sessions.some(s => s.accountId === id && s.connected !== false && s.state !== 'ended')) throw new Error(t('Ce compte est encore utilisé par une session.'));
  const destination = path.join(root, 'removed', `${id}-${Date.now()}`);
  fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
  // Archiving never follows the profile's symlinks or deletes shared conversations.
  fs.renameSync(p.dir, destination);
  fs.rmSync(path.join(root, 'auth', `${id}.json`), {force: true});
  return destination;
}
