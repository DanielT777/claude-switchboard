#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
case "${LANG:-}" in fr*) CLOSE='Entrée pour fermer… ' ;; *) CLOSE='Press Return to close… ' ;; esac
if ! command -v node >/dev/null 2>&1; then
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$candidate" ]; then export PATH="$(dirname "$candidate"):$PATH"; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then brew install node; else
    case "${LANG:-}" in
      fr*) echo 'Installe Node.js 22+ depuis https://nodejs.org puis relance cet installateur.' ;;
      *) echo 'Install Node.js 22+ from https://nodejs.org, then run this installer again.' ;;
    esac
    read -r -p "$CLOSE" || true
    exit 1
  fi
fi
node -e 'if(Number(process.versions.node.split(".")[0])<22)throw Error("Node.js 22+ required")'
node scripts/install.mjs
read -r -p "$CLOSE" || true
