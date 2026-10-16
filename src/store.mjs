import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {t} from './i18n.mjs';

export const ROOT = process.env.SWITCHBOARD_HOME || path.join(os.homedir(), '.config/claude-switchboard');
export const CLAUDE_HOME = process.env.SWITCHBOARD_CLAUDE_HOME || path.join(os.homedir(), '.claude');
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const profileId = id => id === 'system' || UUID.test(id || '');
export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
export const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f|]/g, ' ').replace(/:/g, 'ː').slice(0, 120);

export function read(file, fallback) {
  try {return JSON.parse(fs.readFileSync(file, 'utf8'));}
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(t('Fichier local illisible. Restaure sa sauvegarde avant de continuer.'));
  }
}

export function write(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600, flag: 'wx'});
    fs.renameSync(tmp, file);
  } finally {fs.rmSync(tmp, {force: true});}
}

export function setup(root = ROOT) {
  for (const name of ['', 'profiles', 'shared', 'receipts', 'sessions', 'usage', 'auth', 'removed']) {
    fs.mkdirSync(path.join(root, name), {recursive: true, mode: 0o700});
  }
}

export function alive(pid) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try {process.kill(pid, 0); return true;}
  catch (error) {if (error.code === 'ESRCH') return false; throw error;}
}

export function lock(root = ROOT) {
  const file = path.join(root, 'transfer.lock');
  if (fs.existsSync(file)) {
    const owner = read(file, {});
    if (alive(owner.pid)) throw new Error(t('Une bascule est déjà en cours.'));
    fs.unlinkSync(file);
  }
  const id = crypto.randomUUID();
  const fd = fs.openSync(file, 'wx', 0o600);
  fs.writeFileSync(fd, JSON.stringify({id, pid: process.pid})); fs.closeSync(fd);
  return () => {if (read(file, {})?.id === id) fs.unlinkSync(file);};
}

export function binary(name) {
  const configured = read(path.join(ROOT, 'config.json'), {}).binaries?.[name];
  const paths = [configured, ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name)),
    path.join(os.homedir(), '.local/bin', name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`];
  return paths.find(file => {try {fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile();} catch {return false;}});
}

export function run(name, args, options = {}) {
  const file = path.isAbsolute(name) ? name : binary(name);
  if (!file) throw new Error(t('{name} introuvable. Lance Install.command pour vérifier les dépendances.', {name}));
  return execFileSync(file, args, {encoding: 'utf8', timeout: 7000, maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], ...options});
}

export function refresh() {
  if (process.env.SWITCHBOARD_NO_REFRESH) return;
  try {run('/usr/bin/open', ['-g', 'swiftbar://refreshplugin?name=claude-switchboard.15s.sh']);} catch {}
}
