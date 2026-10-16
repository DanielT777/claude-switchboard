import path from 'node:path';
import {ROOT, read, write, profileId} from './store.mjs';
import {t} from './i18n.mjs';

export function normalizeUsage(data) {
  const windows = {};
  for (const key of ['five_hour', 'seven_day']) {
    const value = data?.[key];
    if (typeof value?.used_percentage !== 'number' || !Number.isFinite(value.used_percentage) || value.used_percentage < 0 || value.used_percentage > 100) continue;
    windows[key] = {used_percentage: value.used_percentage};
    if (Number.isSafeInteger(value.resets_at) && value.resets_at > 0) windows[key].resets_at = value.resets_at;
  }
  return Object.keys(windows).length ? windows : null;
}

export function saveUsage(id, data, email, root = ROOT, now = Date.now()) {
  if (!profileId(id)) return;
  const windows = normalizeUsage(data);
  if (!windows) return;
  write(path.join(root, 'usage', `${id}.json`), {windows, email, at: now});
}

export function loadUsage(account, root = ROOT, now = Date.now()) {
  const snapshot = read(path.join(root, 'usage', `${account.id}.json`), null);
  if (!snapshot || !account.email || snapshot.email !== account.email) return null;
  const windows = normalizeUsage(snapshot.windows);
  if (!windows || !Number.isFinite(snapshot.at)) return null;
  return {windows, at: snapshot.at, stale: snapshot.at < now - 5 * 60 * 1000};
}

export function percentage(window, now = Date.now()) {
  if (!window || (window.resets_at && window.resets_at * 1000 <= now)) return '—';
  return `${Math.round(window.used_percentage)}%`;
}

// Time left before a window resets ('3 h 47 min'), or null when unknown or already past.
export function resetIn(window, now = Date.now()) {
  const minutes = window?.resets_at ? Math.ceil((window.resets_at * 1000 - now) / 60000) : 0;
  if (minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  return `${Math.floor(minutes / 1440)} ${t('j')}${minutes % 1440 >= 60 ? ` ${Math.floor(minutes % 1440 / 60)} h` : ''}`;
}

export function resetLabel(window, now = Date.now()) {
  if (!window?.resets_at) return t('réinitialisation inconnue');
  const left = resetIn(window, now);
  return left ? t('dans {d}', {d: left}) : t('à actualiser après réinitialisation');
}

export function gauge(window, now = Date.now()) {
  if (percentage(window, now) === '—') return '─'.repeat(10);
  const filled = Math.round(window.used_percentage / 10);
  return '━'.repeat(filled) + '─'.repeat(10 - filled);
}
