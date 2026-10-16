import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// French is the source language: call sites keep the French text, EN maps it. A missing entry falls back to French.
const EN = {
  // Menu
  'En attente': 'Waiting', 'Fermeture': 'Closing', 'Reprise': 'Resuming', 'Reprise confirmée': 'Resumed',
  'À vérifier': 'Needs attention', 'Annulée': 'Cancelled', 'Non pris en charge': 'Not supported', 'Hors ligne': 'Offline',
  'Historique introuvable': 'History not found', 'Réponse en cours': 'Responding', 'Relancée après la réponse': 'Restarts after the reply',
  'Shell actif · {n}': 'Shell busy · {n}', 'Relancée quand le shell est libre': 'Restarts once the shell is free',
  'Autorisation attendue': 'Needs permission', 'Relancée après ton autorisation': 'Restarts after you approve',
  'Relancée une fois l’état confirmé': 'Restarts once its state is confirmed', 'Prête': 'Ready', 'Relancée immédiatement': 'Restarts right away',
  'compte non confirmé': 'account unconfirmed', '7j': '7d', 'Connecter Claude': 'Connect Claude', 'Cliquer pour masquer': 'Click to dismiss',
  'Mise à jour {version} disponible': 'Update to {version}…', 'Ouvrir l’usage sur claude.ai': 'Open usage on claude.ai',
  '5 h': '5 hours', '7 jours': '7 days', 'Réinitialisation {reset}': 'Resets {reset}', 'Mesuré il y a {n} min': 'Measured {n} min ago',
  'Mesuré à l’instant': 'Measured just now', 'donnée ancienne': 'stale',
  'Quotas affichés après la prochaine réponse Claude': 'Usage appears after Claude’s next reply', 'Comptes': 'Accounts',
  'à vérifier': 'needs attention', 'à connecter': 'not connected', '{email} · basculer relance {n} session(s)': '{email} · switching restarts {n} session(s)',
  'Connecter ce compte dans un terminal': 'Connect this account in a terminal', 'Ajouter un compte…': 'Add Account…',
  'Bascule vers {name} · {done}/{total} reprises': 'Switching to {name} · {done}/{total} resumed',
  'Annuler les reprises en attente': 'Cancel Pending Resumes', 'Bascule partielle · {done}/{total}': 'Partial switch · {done}/{total}',
  'Réessayer les sessions restantes': 'Retry Remaining Sessions', 'Relancées à la bascule · {n}': 'Restarted on switch · {n}',
  'Sessions · {n}': 'Sessions · {n}', '{n} autres sessions': '{n} more sessions', 'Non touchées · {n}': 'Left alone · {n}',
  'Inventaire incomplet': 'Inventory incomplete',
  'Renommer {name}…': 'Rename {name}…', 'Retirer {name}…': 'Remove {name}…', 'Supprimer le profil en attente {name}': 'Delete Pending Profile {name}',
  'Terminal libre': 'Untitled terminal', 'Plus': 'More', 'Nom affiché dans la barre de menus': 'Name shown in the menu bar',
  'Archive le profil localement ; les conversations restent': 'Archives the profile locally; conversations are kept',
  'Diagnostic…': 'Run Diagnostics…', 'Ouvre un terminal et vérifie Claude, Python et les terminaux détectés': 'Opens a terminal and checks Claude, Python and detected terminals',
  'Guide d’utilisation': 'User Guide', 'Ouvre le README': 'Opens the README',
  // Usage
  'réinitialisation inconnue': 'reset time unknown', 'à actualiser après réinitialisation': 'refreshes after reset', 'dans {d}': 'in {d}', 'j': 'd',
  // Accounts and CLI
  'Principal': 'Main', 'Identifiant de connexion invalide.': 'Invalid account ID.',
  'Ce compte n’existe plus. Le menu a été actualisé.': 'This account no longer exists. The menu has been refreshed.',
  'Connexion Claude non vérifiable pour le moment.': 'Claude login can’t be checked right now.',
  'Réponse de connexion Claude non reconnue.': 'Unrecognized response from Claude login.', 'État de connexion non reconnu.': 'Unrecognized login state.',
  'Connecte ce compte Claude avant de le sélectionner.': 'Connect this Claude account before selecting it.',
  'L’identité du compte Claude ne peut pas être confirmée.': 'The Claude account identity can’t be confirmed.',
  'Utilise un nom de 1 à 50 caractères sans caractères de contrôle.': 'Use a name of 1 to 50 characters without control characters.',
  'Le compte principal est géré par Claude Code.': 'The main account is managed by Claude Code.', 'Attends la fin de la bascule.': 'Wait for the switch to finish.',
  'Sélectionne un autre compte avant de retirer celui-ci.': 'Select another account before removing this one.',
  'Ce compte est encore utilisé par une session.': 'A session is still using this account.',
  'Impossible de lancer le programme. Vérifie l’installation.': 'Couldn’t start the program. Check the installation.',
  'Valeur {flag} manquante.': 'Missing value for {flag}.', 'Identifiant de reprise invalide.': 'Invalid resume ID.',
  'Fichier --settings absent ou invalide.': '--settings file missing or invalid.', 'Annuler': 'Cancel', 'Continuer': 'Continue', 'Retirer': 'Remove',
  'Ce compte est déjà connecté. Ajoute un profil pour un autre compte.': 'This account is already connected. Add a profile for another account.',
  'Bascule interrompue. Ouvre la session avant de réessayer.': 'Switch interrupted. Open the session before retrying.',
  'Python 3 est requis pour le mode direct. Relance Install.command.': 'Python 3 is required for direct mode. Run Install.command again.',
  'Claude Switchboard · diagnostic local': 'Claude Switchboard · local diagnostics', 'disponible': 'available', 'absent': 'missing', 'non installé': 'not installed',
  '{profiles} profils · {controllable}/{total} sessions contrôlables': '{profiles} profiles · {controllable}/{total} controllable sessions',
  'Nom court du compte': 'Short account name', 'Ajouter un compte Claude': 'Add a Claude Account', 'Personnel': 'Personal',
  'Nom affiché dans la barre': 'Name shown in the menu bar', 'Renommer le compte': 'Rename Account',
  'Vérifie les sessions ouvertes avant de retirer ce compte.': 'Check open sessions before removing this account.',
  'Retirer {name} du menu ? Le profil sera archivé localement.': 'Remove {name} from the menu? The profile will be archived locally.',
  'Une bascule est déjà en cours.': 'A switch is already in progress.', 'Impossible de lancer la bascule.': 'Couldn’t start the switch.',
  'Session terminée ou inaccessible.': 'Session ended or unreachable.',
  'Commande inconnue. Commandes : claude, menu, doctor, add, switch, cancel.': 'Unknown command. Commands: claude, menu, doctor, add, switch, cancel.',
  'Service indisponible. Lance le diagnostic depuis le menu.': 'Service unavailable. Run diagnostics from the menu.',
  'Claude · à vérifier': 'Claude · needs attention', 'Installation à vérifier. Lance Install.command.': 'Check the installation. Run Install.command.',
  // Store, processes, sockets
  'Fichier local illisible. Restaure sa sauvegarde avant de continuer.': 'Unreadable local file. Restore its backup before continuing.',
  '{name} introuvable. Lance Install.command pour vérifier les dépendances.': '{name} not found. Run Install.command to check dependencies.',
  'TTY non reconnu.': 'Unrecognized TTY.', 'Processus du terminal non confirmés.': 'Terminal processes not confirmed.', 'Terminal non identifié': 'Unidentified terminal',
  'Inventaire des processus incomplet.': 'Process inventory incomplete.', 'Inventaire des processus incohérent.': 'Process inventory inconsistent.',
  'Socket de contrôle non privé.': 'Control socket is not private.', 'Contrôleur inaccessible ou réponse non confirmée.': 'Controller unreachable or reply unconfirmed.',
  'Entrée trop volumineuse.': 'Input too large.',
  // Transfer
  'Une session ne fournit pas encore son historique.': 'A session hasn’t reported its history yet.',
  'Une conversation est ouverte dans deux panneaux. Ferme le doublon avant de basculer.': 'A conversation is open in two panes. Close the duplicate before switching.',
  'Session remplacée depuis le début de la bascule.': 'Session replaced since the switch started.', 'Fin de réponse': 'Finishing reply',
  'Autorisation ou état à vérifier': 'Permission or state to confirm', 'État des shells à vérifier': 'Shell state to confirm',
  '{n} activité(s) shell à terminer': '{n} shell job(s) to finish', 'Dossier de reprise introuvable.': 'Resume folder not found.',
  'La connexion cible a changé.': 'The target login changed.', 'La session de test a disparu.': 'The test session disappeared.',
  'Session hors ligne.': 'Session offline.', 'Adaptateur de terminal inconnu.': 'Unknown terminal adapter.',
  'Claude ne rend pas la main au shell. Aucun arrêt forcé.': 'Claude didn’t return to the shell. Nothing was force-stopped.',
  'Reprise envoyée, confirmation manquante. Ouvre la session avant de réessayer.': 'Resume sent, confirmation missing. Open the session before retrying.',
  // Update
  'Aucune version publiée.': 'No published release.', 'Déjà à jour ({version}).': 'Already up to date ({version}).',
  'Archive de mise à jour absente de la version GitHub.': 'Update archive missing from the GitHub release.',
  'Téléchargement impossible ({status}).': 'Download failed ({status}).', 'Téléchargement de {version}…': 'Downloading {version}…',
  'Somme de contrôle invalide. Mise à jour refusée.': 'Invalid checksum. Update refused.', 'Archive de mise à jour illisible.': 'Unreadable update archive.',
  'Installateur absent de l’archive.': 'Installer missing from the archive.',
  'Signature de mise à jour absente ou invalide. Mise à jour refusée.': 'Update signature missing or invalid. Update refused.', 'Archive de mise à jour non sûre. Mise à jour refusée.': 'Unsafe update archive. Update refused.',
  'Installation de la mise à jour échouée. Version actuelle conservée.': 'Update install failed. Current version kept.',
  // Adapters
  'Registre Claude illisible : inventaire incomplet': 'Claude registry unreadable: inventory incomplete',
  '{name} indisponible : inventaire incomplet': '{name} unavailable: inventory incomplete',
  '{host} détecté ; contrôle de cette session non disponible. Voir la matrice de compatibilité.': '{host} detected; this session can’t be controlled. See the compatibility matrix.',
  'Opération refusée.': 'Operation refused.', 'Superviseur direct inaccessible : inventaire incomplet.': 'Direct supervisor unreachable: inventory incomplete.',
  'Session changée ou saisie en cours.': 'Session changed or input in progress.', 'Activité shell en cours ou non confirmée.': 'Shell activity running or unconfirmed.',
  'Ouvre le terminal dans lequel cette session a été lancée.': 'Open the terminal where this session was started.',
  'Herdr ne confirme pas cette opération.': 'Herdr didn’t confirm this operation.', 'Inventaire Herdr non reconnu.': 'Unrecognized Herdr inventory.',
  'Identité du panneau Herdr non confirmée (panneau, shell ou processus absent).': 'Herdr pane identity not confirmed (pane, shell or process missing).',
  'Shell Herdr introuvable.': 'Herdr shell not found.', 'Inventaire Herdr incomplet.': 'Herdr inventory incomplete.', 'Processus Herdr inconnus.': 'Unknown Herdr processes.',
  'Panneau Herdr remplacé.': 'Herdr pane replaced.', 'Session Herdr changée ou occupée.': 'Herdr session changed or busy.', 'Activité shell en cours.': 'Shell activity running.',
  'Saisie en cours ou invite Claude non reconnue.': 'Input in progress or Claude prompt not recognized.',
  'Le panneau Herdr ne rend pas la main au shell.': 'The Herdr pane didn’t return to the shell.',
  'Shell du terminal remplacé.': 'Terminal shell replaced.', 'Onglet remplacé ou fermé.': 'Tab replaced or closed.',
  'Claude n’occupe plus cet onglet.': 'Claude is no longer running in this tab.', 'Session changée ou occupée.': 'Session changed or busy.',
  'Le terminal ne rend pas la main au shell.': 'The terminal didn’t return to the shell.',
  'Orca introuvable. Installe Orca ou utilise tmux.': 'Orca not found. Install Orca or use tmux.', 'Orca ne confirme pas cette opération.': 'Orca didn’t confirm this operation.',
  'Inventaire Orca incomplet.': 'Orca inventory incomplete.', 'Version Orca incompatible : état des sessions absent.': 'Incompatible Orca version: session state missing.',
  'Identifiant de conversation manquant.': 'Conversation ID missing.', 'Historique non partagé ou non reconnu.': 'History not shared or not recognized.',
  'Session changée ou encore occupée. Aucune interruption.': 'Session changed or still busy. Nothing interrupted.',
  'Processus Claude non confirmé.': 'Claude process not confirmed.',
  'Activité shell en cours ou non confirmée. Aucun arrêt effectué.': 'Shell activity running or unconfirmed. Nothing stopped.',
  'Fermeture refusée par Orca.': 'Orca refused to close the session.', 'Terminal occupé avant la reprise.': 'Terminal busy before resuming.',
  'Reprise refusée par Orca.': 'Orca refused the resume.', 'Inventaire tmux non reconnu.': 'Unrecognized tmux inventory.',
  'Socket tmux non reconnu.': 'Unrecognized tmux socket.', 'Panneau tmux remplacé ou occupé.': 'tmux pane replaced or busy.',
  'Session tmux changée ou encore occupée.': 'tmux session changed or still busy.', 'Le panneau tmux ne rend pas la main au shell.': 'The tmux pane didn’t return to the shell.',
  // Installer
  'Attends la fin de la bascule avant la mise à jour.': 'Wait for the switch to finish before updating.', 'Aucune installation enregistrée.': 'No recorded installation.',
  'Intégration retirée. Comptes, sauvegardes et sessions ouvertes conservés.': 'Integration removed. Accounts, backups and open sessions kept.',
  'SwiftBar nécessite macOS. Les tests peuvent tourner sous Linux.': 'SwiftBar requires macOS. Tests can run on Linux.',
  '{name} est requis. Installe-le puis relance Install.command.': '{name} is required. Install it, then run Install.command again.',
  'Installe SwiftBar depuis https://swiftbar.app puis relance Install.command.': 'Install SwiftBar from https://swiftbar.app, then run Install.command again.',
  'Installé. Ouvre un nouveau terminal puis utilise claude comme d’habitude.\nSauvegardes privées : {backup}': 'Installed. Open a new terminal and use claude as usual.\nPrivate backups: {backup}',
  'Comptes, quotas et reprise progressive des sessions Claude.': 'Accounts, usage and graceful session resume for Claude Code.',
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
