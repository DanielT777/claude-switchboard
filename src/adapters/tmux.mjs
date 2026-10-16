import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {run, binary} from '../store.mjs';
import {processTable, shellJobs} from '../shells.mjs';
import {processStamp, claudeName, isIdle} from '../tracking.mjs';
import {liveSessions, emptyPrompt} from '../native.mjs';
import {t} from '../i18n.mjs';

export const available = () => !!binary('tmux');
const handle = (socket, pane) => `tmux:${crypto.createHash('sha256').update(socket).digest('hex').slice(0, 12)}:${pane}`;

export function parsePanes(text, socket) {
  return text.trimEnd().split('\n').filter(Boolean).map(line => {
    const [pane, pid, command, tty, cwd, mode, dead, ...extra] = line.split('\t');
    if (extra.length || !/^%\d+$/.test(pane) || !/^\d+$/.test(pid) || !tty || !cwd || !/^[01]$/.test(mode) || !/^[01]$/.test(dead)) throw new Error(t('Inventaire tmux non reconnu.'));
    return {handle: handle(socket, pane), socket, pane, pid: Number(pid), command, tty, cwd, blocked: mode === '1' || dead === '1'};
  });
}

function panes(socket) {
  if (socket) {
    const stat = fs.statSync(socket);
    if (!stat.isSocket() || stat.uid !== process.getuid()) throw new Error(t('Socket tmux non reconnu.'));
  }
  return parsePanes(run('tmux', [...(socket ? ['-S', socket] : []), 'list-panes', '-a', '-F', '#{pane_id}\t#{pane_pid}\t#{pane_current_command}\t#{pane_tty}\t#{pane_current_path}\t#{pane_in_mode}\t#{pane_dead}']), socket);
}

export function descendsFrom(table, pid, ancestor) {
  const byId = new Map(table.map(row => [row.pid, row.ppid])), seen = new Set();
  while (pid && !seen.has(pid)) {
    if (pid === ancestor) return true;
    seen.add(pid); pid = byId.get(pid);
  }
  return false;
}

export function discoverSockets(records = []) {
  const sockets = new Set(records.map(r => r.tmux?.socket).filter(Boolean));
  if (process.env.TMUX) sockets.add(process.env.TMUX.split(',')[0]);
  for (const base of new Set(['/tmp', os.tmpdir(), process.env.TMUX_TMPDIR].filter(Boolean))) {
    const directory = path.join(base, `tmux-${process.getuid()}`);
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSocket() && stat.uid === process.getuid()) sockets.add(fs.realpathSync(file));
    }
  }
  return [...new Set([...sockets].filter(file => fs.existsSync(file)).map(file => fs.realpathSync(file)))];
}

export async function inventory({records = liveSessions()} = {}) {
  if (!available()) return [];
  const sockets = discoverSockets(records);
  const table = processTable(), rows = [];
  for (const socket of sockets) {
    let list;
    try {list = panes(socket);} catch (error) {
      if (/no server running|Connection refused/.test(String(error.stderr || ''))) continue;
      throw error;
    }
    for (const pane of list) {
      const record = records.find(r => descendsFrom(table, r.pid, pane.pid) && r.tty === pane.tty.replace(/^\/dev\//, ''));
      if (!record) continue;
      rows.push({adapter: 'tmux', handle: pane.handle, socket, pane: pane.pane, panePid: pane.pid,
        incarnationId: `${pane.pid}:${processStamp(pane.pid)}`, connected: true,
        worktreePath: record.cwd || pane.cwd, name: path.basename(record.cwd || pane.cwd),
        state: !pane.blocked && (claudeName(pane.command) || pane.command === 'node') && Date.now() - record.at > 1000 ? record.state : 'unknown',
        accountId: record.accountId, accountEmail: record.email, claudePid: record.pid, processStamp: record.processStamp,
        provider: {id: record.sessionId, key: 'session_id', transcriptPath: record.transcriptPath},
        shells: shellJobs(table, record.pid)});
    }
  }
  return rows;
}

export async function shellActivity(row) {
  if (processStamp(row.claudePid) !== row.processStamp) return {known: false, count: 0};
  return shellJobs(processTable(), row.claudePid);
}

function currentPane(row) {
  const pane = panes(row.socket).find(p => p.pane === row.pane);
  if (!pane || `${pane.pid}:${processStamp(pane.pid)}` !== row.incarnationId || pane.blocked) throw new Error(t('Panneau tmux remplacé ou occupé.'));
  return pane;
}

export async function stopClaude(row) {
  currentPane(row);
  const current = (await inventory()).find(r => r.handle === row.handle);
  if (!current || !isIdle(current.state) || current.provider.id !== row.provider.id || current.claudePid !== row.claudePid) throw new Error(t('Session tmux changée ou encore occupée.'));
  const jobs = await shellActivity(row);
  if (!jobs.known || jobs.count) throw new Error(t('Activité shell en cours.'));
  const screen = run('tmux', ['-S', row.socket, 'capture-pane', '-p', '-t', row.pane]);
  if (!emptyPrompt(screen)) throw new Error(t('Saisie en cours ou invite Claude non reconnue.'));
  send(row, '/exit');
}

function send(row, text) {
  currentPane(row);
  const args = ['-S', row.socket, 'send-keys', '-t', row.pane];
  run('tmux', [...args, '-l', '--', text]);
  run('tmux', [...args, 'Enter']);
}

export async function shellReady(row) {
  const pane = currentPane(row);
  return /^(zsh|bash|fish|sh)$/.test(pane.command) && processStamp(row.claudePid) !== row.processStamp;
}

export async function start(row, command) {
  if (!await shellReady(row)) throw new Error(t('Le panneau tmux ne rend pas la main au shell.'));
  send(row, command);
}

export function focus(row) {
  currentPane(row);
  run('tmux', ['-S', row.socket, 'select-window', '-t', row.pane]);
  run('tmux', ['-S', row.socket, 'select-pane', '-t', row.pane]);
}
