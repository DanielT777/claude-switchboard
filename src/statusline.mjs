import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ROOT, CLAUDE_HOME, read} from './store.mjs';
import {profile, profiles} from './accounts.mjs';
import {saveUsage, normalizeUsage} from './usage.mjs';

const sameWindows = (a, b) => !!a && !!b && ['five_hour', 'seven_day'].every(k => a[k]?.resets_at === b[k]?.resets_at);

// Quotas belong to the live account. A session from before hot switching runs in a profile folder on its own login: ignored.
export function capture(input, env = process.env) {
  const data = JSON.parse(input), dir = env.CLAUDE_CONFIG_DIR;
  if (dir && path.resolve(dir) !== path.resolve(CLAUDE_HOME)) return;
  const selection = read(path.join(ROOT, 'selection.json'), {}), id = selection.id || 'system', windows = normalizeUsage(data.rate_limits);
  // Until its next reply a session still shows the previous account's limits: right after a switch, those are skipped.
  if (!windows || (Date.now() - selection.at < 10 * 60000 && profiles().some(p => p.id !== id && sameWindows(read(path.join(ROOT, 'usage', `${p.id}.json`), null)?.windows, windows)))) return;
  const email = profile(id).identity?.email;
  if (email) saveUsage(id, data.rate_limits, email);
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {input += chunk; if (input.length > 1024 * 1024) return;}
  try {capture(input);} catch {}
  const original = read(path.join(ROOT, 'statusline-original.json'), null);
  if (original?.type === 'command' && original.command && !original.command.includes('switchboard-statusline')) {
    // This is the user's existing status command, with the identical stdin and environment.
    const output = execFileSync('/bin/sh', ['-c', original.command], {input, timeout: 3000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore']});
    process.stdout.write(output);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {});
