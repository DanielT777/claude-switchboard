import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT, UUID, read, write} from './store.mjs';
import {claudeAncestor, processStamp, accountFromEnvironment, readInput} from './tracking.mjs';

export function hookRecord(data, event, previous, identity, now = Date.now()) {
  if (!UUID.test(data.session_id || '') || data.agent_id) return null;
  const states = {SessionStart: 'idle', Stop: 'idle', StopFailure: 'idle', Notification: 'idle', UserPromptSubmit: 'working', PreToolUse: 'working', PermissionRequest: 'permission', SessionEnd: 'ended'};
  if (!states[event]) return null;
  if (event === 'Notification' && data.notification_type !== 'idle_prompt') return null;
  const backgroundTasks = Array.isArray(data.background_tasks) ? data.background_tasks.length : previous?.backgroundTasks || 0;
  const scheduledTasks = Array.isArray(data.session_crons) ? data.session_crons.length : previous?.scheduledTasks || 0;
  const state = states[event] === 'idle' && (backgroundTasks || scheduledTasks || data.stop_hook_active) ? 'unknown' : states[event];
  const same = previous?.sessionId === data.session_id && previous?.pid === identity.pid && previous?.processStamp === identity.processStamp;
  return {...identity, sessionId: data.session_id, transcriptPath: data.transcript_path,
    cwd: data.cwd, event, source: data.source, state, backgroundTasks, scheduledTasks, at: now,
    resumedAt: event === 'SessionStart' && data.source === 'resume' ? now : same ? previous.resumedAt : undefined};
}

async function main() {
  const event = process.argv[2], data = JSON.parse(await readInput());
  if (!UUID.test(data.session_id || '') || data.agent_id) return;
  const pid = claudeAncestor(), stamp = processStamp(pid);
  if (!pid || !stamp) return;
  const accountId = accountFromEnvironment();
  const file = path.join(ROOT, 'sessions', `${data.session_id}.json`);
  const previous = read(file, null);
  const tmux = process.env.TMUX && /^%\d+$/.test(process.env.TMUX_PANE || '') ? {
    socket: process.env.TMUX.replace(/,\d+,\d+$/, ''), pane: process.env.TMUX_PANE,
  } : undefined;
  const identity = {pid, processStamp: stamp, accountId, email: process.env.SWITCHBOARD_ACCOUNT_EMAIL || read(path.join(ROOT, 'auth', `${accountId}.json`), {})?.email, tmux};
  const record = hookRecord(data, event, previous, identity);
  if (!record) return;
  write(file, record);
  const supervisorId = process.env.SWITCHBOARD_SUPERVISOR_ID;
  if (UUID.test(supervisorId || '')) write(path.join(ROOT, 'supervisors', `${supervisorId}.session.json`), record);
  const receiptId = process.env.SWITCHBOARD_RECEIPT;
  if (UUID.test(receiptId || '')) write(path.join(ROOT, 'receipts', `${receiptId}.json`), record);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {});
