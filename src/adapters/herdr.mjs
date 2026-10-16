import path from 'node:path';
import crypto from 'node:crypto';
import {binary, run} from '../store.mjs';
import {request} from '../socket.mjs';
import {liveSessions, emptyPrompt} from '../native.mjs';
import {processStamp, isIdle} from '../tracking.mjs';
import {processTable, shellJobs} from '../shells.mjs';
import {t} from '../i18n.mjs';

export const available = () => !!binary('herdr');
export async function rpc(socket, method, params = {}) {
  const id = crypto.randomUUID();
  const reply = await request(socket, {id, method, params});
  if (reply.id !== id || reply.error || !reply.result) throw new Error(t('Herdr ne confirme pas cette opération.'));
  return reply.result;
}

export function servers() {
  const data = JSON.parse(run('herdr', ['session', 'list', '--json']));
  if (!Array.isArray(data.sessions)) throw new Error(t('Inventaire Herdr non reconnu.'));
  return data.sessions.filter(s => s.running && path.isAbsolute(s.socket_path || ''));
}

export function identity(pane, process) {
  if (!pane?.pane_id || !pane.terminal_id || !Number.isInteger(process?.shell_pid) || !Array.isArray(process.foreground_processes)) throw new Error(t('Identité du panneau Herdr non confirmée (panneau, shell ou processus absent).'));
  const stamp = processStamp(process.shell_pid);
  if (!stamp) throw new Error(t('Shell Herdr introuvable.'));
  return `${pane.terminal_id}:${process.shell_pid}:${stamp}`;
}

export async function inventory({records = liveSessions()} = {}) {
  const rows = [];
  for (const server of servers()) {
    const {panes} = await rpc(server.socket_path, 'pane.list');
    if (!Array.isArray(panes)) throw new Error(t('Inventaire Herdr incomplet.'));
    await Promise.all(panes.map(async pane => {
      const {process_info: p} = await rpc(server.socket_path, 'pane.process_info', {pane_id: pane.pane_id});
      if (!Array.isArray(p?.foreground_processes)) throw new Error(t('Processus Herdr inconnus.'));
      const record = records.find(r => p.foreground_processes.some(f => f.pid === r.pid));
      if (!record) return;
      rows.push({adapter: 'herdr', handle: `herdr:${server.socket_path}:${pane.terminal_id}`, socket: server.socket_path,
        pane: pane.pane_id, incarnationId: identity(pane, p), connected: true,
        worktreePath: record.cwd, name: path.basename(record.cwd || ''),
        state: pane.agent_status === 'blocked' ? 'permission' : Date.now() - record.at >= 1000 ? record.state : 'unknown',
        claudePid: record.pid, processStamp: record.processStamp, accountId: record.accountId, accountEmail: record.email,
        provider: {id: record.sessionId, key: 'session_id', transcriptPath: record.transcriptPath},
        shells: shellJobs(processTable(), record.pid)});
    }));
  }
  return rows;
}

async function current(row) {
  const {pane} = await rpc(row.socket, 'pane.get', {pane_id: row.pane});
  const {process_info: p} = await rpc(row.socket, 'pane.process_info', {pane_id: row.pane});
  if (identity(pane, p) !== row.incarnationId) throw new Error(t('Panneau Herdr remplacé.'));
  return p;
}
export async function shellActivity(row) {
  if (processStamp(row.claudePid) !== row.processStamp) return {known: false, count: 0};
  return shellJobs(processTable(), row.claudePid);
}
export async function stopClaude(row) {
  await current(row);
  const live = (await inventory()).find(r => r.handle === row.handle);
  if (!live || live.claudePid !== row.claudePid || live.provider.id !== row.provider.id || !isIdle(live.state)) throw new Error(t('Session Herdr changée ou occupée.'));
  const jobs = await shellActivity(row);
  if (!jobs.known || jobs.count) throw new Error(t('Activité shell en cours.'));
  const {read} = await rpc(row.socket, 'pane.read', {pane_id: row.pane, source: 'visible', lines: 100});
  if (!emptyPrompt(read?.text || '')) throw new Error(t('Saisie en cours ou invite Claude non reconnue.'));
  await rpc(row.socket, 'pane.send_input', {pane_id: row.pane, text: '/exit', keys: ['enter']});
}
export async function shellReady(row) {
  let p;
  try {p = await current(row);} catch {return false;}
  return p.foreground_processes.length > 0 && p.foreground_processes.every(f => f.pid === p.shell_pid && /^-?(zsh|bash|fish|sh)$/.test(f.name)) && processStamp(row.claudePid) !== row.processStamp;
}
export async function start(row, command) {
  if (!await shellReady(row)) throw new Error(t('Le panneau Herdr ne rend pas la main au shell.'));
  await rpc(row.socket, 'pane.send_input', {pane_id: row.pane, text: command, keys: ['enter']});
}
export const focus = row => rpc(row.socket, 'pane.focus', {pane_id: row.pane});
