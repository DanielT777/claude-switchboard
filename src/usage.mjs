import os from 'node:os';
import path from 'node:path';
import {ROOT, CLAUDE_HOME, read, write, profileId} from './store.mjs';
import {t} from './i18n.mjs';

const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

export function normalizeUsage(data) {
  const windows = {};
  for (const key of ['five_hour', 'seven_day']) {
    const value = data?.[key];
    if (!valid(value?.used_percentage)) continue;
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

// Claude Code's own config file for an account: it caches Anthropic's usage reply there after /usage.
export function claudeConfig(dir) {
  if (dir) return path.join(dir, '.claude.json');
  return CLAUDE_HOME === path.join(os.homedir(), '.claude') ? path.join(os.homedir(), '.claude.json') : path.join(CLAUDE_HOME, '.claude.json');
}

// Anthropic's usage rows beyond the session and all-models week (a model or surface week today) and usage credits,
// read from Claude's cache: no request, no token. Rows render in the server's order, so a new meter needs no release.
// ponytail: Claude refreshes this cache only when it fetches usage itself (/usage, a limit wall); its age is shown.
export function cachedLimits(account, file = claudeConfig(account.dir)) {
  let config;
  try {config = read(file, null);} catch {return null;} // Claude may be rewriting it.
  const cache = config?.cachedUsageUtilization, owner = config?.oauthAccount;
  if (!account.email || owner?.emailAddress !== account.email || !owner.accountUuid || cache?.accountUuid !== owner.accountUuid || !Number.isFinite(cache.fetchedAtMs)) return null;
  const rows = (Array.isArray(cache.utilization?.limits) ? cache.utilization.limits : []).flatMap(row => {
    const name = row?.scope?.model?.display_name || row?.scope?.surface?.display_name, resets = Math.floor(Date.parse(row?.resets_at) / 1000);
    if (['session', 'weekly_all'].includes(row?.kind) || typeof name !== 'string' || !valid(row.percent)) return [];
    return [{name: name.slice(0, 30), severity: row.severity, used_percentage: row.percent, ...(resets > 0 && {resets_at: resets})}];
  });
  const extra = cache.utilization?.extra_usage;
  const credits = extra?.is_enabled === true && valid(extra.utilization) ? {used_percentage: extra.utilization, used: extra.used_credits,
    limit: extra.monthly_limit, currency: extra.currency, decimals: extra.decimal_places ?? 2} : null;
  return rows.length || credits ? {rows, credits, at: cache.fetchedAtMs} : null;
}

// '3 h 47 min', '2 j 4 h'.
export function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  return `${Math.floor(minutes / 1440)} ${t('j')}${minutes % 1440 >= 60 ? ` ${Math.floor(minutes % 1440 / 60)} h` : ''}`;
}

export function percentage(window, now = Date.now()) {
  if (!window || (window.resets_at && window.resets_at * 1000 <= now)) return '—';
  return `${Math.round(window.used_percentage)}%`;
}

// Time left before a window resets ('3 h 47 min'), or null when unknown or already past.
export function resetIn(window, now = Date.now()) {
  const minutes = window?.resets_at ? Math.ceil((window.resets_at * 1000 - now) / 60000) : 0;
  return minutes > 0 ? duration(minutes) : null;
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
