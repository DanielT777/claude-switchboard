import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run} from '../store.mjs';
import {liveSessions, foreground, emptyPrompt, terminalHost, shellAncestor} from '../native.mjs';
import {processStamp, isIdle} from '../tracking.mjs';
import {processTable, shellJobs} from '../shells.mjs';
import {t} from '../i18n.mjs';

export const available = () => process.platform === 'darwin';
const script = fileURLToPath(new URL('./macos.js', import.meta.url));
export const control = (host, action, id = '', text = '') => JSON.parse(run('/usr/bin/osascript', ['-l', 'JavaScript', script, host, action, id, text]));

export async function inventory({records = liveSessions()} = {}) {
  const hosts = ['Terminal'];
  if (['/Applications/iTerm.app', path.join(os.homedir(), 'Applications/iTerm.app')].some(p => fs.existsSync(p))) hosts.push('iTerm');
  const rows = [];
  const table = processTable();
  for (const host of hosts) {
    // Avoid Automation permission prompts when this host has no Claude process.
    if (!records.some(r => terminalHost(r.pid, table).toLowerCase().startsWith(host.toLowerCase()))) continue;
    const panes = control(host, 'list');
    for (const pane of panes) {
      const matches = records.filter(r => pane.tty === `/dev/${r.tty}`);
      if (matches.length !== 1) continue;
      const record = matches[0];
      const shellPid = shellAncestor(record.pid, table), shellStamp = processStamp(shellPid);
      if (!shellStamp) continue;
      if (!foreground(record.tty).some(p => p.pid === record.pid)) continue;
      rows.push({adapter: 'macos', host, pane: pane.id, tty: record.tty, handle: `${host}:${pane.id}`, shellPid, shellStamp, incarnationId: `${host}:${pane.id}:${shellPid}:${shellStamp}`,
        connected: true, worktreePath: record.cwd, name: path.basename(record.cwd || ''),
        state: Date.now() - record.at >= 1000 ? record.state : 'unknown', claudePid: record.pid, processStamp: record.processStamp,
        accountId: record.accountId, accountEmail: record.email,
        provider: {id: record.sessionId, key: 'session_id', transcriptPath: record.transcriptPath},
        shells: shellJobs(processTable(), record.pid)});
    }
  }
  return rows;
}
function current(row) {
  if (processStamp(row.shellPid) !== row.shellStamp) throw new Error(t('Shell du terminal remplacé.'));
  if (!control(row.host, 'list').some(p => p.id === row.pane && p.tty === `/dev/${row.tty}`)) throw new Error(t('Onglet remplacé ou fermé.'));
  return foreground(row.tty);
}
export async function shellActivity(row) {
  if (processStamp(row.claudePid) !== row.processStamp) return {known: false, count: 0};
  return shellJobs(processTable(), row.claudePid);
}
export async function stopClaude(row) {
  if (!current(row).some(p => p.pid === row.claudePid)) throw new Error(t('Claude n’occupe plus cet onglet.'));
  const live = (await inventory()).find(r => r.handle === row.handle);
  if (!live || live.claudePid !== row.claudePid || live.provider.id !== row.provider.id || !isIdle(live.state)) throw new Error(t('Session changée ou occupée.'));
  const jobs = await shellActivity(row);
  if (!jobs.known || jobs.count) throw new Error(t('Activité shell en cours.'));
  if (!emptyPrompt(control(row.host, 'read', row.pane).text)) throw new Error(t('Saisie en cours ou invite Claude non reconnue.'));
  control(row.host, 'send', row.pane, '/exit');
}
export async function shellReady(row) {
  const processes = current(row);
  return processStamp(row.claudePid) !== row.processStamp && processes.length > 0 && processes.every(p => /^-?(zsh|bash|fish|sh)$/.test(p.name));
}
export async function start(row, command) {
  if (!await shellReady(row)) throw new Error(t('Le terminal ne rend pas la main au shell.'));
  control(row.host, 'send', row.pane, command);
}
export const focus = row => control(row.host, 'focus', row.pane);
