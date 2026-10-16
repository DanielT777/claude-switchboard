import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ROOT, read} from './store.mjs';
import {accountFromEnvironment, readInput} from './tracking.mjs';
import {saveUsage} from './usage.mjs';

export function capture(input, env = process.env) {
  const data = JSON.parse(input), id = accountFromEnvironment(env);
  if (!id) return;
  const email = env.SWITCHBOARD_ACCOUNT_EMAIL || read(path.join(ROOT, 'auth', `${id}.json`), {}).email;
  if (email) saveUsage(id, data.rate_limits, email);
}

async function main() {
  const input = await readInput();
  try {capture(input);} catch {}
  const original = read(path.join(ROOT, 'statusline-original.json'), null);
  if (original?.type === 'command' && original.command && !original.command.includes('switchboard-statusline')) {
    // This is the user's existing status command, with the identical stdin and environment.
    const output = execFileSync('/bin/sh', ['-c', original.command], {input, timeout: 3000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore']});
    process.stdout.write(output);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {});
