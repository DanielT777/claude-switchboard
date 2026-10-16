import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {install, uninstall, shellConfig, claudeSettings, uninstallSettings} from '../scripts/install.mjs';
import {read, write} from '../src/store.mjs';

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "switchboard install 'space-"));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  return {source: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), root: path.join(temp, 'state'),
    destination: path.join(temp, 'app'), claudeHome: path.join(temp, 'claude'), bin: path.join(temp, 'bin'), plugins: path.join(temp, 'plugins'), shells: [path.join(temp, '.zshrc')]};
}
test('shell integration is idempotent and preserves existing configuration', () => {
  const result = shellConfig('export KEEP=yes\n', "'/some path/node' '/cli'" );
  assert.equal(shellConfig(result, "'/some path/node' '/cli'"), result);
  assert.ok(result.startsWith('export KEEP=yes'));
  assert.match(result, /direct "\$@"/);
});
test('existing statusline and hooks survive install, upgrade and uninstall', t => {
  const options = fixture(t), original = {statusLine: {type: 'command', command: 'cat', padding: 2}, hooks: {Stop: [{hooks: [{type: 'command', command: 'original'}]}]}, permissions: {deny: ['Bash(rm *)']}};
  write(path.join(options.claudeHome, 'settings.json'), original);
  fs.writeFileSync(options.shells[0], 'export KEEP=yes\n');
  const first = install(options);
  assert.ok(fs.existsSync(first.plugin));
  assert.equal(fs.statSync(first.plugin).mode & 0o777, 0o755);
  const installed = read(path.join(options.claudeHome, 'settings.json'));
  assert.deepEqual(installed.permissions, original.permissions);
  assert.equal(installed.hooks.Stop.length, 2);
  assert.equal(installed.statusLine.padding, 2);
  install(options);
  assert.equal(read(path.join(options.claudeHome, 'settings.json')).hooks.Stop.length, 2);
  assert.equal(read(path.join(options.root, 'statusline-original.json')).command, 'cat');
  uninstall(options.root);
  assert.deepEqual(read(path.join(options.claudeHome, 'settings.json')), original);
  assert.ok(!fs.existsSync(first.plugin));
  assert.match(fs.readFileSync(options.shells[0], 'utf8'), /export KEEP=yes/);
  assert.ok(!fs.readFileSync(options.shells[0], 'utf8').includes('claude()'));
});
test('uninstall leaves a subsequently replaced statusline untouched', () => {
  const settings = {statusLine: {type: 'command', command: 'new-user-command'}};
  assert.deepEqual(uninstallSettings(settings, {command: 'old'}), settings);
});
test('installation rolls back prior files on a later write failure', t => {
  const options = fixture(t), original = {permissions: {deny: ['Read(secret)']}};
  write(path.join(options.claudeHome, 'settings.json'), original);
  fs.writeFileSync(options.bin, 'not a directory');
  assert.throws(() => install(options));
  assert.deepEqual(read(path.join(options.claudeHome, 'settings.json')), original);
  assert.equal(fs.existsSync(path.join(options.root, 'statusline-original.json')), false);
});
test('installation and uninstall preserve symlinked dotfiles and their targets', t => {
  const options = fixture(t), target = path.join(options.root, 'dotfiles/settings.json');
  write(target, {permissions: {deny: ['Read(secret)']}});
  fs.mkdirSync(options.claudeHome);
  fs.symlinkSync(target, path.join(options.claudeHome, 'settings.json'));
  const shellTarget = path.join(options.root, 'dotfiles/zshrc');
  fs.writeFileSync(shellTarget, 'export KEEP=yes\n'); fs.symlinkSync(shellTarget, options.shells[0]);
  install(options); uninstall(options.root);
  assert.ok(fs.lstatSync(path.join(options.claudeHome, 'settings.json')).isSymbolicLink());
  assert.ok(fs.lstatSync(options.shells[0]).isSymbolicLink());
  assert.deepEqual(read(target), {permissions: {deny: ['Read(secret)']}});
  assert.match(fs.readFileSync(shellTarget, 'utf8'), /export KEEP=yes/);
});
