import fs from 'node:fs';
import path from 'node:path';
import {request} from '../socket.mjs';
import {ROOT, UUID, read, run} from '../store.mjs';
import {processStamp, trackedSession, isIdle} from '../tracking.mjs';
import {processTable, shellJobs} from '../shells.mjs';
import {liveSessions} from '../native.mjs';
import {t} from '../i18n.mjs';

export const available = () => true;

export async function control(row, command, payload = {}) {
  const reply = await request(row.socket, {id: row.supervisorId, command, ...payload}, 16384);
  if (!reply.ok) throw new Error(reply.error || t('Opération refusée.'));
  return reply.result;
}

export async function inventory({records = liveSessions()} = {}) {
  const directory = path.join(ROOT, 'supervisors');
  if (!fs.existsSync(directory)) return [];
  const rows = [];
  for (const filename of fs.readdirSync(directory).filter(file => UUID.test(file.replace(/\.json$/, '')))) {
    const meta = read(path.join(directory, filename), null);
    if (!meta || meta.id !== filename.slice(0, -5)) continue;
    const record = read(path.join(directory, `${meta.id}.session.json`), null);
    if (!record || !trackedSession(record.sessionId)) continue;
    const row = {adapter: 'direct', handle: `direct:${meta.id}`, supervisorId: meta.id, socket: meta.socket,
      incarnationId: `${meta.id}:${meta.pid}`, supervisorPid: meta.pid, connected: true,
      worktreePath: record.cwd || meta.cwd, name: path.basename(record.cwd || meta.cwd), terminal: meta.terminal,
      accountId: record.accountId, accountEmail: record.email, claudePid: record.pid, processStamp: record.processStamp,
      provider: {id: record.sessionId, key: 'session_id', transcriptPath: record.transcriptPath}};
    try {
      const state = await control(row, 'status');
      if (state.pid !== meta.pid) continue;
      row.state = state.lastInputAt > record.at || Date.now() - record.at < 1000 || Date.now() - state.lastOutputAt < 750 ? 'unknown' : record.state;
      const native = records.find(r => r.pid === record.pid);
      if (native && !isIdle(native.state)) row.state = native.state;
      row.shells = await shellActivity(row);
      rows.push(row);
    } catch {throw new Error(t('Superviseur direct inaccessible : inventaire incomplet.'));}
  }
  return rows;
}

export async function shellActivity(row) {
  if (processStamp(row.claudePid) !== row.processStamp) return {known: false, count: 0};
  return shellJobs(processTable(), row.claudePid);
}

export async function stopClaude(row) {
  const current = (await inventory()).find(r => r.handle === row.handle);
  if (!current || current.incarnationId !== row.incarnationId || current.provider.id !== row.provider.id || !isIdle(current.state)) throw new Error(t('Session changée ou saisie en cours.'));
  const jobs = await shellActivity(row);
  if (!jobs.known || jobs.count) throw new Error(t('Activité shell en cours ou non confirmée.'));
  await control(row, 'stop', {sessionId: row.provider.id});
}

export const shellReady = async row => (await control(row, 'status')).ready === true;
export const start = (row, _command) => control(row, 'start', {sessionId: row.provider.id, accountId: row.targetId, receiptId: row.receiptId});

export function focus(row) {
  const applications = {Apple_Terminal: 'Terminal', iTerm: 'iTerm', 'iTerm.app': 'iTerm', ghostty: 'Ghostty', WezTerm: 'WezTerm', Alacritty: 'Alacritty'};
  const app = applications[row.terminal];
  if (!app) throw new Error(t('Ouvre le terminal dans lequel cette session a été lancée.'));
  run('/usr/bin/open', ['-a', app]);
}
