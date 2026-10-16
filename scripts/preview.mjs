// Demo menu for screenshots: `npm run preview`, `-- --switching`, or `-- --step 0..5` to walk through a whole switch.
import crypto from 'node:crypto';
import {render} from '../src/menu.mjs';
import {t} from '../src/i18n.mjs';
const now = Date.now(), hour = 3600;
const work = {id: 'system', name: 'Work', email: 'alex@company.dev', loggedIn: true, method: 'claude.ai', plan: 'max',
  usage: {at: now - 60000, stale: false, windows: {five_hour: {used_percentage: 72, resets_at: now / 1000 + 2.3 * hour}, seven_day: {used_percentage: 41, resets_at: now / 1000 + 98 * hour}}}};
const personal = {id: '11111111-1111-4111-8111-111111111111', name: 'Personal', email: 'alex@hey.example', loggedIn: true, method: 'claude.ai', plan: 'pro',
  usage: {at: now - 120000, stale: false, windows: {five_hour: {used_percentage: 8, resets_at: now / 1000 + 4 * hour}, seven_day: {used_percentage: 23, resets_at: now / 1000 + 120 * hour}}}};
const session = (name, adapter, state, extra = {}) => ({name, adapter, state, handle: name, accountId: 'system', accountEmail: work.email,
  connected: true, provider: {id: crypto.randomUUID(), key: 'session_id'}, ...extra});
const sessions = [
  session('api-gateway', 'orca', 'working'),
  session('landing-page', 'tmux', 'idle'),
  session('mobile-app', 'orca', 'permission'),
  session('infra', 'herdr', 'idle', {shells: {known: true, count: 1}}),
  session('docs', 'direct', 'idle', {terminal: 'Ghostty'}),
  session('scratch', 'unmanaged', 'idle', {host: 'WezTerm', unsupported: t('{host} détecté ; contrôle de cette session non disponible. Voir la matrice de compatibilité.', {host: 'WezTerm'})}),
];
const arg = process.argv.indexOf('--step'), step = arg > 0 ? Number(process.argv[arg + 1]) : process.argv.includes('--switching') ? 2 : 0;
const order = [1, 4, 3, 0, 2], wait = [t('Fin de réponse'), t('Autorisation attendue')];
const stages = [null, ['stopping', 'waiting', 'waiting', 'waiting', 'waiting'], ['done', 'starting', 'stopping', 'waiting', 'waiting'],
  ['done', 'done', 'starting', 'stopping', 'waiting'], ['done', 'done', 'done', 'done', 'starting']][step];
const job = stages && {running: true, targetName: personal.name, rows: order.map((index, i) => ({...sessions[index], stage: stages[i],
  waitReason: stages[i] === 'waiting' ? wait[index === 2 ? 1 : 0] : undefined}))};
const moved = step === 5 ? sessions.map(s => s.unsupported ? s : {...s, state: 'idle', shells: undefined, accountId: personal.id, accountEmail: personal.email}) : sessions;
console.log(render({accounts: [work, personal], selected: step ? personal.id : 'system', now, sessions: moved, job}));
