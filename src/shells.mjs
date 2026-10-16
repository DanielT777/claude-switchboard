import {execFileSync} from 'node:child_process';
import {t} from './i18n.mjs';

const SHELL_JOB = /^(?:-?(?:sh|bash|zsh|fish|dash|ksh)|watch|sleep|tail|timeout|gtimeout)$/;

export function parseProcesses(text) {
  const rows = text.trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) throw new Error(t('Inventaire des processus incomplet.'));
    return {pid: Number(match[1]), ppid: Number(match[2]), name: match[3]};
  });
  if (new Set(rows.map(row => row.pid)).size !== rows.length) throw new Error(t('Inventaire des processus incohérent.'));
  return rows;
}

export function processTable() {
  // ucomm is the executable name only. Never collect argv or environment secrets.
  return parseProcesses(execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,ucomm='], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

export function shellJobs(rows, claudePid) {
  // The caller verifies Orca's process fence. Native Claude can have a version-number executable name.
  if (!rows.some(row => row.pid === claudePid)) {
    return {known: false, count: 0};
  }
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row);
  }
  const seen = new Set([claudePid]), pending = [claudePid];
  let count = 0;
  while (pending.length) {
    for (const child of children.get(pending.pop()) || []) {
      if (seen.has(child.pid)) return {known: false, count: 0};
      seen.add(child.pid);
      // One shell tree is one job, not a separate job for bash and its sleep child.
      if (SHELL_JOB.test(child.name)) count++;
      else pending.push(child.pid);
    }
  }
  // shortcut: detached jobs and Node/Python-only monitors need provider task metadata to classify safely.
  return {known: true, count};
}
