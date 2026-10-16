import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {ROOT, read, write, lock, quote, refresh} from './store.mjs';
import {profile, usable} from './accounts.mjs';
import {adapters, inventory, validateTranscript} from './adapters/index.mjs';
import {isIdle, processStamp} from './tracking.mjs';
import {t} from './i18n.mjs';

export const jobFile = path.join(ROOT, 'transfer.json');
export const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));

export function receiptMatches(receipt, row) {
  if (receipt?.state === 'ended' || receipt?.sessionId !== row.provider.id) return false;
  if (row.targetId && (receipt.accountId !== row.targetId || receipt.email !== row.targetEmail)) return false;
  return receipt.resumedAt >= row.startedAt || (receipt.event === 'SessionStart' && receipt.source === 'resume' && receipt.at >= row.startedAt);
}

export function validateRows(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (!row.connected || !row.provider?.id) throw new Error(t('Une session ne fournit pas encore son historique.'));
    if (seen.has(row.provider.id)) throw new Error(t('Une conversation est ouverte dans deux panneaux. Ferme le doublon avant de basculer.'));
    seen.add(row.provider.id);
  }
}

export async function advance(row, deps) {
  if (row.stage !== 'waiting') return;
  const current = await deps.current(row);
  if (!current || current.connected === false || current.incarnationId !== row.incarnationId || current.provider?.id !== row.provider.id) throw new Error(t('Session remplacée depuis le début de la bascule.'));
  if (!isIdle(current.state)) {row.waitReason = t(current.state === 'working' ? 'Fin de réponse' : 'Autorisation ou état à vérifier'); return;}
  const shells = await deps.activity(current);
  row.shells = shells;
  if (!shells.known) {row.waitReason = t('État des shells à vérifier'); return;}
  if (shells.count) {row.waitReason = t('{n} activité(s) shell à terminer', {n: shells.count}); return;}
  delete row.waitReason;
  await deps.authenticate();
  await deps.checkpoint(row);
  await deps.save('stopping');
  await deps.stop(row);
  await deps.waitShell(row);
  await deps.authenticate();
  await deps.save('starting');
  await deps.start(row);
  await deps.verify(row);
  await deps.save('done');
}

export async function runQueue(rows, deps) {
  while (rows.some(r => r.stage === 'waiting')) {
    const waiting = rows.filter(r => r.stage === 'waiting');
    for (let offset = 0; offset < waiting.length; offset += 3) {
      await Promise.all(waiting.slice(offset, offset + 3).map(async row => {
        if (deps.cancelled() || deps.now() > deps.deadline) {row.stage = 'cancelled'; return;}
        try {await deps.advance(row);}
        catch (error) {row.stage = 'error'; row.error = error.message;}
        deps.persist();
      }));
    }
    deps.persist();
    if (rows.some(r => r.stage === 'waiting')) await deps.delay(1000);
  }
}

export function resumeCommand(targetId, row) {
  if (!path.isAbsolute(row.worktreePath || '') || !fs.statSync(row.worktreePath).isDirectory()) throw new Error(t('Dossier de reprise introuvable.'));
  return `cd ${quote(row.worktreePath)} && ` + [process.execPath, CLI, 'resume', targetId, row.provider.id, row.receiptId].map(quote).join(' ');
}

export async function transfer(targetId, onlyHandle) {
  const release = lock();
  let job;
  try {
    const target = profile(targetId), account = await usable(target);
    const authenticate = async () => {
      const now = await usable(target);
      if (now.email !== account.email || now.method !== account.method) throw new Error(t('La connexion cible a changé.'));
    };
    const snapshot = await inventory();
    let rows = snapshot.sessions;
    if (onlyHandle) rows = rows.filter(r => r.handle === onlyHandle);
    if (onlyHandle && !rows.length) throw new Error(t('La session de test a disparu.'));
    // Duplicate histories cannot safely be migrated independently.
    validateRows(rows.filter(r => r.connected && r.provider?.id));
    job = {id: crypto.randomUUID(), targetId, targetName: target.name, targetEmail: account.email,
      pid: process.pid, running: true, probe: !!onlyHandle, startedAt: Date.now(), warnings: snapshot.errors,
      rows: rows.map(row => {
        const result = {...row, targetId, targetEmail: account.email, receiptId: crypto.randomUUID(), stage: 'waiting'};
        try {
          if (!row.connected) throw new Error(t('Session hors ligne.'));
          if (row.unsupported) throw new Error(row.unsupported);
          validateTranscript(row);
          if (!onlyHandle && row.accountId === targetId && row.accountEmail === account.email) result.stage = 'done';
        } catch (error) {result.stage = 'error'; result.error = error.message;}
        return result;
      })};
    const persist = () => {job.updatedAt = Date.now(); write(jobFile, job);};
    if (!onlyHandle) write(path.join(ROOT, 'selection.json'), {id: targetId});
    persist(); refresh();
    await runQueue(job.rows, {
      now: Date.now, delay, deadline: Date.now() + 60 * 60 * 1000, persist,
      cancelled: () => read(path.join(ROOT, 'cancel.json'), {}).id === job.id,
      advance: row => {
        const adapter = adapters[row.adapter];
        if (!adapter) throw new Error(t('Adaptateur de terminal inconnu.'));
        return advance(row, {
          current: async r => (await adapter.inventory()).find(s => s.handle === r.handle),
          authenticate, activity: adapter.shellActivity,
          checkpoint: async r => {
            resumeCommand(targetId, r);
            const transcript = validateTranscript(r);
            const directory = path.join(ROOT, 'checkpoints', job.id);
            fs.mkdirSync(directory, {recursive: true, mode: 0o700});
            const file = path.join(directory, `${r.provider.id}.jsonl`);
            fs.copyFileSync(transcript, file, fs.constants.COPYFILE_EXCL); fs.chmodSync(file, 0o600);
          },
          save: async stage => {row.stage = stage; if (stage === 'starting') row.startedAt = Date.now(); persist(); refresh();},
          stop: adapter.stopClaude,
          waitShell: async r => {
            for (let i = 0; i < 40; i++) {if (await adapter.shellReady(r)) return; await delay(250);}
            throw new Error(t('Claude ne rend pas la main au shell. Aucun arrêt forcé.'));
          },
          start: r => adapter.start(r, resumeCommand(targetId, r)),
          verify: async r => {
            for (let i = 0; i < 90; i++) {
              const receipt = read(path.join(ROOT, 'receipts', `${r.receiptId}.json`), null);
              if (receiptMatches(receipt, r) && receipt.processStamp && processStamp(receipt.pid) === receipt.processStamp) return;
              if (receipt?.state === 'ended') break;
              await delay(500);
            }
            throw new Error(t('Reprise envoyée, confirmation manquante. Ouvre la session avant de réessayer.'));
          },
        });
      },
    });
  } finally {
    if (job) {job.running = false; job.updatedAt = Date.now(); write(jobFile, job);}
    release(); refresh();
  }
}
