import path from 'node:path';
import {ROOT, CLAUDE_HOME, UUID, profileId, read, run} from './store.mjs';
import {processTable} from './shells.mjs';
import {t} from './i18n.mjs';

export const claudeName = name => /^(claude|claude-code|\d+\.\d+\.\d+)$/.test(name || '');
export const isIdle = state => state === 'done' || state === 'idle';

export function processStamp(pid, utc = false) {
  if (!Number.isInteger(pid) || pid < 2) return null;
  try {return run('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'tty='], utc ? {env: {...process.env, TZ: 'UTC'}} : {}).trim().replace(/\s+/g, ' ') || null;} catch {return null;}
}

export function claudeAncestor(rows = processTable(), pid = process.ppid) {
  const byId = new Map(rows.map(row => [row.pid, row]));
  const seen = new Set();
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    const row = byId.get(pid);
    if (!row) return null;
    if (claudeName(row.name)) return row.pid;
    pid = row.ppid;
  }
  return null;
}

export function accountFromEnvironment(env = process.env) {
  if (profileId(env.SWITCHBOARD_ACCOUNT_ID)) return env.SWITCHBOARD_ACCOUNT_ID;
  if (!env.CLAUDE_CONFIG_DIR || path.resolve(env.CLAUDE_CONFIG_DIR) === path.resolve(CLAUDE_HOME)) return 'system';
  const id = path.basename(env.CLAUDE_CONFIG_DIR);
  return UUID.test(id) && path.resolve(env.CLAUDE_CONFIG_DIR) === path.join(ROOT, 'profiles', id) ? id : null;
}

export function trackedSession(id, root = ROOT) {
  if (!UUID.test(id || '')) return null;
  const record = read(path.join(root, 'sessions', `${id}.json`), null);
  if (!record || record.sessionId !== id || record.state === 'ended' || !record.processStamp || processStamp(record.pid) !== record.processStamp) return null;
  return record;
}

export async function readInput(stream = process.stdin) {
  let input = '';
  for await (const chunk of stream) {
    input += chunk;
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error(t('Entrée trop volumineuse.'));
  }
  return input;
}
