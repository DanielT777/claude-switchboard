import {fileURLToPath} from 'node:url';
import {clean, quote} from './store.mjs';
import {percentage, gauge, resetIn, resetLabel, duration} from './usage.mjs';
import {t} from './i18n.mjs';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const USAGE_URL = 'https://claude.ai/settings/usage';
const TEXT = new Set(['tooltip', 'badge']);
const SEVERITY = {warning: '#FF9F0A', critical: '#FF453A'}; // Anthropic grades its own rows.
// SwiftBar re-patches an actionless submenu parent on refresh and macOS 26 then disables it; refresh=true keeps it openable.
const PARENT = {refresh: true};
const SETTLING = 30000; // Claude caches its keychain login for 30 s; open sessions follow within that.

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
export function action(label, command, value, {terminal = false, depth = 0, ...params} = {}) {
  return line(label, {bash: process.execPath, param1: CLI, param2: command, param3: value ?? undefined, terminal, refresh: true, ...params}, depth);
}

export function render({accounts = [], selected, error, update, legacy = [], switchedAt = 0, now = Date.now()}) {
  const active = accounts.find(a => a.id === selected), settling = !!switchedAt && now - switchedAt < SETTLING;
  const usage = active?.usage?.windows, extra = active?.limits;
  const measured = [...Object.values(usage || {}), ...(extra?.rows || [])].filter(w => percentage(w, now) !== '—');
  const peak = Math.max(0, ...measured.map(w => w.used_percentage));

  const metrics = usage ? `5h ${percentage(usage.five_hour, now)} · ${t('7j')} ${percentage(usage.seven_day, now)}${active.usage.stale ? ' ≈' : ''}` : '';
  const title = active ? [active.name, metrics].filter(Boolean).join(' · ') : t('Connecter Claude');
  const [icon, tint] = settling ? ['arrow.triangle.2.circlepath', '#0A84FF'] : error ? ['exclamationmark.triangle.fill', '#FF9F0A']
    : ['person.crop.circle', peak >= 90 ? '#FF453A' : peak >= 75 ? '#FF9F0A' : '#D97757'];
  // Inline :symbol: keeps the icon on the text baseline; added after line() since clean() rewrites ':'.
  const lines = [`:${icon}: ` + line(title, {sfcolor: tint, tooltip: settling ? t('Les sessions ouvertes passent sur {name}', {name: active?.name}) : active?.email}), '---'];

  if (error) lines.push(action(error, 'dismiss', null, {sfimage: 'exclamationmark.triangle.fill', tooltip: t('Cliquer pour masquer')}), '---');
  if (update) lines.push(action(t('Mise à jour {version} disponible', {version: update.latest}), 'update', null, {terminal: true, sfimage: 'arrow.down.circle.fill'}), '---');

  // Active account and its quota, one click away from claude.ai's own usage page.
  if (active) {
    const plan = active.plan ? ` · ${active.plan[0].toUpperCase()}${active.plan.slice(1)}` : '';
    lines.push(line(`${active.name}${plan}`, {href: USAGE_URL, sfimage: 'person.crop.circle.fill', tooltip: t('Ouvrir l’usage sur claude.ai')}));
    if (active.email) lines.push(line(active.email, {size: 12}));
    const meter = (name, w, {color, note, approx} = {}) => {
      const shown = percentage(w, now), left = shown !== '—' ? resetIn(w, now) : null;
      lines.push(line(`${name.padEnd(10)}${gauge(w, now)}  ${(approx && shown !== '—' ? `≈${shown}` : shown).padStart(4)}`, {font: 'Menlo', size: 12,
        href: USAGE_URL, color: shown !== '—' ? color : null, badge: left && `↻ ${left}`,
        tooltip: [left && t('Réinitialisation {reset}', {reset: resetLabel(w, now)}), note].filter(Boolean).join(' · ')}));
    };
    const hot = w => w?.used_percentage >= 90 ? '#FF9F0A' : null;
    if (usage) {meter(t('Session'), usage.five_hour, {color: hot(usage.five_hour)}); meter(t('Semaine'), usage.seven_day, {color: hot(usage.seven_day)});}
    if (extra) {
      const note = t('Relevé par /usage il y a {d}', {d: duration(Math.max(1, Math.floor((now - extra.at) / 60000)))}), approx = extra.at < now - 5 * 60000;
      for (const row of extra.rows) meter(`· ${row.name}`, row, {color: SEVERITY[row.severity], note, approx});
      const c = extra.credits, money = v => Number.isFinite(v) ? `${(v / 10 ** c.decimals).toFixed(c.decimals)} ${c.currency || ''}`.trim() : null;
      if (c) meter(t('Crédits'), c, {color: hot(c), approx, note: [[money(c.used), money(c.limit)].filter(Boolean).join(' / '), note].filter(Boolean).join(' · ')});
    }
    if (!usage) lines.push(line(t('Quotas affichés après la prochaine réponse Claude'), {size: 11}));
  }

  // One click swaps the login under every open session. The active account only refreshes, so a stray click does nothing.
  lines.push('---', t('Comptes'));
  for (const a of accounts) {
    const w = a.usage?.windows, badge = !a.loggedIn ? t('à connecter') : w ? `${percentage(w.five_hour, now)} · ${percentage(w.seven_day, now)}` : null;
    if (a.id === selected) lines.push(line(a.name, {checked: true, refresh: true, badge, tooltip: a.email}));
    else if (a.loggedIn) lines.push(action(a.name, 'switch', a.id, {badge, tooltip: a.email}));
    else lines.push(action(a.name, 'login', a.id, {terminal: true, badge, tooltip: t('Connecter ce compte dans un terminal')}));
  }
  lines.push(action(t('Ajouter un compte…'), 'add', null, {terminal: true, sfimage: 'person.badge.plus'}));
  if (legacy.length) lines.push(line(t('{n} session(s) lancée(s) avant la mise à jour : elles suivront après leur redémarrage', {n: legacy.length}), {size: 11, tooltip: legacy.join(', ')}));

  lines.push('---', line(t('Plus'), {...PARENT, sfimage: 'ellipsis.circle'}));
  for (const a of accounts) lines.push(action(t('Reconnecter {name}…', {name: a.name}), 'reconnect', a.id, {depth: 1, terminal: true}));
  for (const a of accounts) lines.push(action(t('Renommer {name}…', {name: a.name}), 'rename', a.id, {depth: 1}));
  for (const a of accounts.filter(a => a.id !== 'system' && a.id !== selected)) lines.push(action(t('Retirer {name}…', {name: a.name}), 'remove', a.id, {depth: 1}));
  lines.push('-----', action(t('Diagnostic…'), 'doctor', null, {depth: 1, terminal: true}), action(t('Guide d’utilisation'), 'help', null, {depth: 1}));
  return lines.filter((item, i) => item && (item !== '---' || lines[i - 1] !== '---')).join('\n');
}
