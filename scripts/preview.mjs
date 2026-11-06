// Demo menu for screenshots: `npm run preview`, or `-- --switching` for the 30 s while open sessions follow.
import {render} from '../src/menu.mjs';
const now = Date.now(), hour = 3600;
const work = {id: 'system', name: 'Work', email: 'alex@company.dev', loggedIn: true, plan: 'max',
  usage: {at: now - 60000, stale: false, windows: {five_hour: {used_percentage: 92, resets_at: now / 1000 + 2.3 * hour}, seven_day: {used_percentage: 41, resets_at: now / 1000 + 98 * hour}}}};
const personal = {id: '11111111-1111-4111-8111-111111111111', name: 'Personal', email: 'alex@hey.example', loggedIn: true, plan: 'pro',
  usage: {at: now - 120000, stale: false, windows: {five_hour: {used_percentage: 8, resets_at: now / 1000 + 4 * hour}, seven_day: {used_percentage: 23, resets_at: now / 1000 + 120 * hour}}}};
const switching = process.argv.includes('--switching');
console.log(render({accounts: [work, personal], selected: switching ? personal.id : 'system', switchedAt: switching ? now - 5000 : 0, now}));
