import * as orca from './orca.mjs';
import * as tmux from './tmux.mjs';
import * as direct from './direct.mjs';
import * as herdr from './herdr.mjs';
import * as macos from './macos.mjs';
import {liveSessions, terminalHost} from '../native.mjs';
import {trackedSession} from '../tracking.mjs';
import path from 'node:path';
import {ROOT, read} from '../store.mjs';
import {t} from '../i18n.mjs';
export {validateTranscript} from './orca.mjs';
export const adapters = {direct, tmux, herdr, orca, macos};

export function resolve(sessions) {
  const priority = Object.keys(adapters), chosen = new Map(), unresolved = [];
  for (const row of sessions) {
    if (!row.claudePid) {unresolved.push(row); continue;}
    const key = `${row.claudePid}:${row.processStamp}`;
    const previous = chosen.get(key);
    if (!previous || priority.indexOf(row.adapter) < priority.indexOf(previous.adapter)) chosen.set(key, row);
  }
  return [...chosen.values(), ...unresolved];
}

export async function inventory({checkShells = false} = {}) {
  const sessions = [], errors = [];
  let records = [];
  try {records = liveSessions();} catch {errors.push(t('Registre Claude illisible : inventaire incomplet'));}
  const enabled = read(path.join(ROOT, 'config.json'), {}).adapters || Object.keys(adapters);
  const results = await Promise.all(Object.entries(adapters).map(async ([name, adapter]) => {
    if (!enabled.includes(name) || !adapter.available()) return {name, rows: []};
    try {return {name, rows: await adapter.inventory({checkShells, records})};}
    catch {return {name, error: t('{name} indisponible : inventaire incomplet', {name})};}
  }));
  for (const result of results) {
    if (result.error) {errors.push(result.error); continue;}
    for (const row of result.rows) {
      const record = trackedSession(row.provider?.id);
      const exact = record && (!row.claudePid || row.claudePid === record.pid) ? record : null;
      sessions.push({...row, claudePid: row.claudePid || exact?.pid, processStamp: row.processStamp || exact?.processStamp,
        accountId: exact?.accountId || row.accountId, accountEmail: exact?.email || row.accountEmail});
    }
  }
  const resolved = resolve(sessions);
  for (const record of records) {
    if (resolved.some(r => r.claudePid === record.pid)) continue;
    const host = terminalHost(record.pid);
    resolved.push({adapter: 'unmanaged', host, handle: `unmanaged:${record.pid}`, incarnationId: record.processStamp,
      claudePid: record.pid, processStamp: record.processStamp, connected: true, state: record.state,
      worktreePath: record.cwd, name: path.basename(record.cwd || ''), accountId: record.accountId, accountEmail: record.email,
      unsupported: t('{host} détecté ; contrôle de cette session non disponible. Voir la matrice de compatibilité.', {host}),
      provider: {id: record.sessionId, key: 'session_id', transcriptPath: record.transcriptPath}});
  }
  return {sessions: resolved, errors};
}
