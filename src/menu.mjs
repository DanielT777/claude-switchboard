import {clean, quote} from './store.mjs';
import {percentage, gauge, resetIn, resetLabel} from './usage.mjs';
import {CLI} from './transfer.mjs';
import {t} from './i18n.mjs';

const USAGE_URL = 'https://claude.ai/settings/usage';
const HOSTS = {orca: 'Orca', tmux: 'tmux', herdr: 'Herdr'};
const TEXT = new Set(['tooltip', 'badge']);
const STAGES = {
  waiting: ['En attente', 'hourglass', 'gray'], stopping: ['Fermeture', 'stop.circle', '#FF9F0A'],
  starting: ['Reprise', 'arrow.clockwise.circle', '#0A84FF'], done: ['Reprise confirmée', 'checkmark.circle.fill', '#30D158'],
  error: ['À vérifier', 'exclamationmark.triangle.fill', '#FF453A'], cancelled: ['Annulée', 'xmark.circle', 'gray'],
};
// SwiftBar re-patches an actionless submenu parent on refresh and macOS 26 then disables it; refresh=true keeps it openable.
const PARENT = {refresh: true};

// One SwiftBar line. Labels, tooltips and badges are untrusted text; other values are built here.
export function line(label, params = {}, depth = 0) {
  // ponytail: SwiftBar draws a menu item's sfimage as a template and ignores sfcolor there (sfconfig tints
  // come out washed out on macOS 26). Only the inline :symbol: in the menu bar title takes the color.
  const fields = Object.entries(params).filter(([, v]) => v != null && v !== '').map(([key, v]) => {
    v = TEXT.has(key) ? clean(v) : String(v);
    return `${key}=${/^[\w.#,:/-]+$/.test(v) ? v : quote(v)}`;
  });
  return `${'--'.repeat(depth)}${clean(label)}${fields.length ? ` | ${fields.join(' ')}` : ''}`;
}

// A clickable line never has children: macOS does not send a submenu parent's action.
export function action(label, command, value, {terminal = false, enabled = true, depth = 0, ...params} = {}) {
  if (!enabled) return line(label, params, depth);
  return line(label, {bash: process.execPath, param1: CLI, param2: command, param3: value ?? undefined, terminal, refresh: true, ...params}, depth);
}

// Mirrors transfer(): only these sessions are stopped and resumed by a switch.
export const restartable = s => s.connected !== false && !s.unsupported && !!s.provider?.id;

export function sessionStyle(s) {
  if (s.unsupported) return {rank: 5, label: t('Non pris en charge'), icon: 'nosign', color: 'gray'};
  if (s.connected === false) return {rank: 6, label: t('Hors ligne'), icon: 'moon.zzz', color: 'gray'};
  if (!s.provider?.id) return {rank: 7, label: t('Historique introuvable'), icon: 'questionmark.folder', color: 'gray'};
  if (s.state === 'working') return {rank: 0, label: t('Réponse en cours'), when: t('Relancée après la réponse'), icon: 'bolt.fill', color: '#0A84FF'};
  if (s.shells?.count) return {rank: 1, label: t('Shell actif · {n}', {n: s.shells.count}), when: t('Relancée quand le shell est libre'), icon: 'terminal.fill', color: '#FF9F0A'};
  if (s.state === 'permission') return {rank: 2, label: t('Autorisation attendue'), when: t('Relancée après ton autorisation'), icon: 'hand.raised.fill', color: '#FF9F0A'};
  if (s.shells?.known === false || !['idle', 'done'].includes(s.state)) return {rank: 3, label: t('À vérifier'), when: t('Relancée une fois l’état confirmé'), icon: 'questionmark.circle', color: '#FF9F0A'};
  return {rank: 4, label: t('Prête'), when: t('Relancée immédiatement'), icon: 'checkmark.circle', color: '#30D158'};
}

function sessionLine(s, accounts, depth) {
  const style = sessionStyle(s), account = accounts.find(a => a.id === s.accountId && a.email === s.accountEmail);
  const where = `${s.host || HOSTS[s.adapter] || s.terminal || 'Terminal'} · ${account ? account.name : t('compte non confirmé')}`;
  return action(s.name, 'focus', s.handle, {depth, enabled: !s.unsupported, sfimage: style.icon, sfcolor: style.color, badge: style.label,
    tooltip: s.unsupported || (style.when ? `${where} · ${style.when}` : where)});
}

function stage(row) {
  const [label, image, color] = STAGES[row.stage] || STAGES.error;
  return {label: t(label), image, color};
}

export function render({accounts = [], sessions = [], errors = [], selected = 'system', error, job, update, now = Date.now()}) {
  if (job?.probe) job = null;
  const active = accounts.find(a => a.id === selected), busy = !!job?.running;
  const ready = a => a.loggedIn && a.method === 'claude.ai';
  const done = job?.rows.filter(r => r.stage === 'done').length || 0;
  const incomplete = !!job && !busy && (job.rows.some(r => r.stage !== 'done') || !!job.warnings?.length);
  const usage = active?.usage?.windows, measured = usage ? Object.values(usage).filter(w => percentage(w, now) !== '—') : [];
  const peak = Math.max(0, ...measured.map(w => w.used_percentage));

  // Menu bar: the account name only matters once there is another one to switch to.
  const metrics = usage ? `5h ${percentage(usage.five_hour, now)} · ${t('7j')} ${percentage(usage.seven_day, now)}${active.usage.stale ? ' ≈' : ''}` : '';
  const title = busy ? `${job.targetName} ↻ ${done}/${job.rows.length}`
    : !active?.loggedIn ? t('Connecter Claude')
    : [accounts.filter(ready).length > 1 || !metrics ? active.name : null, metrics].filter(Boolean).join(' · ');
  const [icon, tint] = busy ? ['arrow.triangle.2.circlepath', '#0A84FF']
    : incomplete || error ? ['exclamationmark.triangle.fill', '#FF9F0A']
    : ['person.crop.circle', peak >= 90 ? '#FF453A' : peak >= 75 ? '#FF9F0A' : '#D97757'];
  // Inline :symbol: keeps the icon on the text baseline; a status-button sfimage sits lower. Added after line() since clean() rewrites ':'.
  const lines = [`:${icon}: ` + line(title, {sfcolor: tint, tooltip: active?.email || 'Claude Switchboard'}), '---'];

  if (error) lines.push(action(error, 'dismiss', null, {sfimage: 'exclamationmark.triangle.fill', sfcolor: '#FF453A', tooltip: t('Cliquer pour masquer')}), '---');
  if (update) lines.push(action(t('Mise à jour {version} disponible', {version: update.latest}), 'update', null, {terminal: true, sfimage: 'arrow.down.circle.fill', sfcolor: '#0A84FF'}), '---');

  // Active account and its quota, one click away from claude.ai's own usage page.
  if (active?.loggedIn) {
    const plan = active.plan ? ` · ${active.plan[0].toUpperCase()}${active.plan.slice(1)}` : '';
    lines.push(line(`${active.name}${plan}`, {href: USAGE_URL, sfimage: 'person.crop.circle.fill', sfcolor: '#D97757', tooltip: t('Ouvrir l’usage sur claude.ai')}));
    if (active.email) lines.push(line(active.email, {size: 12}));
    if (usage) {
      for (const [key, name] of [['five_hour', '5 h'], ['seven_day', '7 jours']]) {
        const w = usage[key], left = percentage(w, now) !== '—' ? resetIn(w, now) : null;
        lines.push(line(`${t(name).padEnd(8)}${gauge(w, now)}  ${percentage(w, now).padStart(4)}`, {font: 'Menlo', size: 12, href: USAGE_URL,
          color: left && w.used_percentage >= 90 ? '#FF9F0A' : null, badge: left && `↻ ${left}`, tooltip: left && t('Réinitialisation {reset}', {reset: resetLabel(w, now)})}));
      }
      const age = Math.max(0, Math.floor((now - active.usage.at) / 60000));
      lines.push(line(`${age ? t('Mesuré il y a {n} min', {n: age}) : t('Mesuré à l’instant')}${active.usage.stale ? ` · ${t('donnée ancienne')}` : ''}`, {size: 11}));
    } else lines.push(line(t('Quotas affichés après la prochaine réponse Claude'), {size: 11}));
  }

  // Accounts: one click switches. The selected one only refreshes, so a stray click never restarts anything.
  lines.push('---', t('Comptes'));
  for (const a of accounts) {
    const ok = ready(a), w = a.usage?.windows;
    const badge = a.error ? t('à vérifier') : !ok ? t('à connecter') : w ? `${percentage(w.five_hour, now)} · ${percentage(w.seven_day, now)}` : null;
    if (a.id === selected && ok) {lines.push(line(a.name, {checked: true, refresh: true, badge, tooltip: a.email})); continue;}
    const moving = sessions.filter(s => restartable(s) && !(s.accountId === a.id && s.accountEmail === a.email)).length;
    lines.push(action(a.name, ok ? 'switch' : 'login', a.id, {terminal: !ok, enabled: !busy && !a.error, badge,
      tooltip: ok ? t('{email} · basculer relance {n} session(s)', {email: a.email || '', n: moving}) : t('Connecter ce compte dans un terminal')}));
  }
  lines.push(action(t('Ajouter un compte…'), 'add', null, {terminal: true, enabled: !busy, sfimage: 'person.badge.plus'}));

  // Sessions: what a switch will stop and resume, and what it leaves alone.
  if (busy) {
    lines.push('---', line(t('Bascule vers {name} · {done}/{total} reprises', {name: job.targetName, done, total: job.rows.length}), {sfimage: 'arrow.triangle.2.circlepath', sfcolor: '#0A84FF'}));
    for (const row of job.rows) {
      const {label, image, color} = stage(row);
      lines.push(action(row.name, 'focus', row.handle, {sfimage: image, sfcolor: color, badge: row.stage === 'waiting' && row.waitReason || label, tooltip: row.error}));
    }
    for (const warning of job.warnings || []) lines.push(line(warning, {sfimage: 'exclamationmark.triangle', sfcolor: '#FF9F0A'}));
    lines.push(action(t('Annuler les reprises en attente'), 'cancel', null, {sfimage: 'xmark.circle'}));
  } else {
    if (incomplete) {
      lines.push('---', line(t('Bascule partielle · {done}/{total}', {done, total: job.rows.length}), {...PARENT, sfimage: 'exclamationmark.triangle.fill', sfcolor: '#FF9F0A'}));
      for (const row of job.rows.filter(r => r.stage !== 'done')) {
        const {label, image, color} = stage(row);
        lines.push(action(row.name, 'focus', row.handle, {depth: 1, sfimage: image, sfcolor: color, badge: label, tooltip: row.error}));
      }
      for (const warning of job.warnings || []) lines.push(line(warning, {sfimage: 'exclamationmark.triangle', sfcolor: '#FF9F0A'}, 1));
      lines.push(action(t('Réessayer les sessions restantes'), 'switch', selected, {sfimage: 'arrow.clockwise'}));
    }
    const order = (a, b) => sessionStyle(a).rank - sessionStyle(b).rank;
    const moving = sessions.filter(restartable).sort(order), kept = sessions.filter(s => !restartable(s)).sort(order);
    lines.push('---', t(accounts.filter(ready).length > 1 ? 'Relancées à la bascule · {n}' : 'Sessions · {n}', {n: moving.length}));
    const shown = moving.length > 10 ? 8 : moving.length;
    for (const s of moving.slice(0, shown)) lines.push(sessionLine(s, accounts, 0));
    if (moving.length > shown) {
      lines.push(line(t('{n} autres sessions', {n: moving.length - shown}), PARENT));
      for (const s of moving.slice(shown)) lines.push(sessionLine(s, accounts, 1));
    }
    if (kept.length) {
      lines.push(line(t('Non touchées · {n}', {n: kept.length}), {...PARENT, sfimage: 'pause.circle'}));
      for (const s of kept) lines.push(sessionLine(s, accounts, 1));
    }
    if (errors.length) {
      lines.push(line(t('Inventaire incomplet'), {...PARENT, sfimage: 'exclamationmark.triangle', sfcolor: '#FF9F0A'}));
      for (const message of errors) lines.push(line(message, {}, 1));
    }
  }

  lines.push('---', line(t('Plus'), {...PARENT, sfimage: 'ellipsis.circle'}));
  for (const a of accounts) lines.push(action(t('Renommer {name}…', {name: a.name}), 'rename', a.id, {depth: 1, enabled: !busy, tooltip: t('Nom affiché dans la barre de menus')}));
  for (const a of accounts.filter(a => a.id !== 'system')) {
    lines.push(action(ready(a) ? t('Retirer {name}…', {name: a.name}) : t('Supprimer le profil en attente {name}', {name: a.name}), 'remove', a.id,
      {depth: 1, enabled: !busy && a.id !== selected, tooltip: t('Archive le profil localement ; les conversations restent')}));
  }
  lines.push('-----', action(t('Diagnostic…'), 'doctor', null, {depth: 1, terminal: true, tooltip: t('Ouvre un terminal et vérifie Claude, Python et les terminaux détectés')}),
    action(t('Guide d’utilisation'), 'help', null, {depth: 1, tooltip: t('Ouvre le README')}));
  return lines.filter((item, i) => item !== '---' || lines[i - 1] !== '---').join('\n');
}
