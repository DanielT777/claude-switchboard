import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROOT, CLAUDE_HOME, read, write} from './store.mjs';
import {profile, profiles, newProfile, rememberIdentity, sameAccount} from './accounts.mjs';
import {claudeConfig} from './usage.mjs';
import {t} from './i18n.mjs';

// Claude Code keeps its login in one macOS keychain item per config folder and rereads it on every request
// (30 s cache). Switching accounts is swapping that item: every open session follows, nothing restarts.
// Inactive logins wait in Switchboard's own items, which no Claude process reads or refreshes.
const USER = /^[a-zA-Z0-9._-]+$/.test(process.env.USER || os.userInfo().username) ? process.env.USER || os.userInfo().username : 'claude-code-user';
export const VAULT = 'Claude Switchboard';
const DEFAULT_HOME = path.join(os.homedir(), '.claude');

// Same naming as Claude: no suffix for ~/.claude, else the first 8 hex of the folder's sha256.
export function slot(dir = CLAUDE_HOME === DEFAULT_HOME ? null : CLAUDE_HOME) {
  return `Claude Code-credentials${dir ? `-${crypto.createHash('sha256').update(dir.normalize('NFC')).digest('hex').slice(0, 8)}` : ''}`;
}

function security(args, input) {
  return execFileSync('/usr/bin/security', args, {encoding: 'utf8', timeout: 5000, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']});
}

export const keychain = {
  read(service, account = USER) {
    let value;
    try {value = security(['find-generic-password', '-a', account, '-s', service, '-w']).trim();}
    catch (error) {if (error.status === 44) return null; throw new Error(t('Trousseau macOS inaccessible. Déverrouille-le puis réessaie.'));}
    if (/^([0-9a-f]{2})+$/i.test(value)) value = Buffer.from(value, 'hex').toString('utf8');
    try {return JSON.parse(value);} catch {throw new Error(t('Connexion enregistrée illisible.'));}
  },
  write(service, data, account = USER) {
    const hex = Buffer.from(JSON.stringify(data), 'utf8').toString('hex'), command = `add-generic-password -U -a "${account}" -s "${service}" -X "${hex}"\n`;
    // Like Claude: stdin keeps the secret out of the process list when it fits, argv otherwise.
    if (command.length <= 4032) security(['-i'], command);
    else security(['add-generic-password', '-U', '-a', account, '-s', service, '-X', hex]);
    if (JSON.stringify(this.read(service, account)) !== JSON.stringify(data)) throw new Error(t('Le trousseau n’a pas enregistré la connexion.'));
  },
  remove(service, account = USER) {try {security(['delete-generic-password', '-a', account, '-s', service]);} catch {}},
};

// Claude's own lock around its keychain writes (a proper-lockfile directory, stale after 15 s).
function storageLock(home = CLAUDE_HOME) {
  const lock = path.join(home, '.storage-write.lock');
  for (let i = 0; ; i++) {
    try {fs.mkdirSync(lock); return () => fs.rmSync(lock, {recursive: true, force: true});}
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - fs.statSync(lock).mtimeMs > 15000) {fs.rmSync(lock, {recursive: true, force: true}); continue;}
      if (i >= 50) throw new Error(t('Claude enregistre sa connexion. Réessaie dans un instant.'));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

const identityOf = account => account?.emailAddress ? {email: account.emailAddress, orgId: account.organizationUuid} : null;
const metaFile = id => path.join(ROOT, 'vault', `${id}.json`);
export const saved = id => read(metaFile(id), null);
const selection = () => path.join(ROOT, 'selection.json');

function remember(p, account, oauth) {
  const identity = identityOf(account);
  write(metaFile(p.id), {...identity, orgName: account.organizationName, plan: oauth?.subscriptionType, oauthAccount: account, at: Date.now()});
  rememberIdentity(p, identity);
}

// The account whose login is live, as a profile. A login made outside the menu (/login) becomes an account.
export function current(list = profiles(), config = read(claudeConfig(), {})) {
  const live = identityOf(config.oauthAccount);
  if (!live) return null;
  const selected = read(selection(), {}).id, matches = list.filter(p => sameAccount(p.identity, live));
  let p = matches.find(m => m.id === selected) || matches[0];
  if (!p) {
    const system = list.find(m => m.id === 'system');
    p = system && !system.identity ? system : profile(newProfile(live.email.split('@')[0]));
    rememberIdentity(p, live);
  }
  if (selected !== p.id) write(selection(), {id: p.id});
  return {...p, ...live, orgName: config.oauthAccount.organizationName};
}

export function activate(targetId, keys = keychain) {
  const target = profile(targetId), file = claudeConfig();
  const release = storageLock();
  try {
    const from = current();
    if (from?.id === targetId) return;
    const login = keys.read(VAULT, targetId), meta = saved(targetId);
    if (!login?.claudeAiOauth || !meta?.oauthAccount) throw new Error(t('Connecte {name} avant de basculer.', {name: target.name}));
    const live = keys.read(slot()) || {};
    // Keep the outgoing login with any token Claude refreshed since it was loaded: a login is never dropped.
    // ponytail: a refresh in flight during these few ms keeps its new token in the live item only; that account then needs one reconnect.
    if (from && live.claudeAiOauth) {
      keys.write(VAULT, {claudeAiOauth: live.claudeAiOauth}, from.id);
      remember(from, read(file, {}).oauthAccount, live.claudeAiOauth);
    }
    keys.write(slot(), {...live, claudeAiOauth: login.claudeAiOauth}); // MCP logins in the same item stay put.
    write(file, {...read(file, {}), oauthAccount: meta.oauthAccount});
    write(selection(), {id: targetId, at: Date.now()});
  } finally {release();}
}

// A fresh login made in a throwaway folder: stored for later, or made live when it is the current account.
export function adopt(p, dir, keys = keychain) {
  const login = keys.read(slot(dir)), account = read(path.join(dir, '.claude.json'), {}).oauthAccount, identity = identityOf(account);
  if (!login?.claudeAiOauth || !identity) throw new Error(t('Connexion non retrouvée. Réessaie.'));
  if (p.identity && !sameAccount(p.identity, identity)) throw new Error(t('Connecté à {email}, pas au compte attendu. Rien n’a changé.', {email: identity.email}));
  const release = storageLock();
  try {
    if (current()?.id === p.id) {
      keys.write(slot(), {...(keys.read(slot()) || {}), claudeAiOauth: login.claudeAiOauth});
      write(claudeConfig(), {...read(claudeConfig(), {}), oauthAccount: account});
    } else keys.write(VAULT, {claudeAiOauth: login.claudeAiOauth}, p.id);
    remember(p, account, login.claudeAiOauth);
  } finally {release();}
}

export function forget(id, keys = keychain) {
  keys.remove(VAULT, id);
  fs.rmSync(metaFile(id), {force: true});
}

// Sessions started before hot switching run in a profile folder with their own login and do not follow. Their folder names.
export function legacySessions(list = profiles()) {
  const names = [];
  for (const p of list) {
    const dir = p.dir && path.join(p.dir, 'sessions');
    for (const file of dir && fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      try {if (/^\d+\.json$/.test(file) && process.kill(Number(file.slice(0, -5)), 0)) names.push(path.basename(read(path.join(dir, file), {}).cwd || '?'));} catch {}
    }
  }
  return names;
}
