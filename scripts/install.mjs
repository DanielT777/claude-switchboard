import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROOT, CLAUDE_HOME, read, write, setup, binary, quote, run} from '../src/store.mjs';
import {t} from '../src/i18n.mjs';

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '# >>> Claude Switchboard >>>';
const END = '# <<< Claude Switchboard <<<';

// Older versions wrapped claude in a shell function. Plain claude now runs on the live login.
export const withoutShellFunction = text => text.replace(new RegExp(`\\n*${MARKER}[\\s\\S]*?${END}\\n?`, 'g'), '\n').replace(/^\n+/, '');
// Older versions also installed session hooks; only the status line (quota capture) remains.
const withoutHooks = hooks => {
  const result = {};
  for (const [event, groups] of Object.entries(hooks || {})) {
    const kept = groups.map(group => ({...group, hooks: group.hooks.filter(h => !h.command?.includes('# switchboard-hook'))})).filter(group => group.hooks.length);
    if (kept.length) result[event] = kept;
  }
  return Object.keys(result).length ? result : undefined;
};

// Quotas now come from the usage poll: older versions' status line wrapper and session hooks go, the original status line comes back.
export function uninstallSettings(settings, originalStatus) {
  const result = {...settings, hooks: withoutHooks(settings.hooks)};
  if (!result.hooks) delete result.hooks;
  if (result.statusLine?.command?.includes('# switchboard-statusline')) {
    if (originalStatus) result.statusLine = originalStatus; else delete result.statusLine;
  }
  return result;
}

export function install({source = SOURCE, root = ROOT, claudeHome = CLAUDE_HOME,
  destination = path.join(os.homedir(), '.local/share/claude-switchboard'),
  bin = path.join(os.homedir(), '.local/bin'), plugins, shells = [], binaries = {}}) {
  setup(root);
  const release = path.join(destination, `app-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  const backup = path.join(root, 'backups', path.basename(release));
  fs.mkdirSync(release, {recursive: true, mode: 0o700});
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  fs.cpSync(path.join(source, 'src'), path.join(release, 'src'), {recursive: true, filter: file => path.basename(file) !== '__pycache__'});
  for (const file of ['README.md', 'package.json']) fs.copyFileSync(path.join(source, file), path.join(release, file));
  if (fs.existsSync(path.join(source, 'docs'))) fs.cpSync(path.join(source, 'docs'), path.join(release, 'docs'), {recursive: true});
  const node = ['/opt/homebrew/bin/node', '/usr/local/bin/node', process.execPath].find(file => {
    try {return fs.realpathSync(file) === fs.realpathSync(process.execPath);} catch {return false;}
  });
  const cli = path.join(release, 'src/cli.mjs'), command = [node, cli].map(quote).join(' ');
  const mutations = [];
  const save = (file, text, mode = 0o600) => {
    if (fs.existsSync(file)) file = fs.realpathSync(file);
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    const existed = fs.existsSync(file), previous = existed ? fs.readFileSync(file) : null;
    const oldMode = existed ? fs.statSync(file).mode & 0o777 : undefined;
    if (existed) fs.writeFileSync(path.join(backup, `${mutations.length}-${path.basename(file)}`), previous, {mode: 0o600});
    mutations.push({file, previous, oldMode});
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, text, {mode}); fs.renameSync(tmp, file);
  };
  try {
    const settingsFile = path.join(claudeHome, 'settings.json');
    const original = read(path.join(root, 'statusline-original.json'), null);
    save(settingsFile, JSON.stringify(uninstallSettings(read(settingsFile, {}), original), null, 2) + '\n');
    const wrapper = `#!/bin/sh\nexec ${command} "$@"\n`;
    save(path.join(bin, 'claude-switchboard'), wrapper, 0o755);
    const plugin = path.join(plugins, 'claude-switchboard.15s.sh');
    save(plugin, `#!/bin/sh\n# <xbar.title>Claude Switchboard</xbar.title>\n# <xbar.version>${JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version}</xbar.version>\n# <xbar.desc>${t('Comptes et quotas Claude, bascule à chaud.')}</xbar.desc>\n# <swiftbar.refreshOnOpen>true</swiftbar.refreshOnOpen>\n# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>\n# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>\n# <swiftbar.hideAbout>true</swiftbar.hideAbout>\n# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>\n# <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>\nexec ${command} "$@"\n`, 0o755);
    for (const file of shells) if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(MARKER)) save(file, withoutShellFunction(fs.readFileSync(file, 'utf8')));
    const existing = read(path.join(root, 'config.json'), {});
    save(path.join(root, 'config.json'), JSON.stringify({...existing, binaries: {...existing.binaries, ...binaries}}, null, 2) + '\n');
    save(path.join(root, 'install.json'), JSON.stringify({release, plugin, bin, shells, backup, claudeHome, installedAt: Date.now()}, null, 2) + '\n');
    // Sessions started under an older release keep calling its status line: it now only runs the original one.
    const forward = `import {spawnSync} from 'node:child_process';\nconst original = ${JSON.stringify(original?.command || '')};\nif (original) process.exitCode = spawnSync('/bin/sh', ['-c', original], {stdio: 'inherit'}).status ?? 0;\n`;
    for (const old of fs.readdirSync(destination)) {
      const file = path.join(destination, old, 'src/statusline.mjs');
      if (old !== path.basename(release) && fs.existsSync(file)) fs.writeFileSync(file, forward);
    }
    return {release, plugin, backup};
  } catch (error) {
    for (const {file, previous, oldMode} of mutations.reverse()) {
      if (previous === null) fs.rmSync(file, {force: true});
      else {fs.writeFileSync(file, previous); fs.chmodSync(file, oldMode);}
    }
    throw error;
  }
}

export function uninstall(root = ROOT) {
  const info = read(path.join(root, 'install.json'), null);
  if (!info) throw new Error(t('Aucune installation enregistrée.'));
  const settings = fs.realpathSync(path.join(info.claudeHome, 'settings.json'));
  write(settings, uninstallSettings(read(settings, {}), read(path.join(root, 'statusline-original.json'), null)));
  for (const file of info.shells) {
    if (!fs.existsSync(file)) continue;
    fs.writeFileSync(file, withoutShellFunction(fs.readFileSync(file, 'utf8')));
  }
  for (const file of [info.plugin, path.join(info.bin, 'claude-switchboard')]) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(quote(path.join(info.release, 'src/cli.mjs')))) fs.unlinkSync(file);
  }
  // Saved logins stay in the keychain (Claude Switchboard items) so a reinstall finds them.
  console.log(t('Intégration retirée. Comptes et sauvegardes conservés.'));
}

function main() {
  if (process.argv.includes('--uninstall')) return uninstall();
  if (process.platform !== 'darwin') throw new Error(t('SwiftBar nécessite macOS. Les tests peuvent tourner sous Linux.'));
  for (const name of ['claude']) if (!binary(name)) throw new Error(t('{name} est requis. Installe-le puis relance Install.command.', {name}));
  let plugins;
  try {plugins = run('/usr/bin/defaults', ['read', 'com.ameba.SwiftBar', 'PluginDirectory']).trim();} catch {}
  if (!plugins) plugins = path.join(os.homedir(), '.config/swiftbar-plugins');
  if (![path.join(os.homedir(), 'Applications/SwiftBar.app'), '/Applications/SwiftBar.app'].some(file => fs.existsSync(file))) {
    if (!binary('brew')) throw new Error(t('Installe SwiftBar depuis https://swiftbar.app puis relance Install.command.'));
    run('brew', ['install', '--cask', 'swiftbar'], {stdio: 'inherit', timeout: 600000});
  }
  const binaries = Object.fromEntries(['claude'].map(name => [name, binary(name)]).filter(([, file]) => file));
  const installed = install({plugins, binaries, shells: ['.zshrc', '.bashrc', '.bash_profile'].map(file => path.join(os.homedir(), file))});
  run('/usr/bin/defaults', ['write', 'com.ameba.SwiftBar', 'PluginDirectory', '-string', plugins]);
  let running = false;
  try {running = !!run('/usr/bin/pgrep', ['-u', String(process.getuid()), '-x', 'SwiftBar']).trim();} catch {}
  if (!running) run('/usr/bin/open', ['-g', '-a', 'SwiftBar']);
  run('/usr/bin/open', ['-g', 'swiftbar://refreshplugin?name=claude-switchboard.15s.sh']);
  console.log(t('Installé. Utilise claude comme d’habitude et change de compte depuis la barre de menus.\nSauvegardes privées : {backup}', {backup: installed.backup}));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {main();} catch (error) {console.error(error.message); process.exitCode = 1;}
}
