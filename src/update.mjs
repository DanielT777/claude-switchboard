import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ROOT, read, write} from './store.mjs';
import {t} from './i18n.mjs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = pkg.version;
export const REPO = String(pkg.repository || '').replace(/^github:/, '');
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const TTL = 6 * 60 * 60 * 1000;
// Releases are signed in CI with the maintainer's ed25519 key; only archives verified against this key install.
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7thyijEH/LbEK2F9HO1FDD8Q2+uZScoF2IcCFjjnULk=
-----END PUBLIC KEY-----
`;

const parts = v => String(v || '').replace(/^v/, '').split('.').map(n => Number.parseInt(n, 10) || 0);
export function newer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function latest(fetchImpl) {
  const response = await fetchImpl(API, {signal: AbortSignal.timeout(4000), headers: {'User-Agent': `claude-switchboard/${VERSION}`, Accept: 'application/vnd.github+json'}});
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  const release = await response.json();
  if (release.draft || release.prerelease || typeof release.tag_name !== 'string') throw new Error(t('Aucune version publiée.'));
  const name = `claude-switchboard-${release.tag_name}.tar.gz`;
  const find = file => release.assets?.find(a => a.name === file)?.browser_download_url;
  return {latest: release.tag_name, url: release.html_url, asset: find(name), sha256Asset: find(`${name}.sha256`), sigAsset: find(`${name}.sig`)};
}

// Menu path: never throws, and caches failures too so an offline Mac does not query GitHub every 15 s.
export async function check({now = Date.now(), fetchImpl = fetch, root = ROOT} = {}) {
  const file = path.join(root, 'update.json');
  let cache = null;
  try {cache = read(file, null);} catch {}
  if (!(cache?.checkedAt > now - TTL)) {
    try {cache = {checkedAt: now, ...await latest(fetchImpl)};} catch {cache = {checkedAt: now};}
    try {write(file, cache);} catch {}
  }
  return cache.latest && newer(cache.latest, VERSION) ? {latest: cache.latest, url: cache.url} : null;
}

// Archive entries must stay inside the release folder: no absolute path, no `..` segment.
export const safeEntries = list => list.split('\n').filter(Boolean).every(entry =>
  !path.isAbsolute(entry) && !entry.split('/').includes('..') && (entry === 'claude-switchboard/' || entry.startsWith('claude-switchboard/')));

export function signed(archive, signature, publicKey = RELEASE_PUBLIC_KEY) {
  const raw = Buffer.from(String(signature).trim(), 'base64');
  try {return raw.length === 64 && crypto.verify(null, archive, publicKey, raw);} catch {return false;}
}

export async function install({fetchImpl = fetch, root = ROOT, run = spawnSync, publicKey = RELEASE_PUBLIC_KEY} = {}) {
  const release = await latest(fetchImpl);
  if (!newer(release.latest, VERSION)) return console.log(t('Déjà à jour ({version}).', {version: VERSION}));
  if (!release.asset || !release.sha256Asset) throw new Error(t('Archive de mise à jour absente de la version GitHub.'));
  if (!release.sigAsset) throw new Error(t('Signature de mise à jour absente ou invalide. Mise à jour refusée.'));
  const download = async url => {
    const response = await fetchImpl(url, {signal: AbortSignal.timeout(60000), headers: {'User-Agent': `claude-switchboard/${VERSION}`}});
    if (!response.ok) throw new Error(t('Téléchargement impossible ({status}).', {status: response.status}));
    return Buffer.from(await response.arrayBuffer());
  };
  console.log(t('Téléchargement de {version}…', {version: release.latest}));
  const archive = await download(release.asset);
  // Nothing touches the disk before the maintainer's signature checks out.
  if (!signed(archive, (await download(release.sigAsset)).toString('utf8'), publicKey)) throw new Error(t('Signature de mise à jour absente ou invalide. Mise à jour refusée.'));
  const expected = (await download(release.sha256Asset)).toString('utf8').trim().split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  if (!/^[0-9a-f]{64}$/i.test(expected) || expected.toLowerCase() !== actual) throw new Error(t('Somme de contrôle invalide. Mise à jour refusée.'));
  fs.mkdirSync(path.join(root, 'updates'), {recursive: true, mode: 0o700});
  const directory = fs.mkdtempSync(path.join(root, 'updates', `${release.latest}-`));
  fs.chmodSync(directory, 0o700);
  const tarball = path.join(directory, 'release.tar.gz');
  fs.writeFileSync(tarball, archive, {mode: 0o600});
  const listing = run('/usr/bin/tar', ['-tzf', tarball], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
  if (listing.status !== 0) throw new Error(t('Archive de mise à jour illisible.'));
  if (!safeEntries(String(listing.stdout || ''))) throw new Error(t('Archive de mise à jour non sûre. Mise à jour refusée.'));
  const tar = run('/usr/bin/tar', ['-xzf', tarball, '-C', directory], {stdio: 'inherit'});
  if (tar.status !== 0) throw new Error(t('Archive de mise à jour illisible.'));
  const installer = path.join(directory, 'claude-switchboard/scripts/install.mjs');
  if (!fs.existsSync(installer)) throw new Error(t('Installateur absent de l’archive.'));
  const result = run(process.execPath, [installer], {stdio: 'inherit', cwd: path.dirname(path.dirname(installer))});
  if (result.status !== 0) throw new Error(t('Installation de la mise à jour échouée. Version actuelle conservée.'));
  fs.rmSync(path.join(root, 'update.json'), {force: true});
}
