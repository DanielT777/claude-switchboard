import fs from 'node:fs';
import path from 'node:path';
import {ROOT, CLAUDE_HOME, UUID, read, run} from './store.mjs';
import {profiles} from './accounts.mjs';
import {claudeName, processStamp, trackedSession} from './tracking.mjs';
import {processTable} from './shells.mjs';
import {t} from './i18n.mjs';

export function findTranscript(id, home = CLAUDE_HOME) {
  if (!UUID.test(id || '')) return null;
  const projects = path.join(home, 'projects');
  if (!fs.existsSync(projects)) return null;
  for (const directory of fs.readdirSync(projects, {withFileTypes: true})) {
    if (!directory.isDirectory()) continue;
    const file = path.join(projects, directory.name, `${id}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  const flat = path.join(projects, `${id}.jsonl`);
  return fs.existsSync(flat) ? flat : null;
}

export function nativeRecord(record, table, stamp, utcStamp = stamp) {
  if (!record || record.kind !== 'interactive' || !UUID.test(record.sessionId || '') || !Number.isInteger(record.pid) || !record.procStart || !stamp) return null;
  if (!table.some(p => p.pid === record.pid && claudeName(p.name))) return null;
  if (![stamp, utcStamp].some(value => value?.startsWith(record.procStart.trim().replace(/\s+/g, ' ') + ' '))) return null;
  return {sessionId: record.sessionId, pid: record.pid, processStamp: stamp, cwd: record.cwd,
    state: record.status === 'idle' ? 'idle' : record.status === 'busy' ? 'working' : 'unknown',
    tty: stamp.split(' ').at(-1), at: record.updatedAt, native: true};
}

export function liveSessions() {
  const table = processTable(), live = new Map();
  const homes = profiles().map(p => ({id: p.id, home: p.dir || CLAUDE_HOME}));
  for (const {id, home} of homes) {
    const directory = path.join(home, 'sessions');
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory)) {
      if (!/^\d+\.json$/.test(file) || !table.some(p => p.pid === Number(file.slice(0, -5)) && claudeName(p.name))) continue;
      const data = read(path.join(directory, file), null);
      const record = nativeRecord(data, table, processStamp(data?.pid), processStamp(data?.pid, true));
      if (!record) continue;
      const candidate = trackedSession(record.sessionId);
      const hook = candidate?.pid === record.pid ? candidate : null;
      const blocked = hook && (hook.backgroundTasks || hook.scheduledTasks || hook.state === 'permission');
      live.set(record.pid, {...hook, ...record, state: blocked ? 'unknown' : record.state,
        transcriptPath: hook?.transcriptPath || findTranscript(record.sessionId, home), accountId: hook?.accountId || id});
    }
  }
  const hooks = path.join(ROOT, 'sessions');
  if (fs.existsSync(hooks)) for (const file of fs.readdirSync(hooks)) {
    const id = file.replace(/\.json$/, '');
    if (UUID.test(id)) {const record = trackedSession(id); if (record && !live.has(record.pid)) live.set(record.pid, {...record, tty: record.processStamp.split(' ').at(-1)});}
  }
  return [...live.values()];
}

export function foreground(tty) {
  if (!/^(ttys?\d+|pts\/\d+)$/.test(tty || '')) throw new Error(t('TTY non reconnu.'));
  const lines = run('/bin/ps', ['-t', tty, '-o', 'pid=,pgid=,tpgid=,ucomm=']).trim().split('\n');
  return lines.map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(-?\d+)\s+(.+)$/);
    if (!match) throw new Error(t('Processus du terminal non confirmés.'));
    return {pid: Number(match[1]), foreground: match[2] === match[3], name: match[4]};
  }).filter(p => p.foreground);
}

export function emptyPrompt(text) {
  const lines = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split('\n');
  const index = lines.findLastIndex(line => /^\s*❯/.test(line));
  if (index < 0 || !/^\s*❯\s*$/.test(lines[index])) return false;
  for (const line of lines.slice(index + 1)) {
    if (/^\s*[─━]{3,}/.test(line) || /^\s*\? for shortcuts/.test(line)) return true;
    if (line.trim()) return false;
  }
  return true;
}

export function terminalHost(pid, table = processTable()) {
  const byId = new Map(table.map(row => [row.pid, row])), seen = new Set();
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const p = byId.get(pid);
    if (!p) break;
    const match = p.name.match(/(?:^|\/)(ghostty|Terminal|iTerm2?|WezTerm|wezterm-gui|Alacritty|kitty|herdr|tmux|Warp|Orca)(?:$|[ :])/i);
    if (match) return match[1];
    pid = p.ppid;
  }
  return t('Terminal non identifié');
}

export function shellAncestor(pid, table) {
  const byId = new Map(table.map(row => [row.pid, row])), seen = new Set();
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const p = byId.get(pid);
    if (!p) return null;
    if (/^-?(zsh|bash|fish|sh)$/.test(p.name)) return p.pid;
    pid = p.ppid;
  }
  return null;
}
