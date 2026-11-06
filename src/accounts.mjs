import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT, CLAUDE_HOME, UUID, read, write} from './store.mjs';
import {t} from './i18n.mjs';

export function environment(directory, source = process.env) {
  const env = {...source};
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$)/.test(key)) delete env[key];
  }
  if (directory) env.CLAUDE_CONFIG_DIR = directory;
  else if (CLAUDE_HOME !== path.join(os.homedir(), '.claude')) env.CLAUDE_CONFIG_DIR = CLAUDE_HOME;
  return env;
}

export function profile(id, root = ROOT) {
  if (id === 'system') {
    const meta = read(path.join(root, 'system.json'), {});
    return {id, name: meta.name || t('Principal'), identity: meta.identity};
  }
  if (!UUID.test(id || '')) throw new Error(t('Identifiant de connexion invalide.'));
  const dir = path.join(root, 'profiles', id);
  const meta = read(path.join(dir, 'profile.json'), null);
  if (meta?.id !== id || typeof meta.name !== 'string') throw new Error(t('Ce compte n’existe plus. Le menu a été actualisé.'));
  return {id, name: meta.name, dir, identity: meta.identity};
}

export const sameAccount = (a, b) => !!a?.email && !!a?.orgId && a.email === b?.email && a.orgId === b?.orgId;

export function rememberIdentity(p, account) {
  if (!account.email || !account.orgId) return;
  const file = p.id === 'system' ? path.join(ROOT, 'system.json') : path.join(p.dir, 'profile.json');
  write(file, {...read(file, {}), identity: {email: account.email, orgId: account.orgId}});
}

export function profiles(root = ROOT) {
  return [profile('system', root), ...fs.readdirSync(path.join(root, 'profiles')).filter(id => UUID.test(id)).map(id => profile(id, root))];
}

export function validName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 50 || /[\x00-\x1f\x7f|]/.test(name)) throw new Error(t('Utilise un nom de 1 à 50 caractères sans caractères de contrôle.'));
  return name.trim();
}

export function newProfile(name, root = ROOT) {
  name = validName(name);
  const id = crypto.randomUUID(), dir = path.join(root, 'profiles', id);
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  write(path.join(dir, 'profile.json'), {id, name});
  return id;
}

export function renameProfile(id, name, root = ROOT) {
  const p = profile(id, root);
  const file = id === 'system' ? path.join(root, 'system.json') : path.join(p.dir, 'profile.json');
  write(file, {...read(file, {}), id, name: validName(name)});
}

export function removeProfile(id, root = ROOT) {
  if (id === 'system') throw new Error(t('Le compte principal est géré par Claude Code.'));
  const p = profile(id, root);
  if (read(path.join(root, 'selection.json'), {}).id === id) throw new Error(t('Sélectionne un autre compte avant de retirer celui-ci.'));
  const destination = path.join(root, 'removed', `${id}-${Date.now()}`);
  fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
  // Archiving never follows symlinks a profile from an older version may hold, so shared conversations stay.
  fs.renameSync(p.dir, destination);
  return destination;
}
