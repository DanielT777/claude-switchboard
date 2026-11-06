import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// French is the source language: call sites keep the French text, EN maps it. A missing entry falls back to French.
const EN = {
  'Reconnecter {name}…': 'Reconnect {name}…',
  'Autorisation attendue': 'Needs permission',
  '7j': '7d',
  'Connecter Claude': 'Connect Claude',
  'Cliquer pour masquer': 'Click to dismiss',
  'Mise à jour {version} disponible': 'Update to {version}…',
  'Ouvrir l’usage sur claude.ai': 'Open usage on claude.ai',
  'Session': 'Session',
  'Semaine': 'Week',
  'Crédits': 'Credits',
  'Relevé par /usage il y a {d}': 'From /usage {d} ago',
  'Réinitialisation {reset}': 'Resets {reset}',
  'Quotas affichés après la prochaine réponse Claude': 'Usage appears after Claude’s next reply',
  'Comptes': 'Accounts',
  'à connecter': 'not connected',
  'Connecter ce compte dans un terminal': 'Connect this account in a terminal',
  'Ajouter un compte…': 'Add Account…',
  'Renommer {name}…': 'Rename {name}…',
  'Retirer {name}…': 'Remove {name}…',
  'Plus': 'More',
  'Diagnostic…': 'Run Diagnostics…',
  'Guide d’utilisation': 'User Guide',
  'réinitialisation inconnue': 'reset time unknown',
  'à actualiser après réinitialisation': 'refreshes after reset',
  'dans {d}': 'in {d}',
  'j': 'd',
  'Principal': 'Main',
  'Identifiant de connexion invalide.': 'Invalid account ID.',
  'Ce compte n’existe plus. Le menu a été actualisé.': 'This account no longer exists. The menu has been refreshed.',
  'Utilise un nom de 1 à 50 caractères sans caractères de contrôle.': 'Use a name of 1 to 50 characters without control characters.',
  'Le compte principal est géré par Claude Code.': 'The main account is managed by Claude Code.',
  'Sélectionne un autre compte avant de retirer celui-ci.': 'Select another account before removing this one.',
  'Ce compte est encore utilisé par une session.': 'This account is still used by a session.',
  'Impossible de lancer le programme. Vérifie l’installation.': 'Couldn’t start the program. Check the installation.',
  'Annuler': 'Cancel',
  'Continuer': 'Continue',
  'Retirer': 'Remove',
  'Claude Switchboard · diagnostic local': 'Claude Switchboard · local diagnostics',
  'disponible': 'available',
  'absent': 'missing',
  'Nom court du compte': 'Short account name',
  'Ajouter un compte Claude': 'Add a Claude Account',
  'Personnel': 'Personal',
  'Nom affiché dans la barre': 'Name shown in the menu bar',
  'Renommer le compte': 'Rename Account',
  'Retirer {name} du menu ? Le profil sera archivé localement.': 'Remove {name} from the menu? The profile will be archived locally.',
  'Service indisponible. Lance le diagnostic depuis le menu.': 'Service unavailable. Run diagnostics from the menu.',
  'Claude · à vérifier': 'Claude · needs attention',
  'Installation à vérifier. Lance Install.command.': 'Check the installation. Run Install.command.',
  'Fichier local illisible. Restaure sa sauvegarde avant de continuer.': 'Unreadable local file. Restore its backup before continuing.',
  '{name} introuvable. Lance Install.command pour vérifier les dépendances.': '{name} not found. Run Install.command to check dependencies.',
  'Fin de réponse': 'Finishing reply',
  'Aucune version publiée.': 'No published release.',
  'Déjà à jour ({version}).': 'Already up to date ({version}).',
  'Archive de mise à jour absente de la version GitHub.': 'Update archive missing from the GitHub release.',
  'Téléchargement impossible ({status}).': 'Download failed ({status}).',
  'Téléchargement de {version}…': 'Downloading {version}…',
  'Somme de contrôle invalide. Mise à jour refusée.': 'Invalid checksum. Update refused.',
  'Archive de mise à jour illisible.': 'Unreadable update archive.',
  'Installateur absent de l’archive.': 'Installer missing from the archive.',
  'Signature de mise à jour absente ou invalide. Mise à jour refusée.': 'Update signature missing or invalid. Update refused.',
  'Archive de mise à jour non sûre. Mise à jour refusée.': 'Unsafe update archive. Update refused.',
  'Installation de la mise à jour échouée. Version actuelle conservée.': 'Update install failed. Current version kept.',
  '{host} détecté ; contrôle de cette session non disponible. Voir la matrice de compatibilité.': '{host} detected; this session can’t be controlled. See the compatibility matrix.',
  'Aucune installation enregistrée.': 'No recorded installation.',
  'SwiftBar nécessite macOS. Les tests peuvent tourner sous Linux.': 'SwiftBar requires macOS. Tests can run on Linux.',
  '{name} est requis. Installe-le puis relance Install.command.': '{name} is required. Install it, then run Install.command again.',
  'Installe SwiftBar depuis https://swiftbar.app puis relance Install.command.': 'Install SwiftBar from https://swiftbar.app, then run Install.command again.',
  'Trousseau macOS inaccessible. Déverrouille-le puis réessaie.': 'macOS keychain unavailable. Unlock it and try again.',
  'Connexion enregistrée illisible.': 'Saved login is unreadable.',
  'Le trousseau n’a pas enregistré la connexion.': 'The keychain did not save the login.',
  'Claude enregistre sa connexion. Réessaie dans un instant.': 'Claude is saving its login. Try again in a moment.',
  'Connecte {name} avant de basculer.': 'Connect {name} before switching.',
  'Connexion non retrouvée. Réessaie.': 'Login not found. Try again.',
  'Connecté à {email}, pas au compte attendu. Rien n’a changé.': 'Signed in as {email}, not the expected account. Nothing changed.',
  'Les sessions ouvertes passent sur {name}': 'Open sessions are moving to {name}',
  '{n} session(s) lancée(s) avant la mise à jour : elles suivront après leur redémarrage': '{n} session(s) started before the update follow after a restart',
  'Compte actif : {name} ({email})': 'Active account: {name} ({email})',
  'Aucune connexion Claude active.': 'No active Claude login.',
  'Commande inconnue. Commandes : menu, switch, add, rename, remove, doctor.': 'Unknown command. Commands: menu, switch, add, rename, remove, doctor.',
  'Comptes et quotas Claude, bascule à chaud.': 'Claude accounts and usage, switched live.',
  'Installé. Utilise claude comme d’habitude et change de compte depuis la barre de menus.\nSauvegardes privées : {backup}': 'Installed. Use claude as usual and switch accounts from the menu bar.\nPrivate backups: {backup}',
  'Intégration retirée. Comptes et sauvegardes conservés.': 'Integration removed. Accounts and backups kept.',
};

let lang;
// SWITCHBOARD_LANG, then config.json `language`, then the macOS language (SwiftBar plugins usually run without LANG), then LANG.
export function language() {
  if (lang) return lang;
  let value = process.env.SWITCHBOARD_LANG;
  if (!value) {
    try {value = JSON.parse(fs.readFileSync(path.join(process.env.SWITCHBOARD_HOME || path.join(os.homedir(), '.config/claude-switchboard'), 'config.json'), 'utf8')).language;} catch {}
  }
  if (!value && process.platform === 'darwin') {
    try {value = execFileSync('/usr/bin/defaults', ['read', '-g', 'AppleLanguages'], {encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore']}).match(/[a-z]{2}/i)?.[0];} catch {}
  }
  return lang = /^fr/i.test(value || process.env.LANG || '') ? 'fr' : 'en';
}
export const setLanguage = value => {lang = value;};

export function t(fr, vars = {}) {
  const text = language() === 'fr' ? fr : EN[fr] ?? fr;
  return text.replace(/\{(\w+)\}/g, (match, key) => key in vars ? String(vars[key]) : match);
}
