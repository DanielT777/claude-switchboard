import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {processTable, shellJobs} from '../shells.mjs';
import {ROOT, CLAUDE_HOME, read} from '../store.mjs';
import {liveSessions, emptyPrompt} from '../native.mjs';
import {t} from '../i18n.mjs';
const require = createRequire(import.meta.url);
let client;

export function available() {
  return !!clientPath();
}
function clientPath() {
  const configured = read(path.join(ROOT, 'config.json'), {}).orcaApp;
  return [configured, '/Applications/Orca.app', path.join(os.homedir(), 'Applications/Orca.app')]
    .filter(Boolean).map(app => path.join(app, 'Contents/Resources/app.asar.unpacked/out/cli/runtime-client.js'))
    .find(file => fs.existsSync(file));
}

export async function rpc(method, args = {}) {
  if (!client) {
    const file = clientPath();
    if (!file) throw new Error(t('Orca introuvable. Installe Orca ou utilise tmux.'));
    const {RuntimeClient} = require(file);
    client = new RuntimeClient(undefined, 7000, null, null);
  }
  const reply = await client.call(method, args);
  if (!reply.ok) throw new Error(t('Orca ne confirme pas cette opération.'));
  return reply.result;
}

export async function inventory({checkShells = false, records = liveSessions()} = {}) {
  const list = await rpc('terminal.list', {includeVisualLayouts: false, requireFreshPtyLiveness: true});
  if (!Array.isArray(list.terminals) || list.truncated) throw new Error(t('Inventaire Orca incomplet.'));
  const {snapshots} = await rpc('session.tabs.listAll');
  if (!Array.isArray(snapshots)) throw new Error(t('Version Orca incompatible : état des sessions absent.'));
  const tabs = new Map(snapshots.flatMap(s => s.tabs.map(tab => [tab.terminal, tab])));
  const table = checkShells ? processTable() : null;
  const rows = (await Promise.all(list.terminals.filter(term => term.executionHostId === 'local').map(async term => {
    const tab = tabs.get(term.handle), status = tab?.agentStatus;
    const row = {adapter: 'orca', handle: term.handle, ptyId: term.ptyId, incarnationId: term.incarnationId,
      worktreeId: term.worktreeId, worktreePath: term.worktreePath, tabId: term.tabId, leafId: term.leafId,
      name: path.basename(term.worktreePath || '') || t('Terminal libre'), connected: term.connected,
      state: status?.state || 'unknown', model: status?.model,
      provider: status?.providerSession, updatedAt: status?.updatedAt};
    let p, record;
    try {
      p = await inspected(row);
      const evidence = p.foregroundProcessEvidence;
      if (evidence?.verdict === 'live' && verifyFence(evidence.fence)) record = records.find(r => r.pid === evidence.fence.process.pid);
    } catch {row.state = 'unknown';}
    if (!record && term.agentIdentity !== 'claude') return null;
    if (record) {
      Object.assign(row, {claudePid: record.pid, processStamp: record.processStamp, accountId: record.accountId, accountEmail: record.email});
      if (record.cwd) row.worktreePath = record.cwd;
      row.state = status?.state === 'permission' ? 'permission' : record.state;
      row.provider = {id: record.sessionId, key: 'session_id', transcriptPath: record.transcriptPath};
    }
    if (checkShells) row.shells = await shellActivity(row, table, p);
    return row;
  }))).filter(Boolean);
  return rows;
}

export function validateTranscript(row, base = path.join(CLAUDE_HOME, 'projects')) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.provider?.id || '') || row.provider.key !== 'session_id') throw new Error(t('Identifiant de conversation manquant.'));
  const file = fs.realpathSync(row.provider.transcriptPath);
  const root = fs.realpathSync(base);
  if (!file.startsWith(root + path.sep) || path.basename(file) !== `${row.provider.id}.jsonl` || !fs.statSync(file).isFile()) throw new Error(t('Historique non partagé ou non reconnu.'));
  return file;
}

export async function inspected(row) {
  const {process: p} = await rpc('terminal.inspectProcess', {terminal: row.handle, expectedIncarnationId: row.incarnationId, scanChildProcesses: true});
  return p;
}

export function verifyFence(fence) {
  if (!fence || !Number.isInteger(fence.process?.pid) || fence.process.pid < 2 || !fence.process.startTime || !fence.tty) return false;
  const value = execFileSync('/bin/ps', ['-p', String(fence.process.pid), '-o', 'lstart=', '-o', 'tty='], {encoding: 'utf8'}).trim().replace(/\s+/g, ' ');
  return value === `${fence.process.startTime} ${fence.tty}`.trim().replace(/\s+/g, ' ');
}

export const isIdle = state => state === 'done' || state === 'idle';

export async function shellActivity(row, table, inspection) {
  try {
    const p = inspection || await inspected(row);
    const evidence = p.foregroundProcessEvidence;
    if (evidence?.verdict !== 'live' || !/^(claude|claude-code)$/.test(evidence.processName || '') || !verifyFence(evidence.fence)) {
      return {known: false, count: 0};
    }
    return shellJobs(table || processTable(), evidence.fence.process.pid);
  } catch {return {known: false, count: 0};}
}

export async function stopClaude(row) {
  const live = (await inventory()).find(r => r.handle === row.handle);
  if (!live || live.incarnationId !== row.incarnationId || live.provider?.id !== row.provider.id || !isIdle(live.state)) throw new Error(t('Session changée ou encore occupée. Aucune interruption.'));
  const p = await inspected(row);
  const evidence = p.foregroundProcessEvidence;
  if (evidence?.verdict !== 'live' || !/^(claude|claude-code)$/.test(evidence.processName || '') || !verifyFence(evidence.fence)) throw new Error(t('Processus Claude non confirmé.'));
  const shells = await shellActivity(row, undefined, p);
  if (!shells.known || shells.count) throw new Error(t('Activité shell en cours ou non confirmée. Aucun arrêt effectué.'));
  const {terminal: screen} = await rpc('terminal.read', {terminal: row.handle, screen: true, limit: 100});
  if (screen?.source !== 'screen' || screen.draft || !Array.isArray(screen.tail) || !emptyPrompt(screen.tail.join('\n'))) throw new Error(t('Saisie en cours ou invite Claude non reconnue.'));
  // Exit through Claude itself. Never kill arbitrary Node processes or the shared shell.
  const result = await rpc('terminal.send', {terminal: row.handle, expectedIncarnationId: row.incarnationId, text: '/exit', enter: true});
  if (result.accepted === false) throw new Error(t('Fermeture refusée par Orca.'));
}

export async function shellReady(row) {
  const p = await inspected(row);
  return p.foregroundProcessEvidence?.verdict === 'live' && p.hasChildProcesses === false &&
    (p.foregroundProcess === null || /^(zsh|bash|fish|sh)$/.test(p.foregroundProcess || ''));
}

export async function start(row, command) {
  if (!await shellReady(row)) throw new Error(t('Terminal occupé avant la reprise.'));
  const result = await rpc('terminal.send', {terminal: row.handle, expectedIncarnationId: row.incarnationId, text: command, enter: true});
  if (result.accepted === false) throw new Error(t('Reprise refusée par Orca.'));
}
export const focus = row => rpc('terminal.switch', {terminal: row.handle});
