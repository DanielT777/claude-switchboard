# Contributing

Use Node.js 22+. There are no npm dependencies to install.

```sh
npm test
npm run test:coverage
npm run preview            # prints the menu with demo accounts; add -- --switching for the settling state
```

Tests never touch the real keychain: the account switch is tested against an in-memory keychain with the same calls.

Prefer standard-library code and narrow tests of behavior over mocking each implementation line. Do not commit credentials, Claude histories, local config or keychain dumps. Runtime data follows local filesystem permissions: directories `0700`, JSON `0600`.

## Releasing

```sh
npm version minor        # or patch / major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags
```

The tag triggers [release.yml](.github/workflows/release.yml): tests run, the tag is checked against `package.json`, the archive is signed with the maintainer's ed25519 key, then a GitHub release is published with the archive, its signature, its SHA-256 and generated notes. Installed menus offer the update within six hours, and refuse any archive whose signature does not match the public key in `src/update.mjs`.

One-time setup, after creating the repository:

```sh
gh secret set RELEASE_SIGNING_KEY < ~/.config/claude-switchboard-release/release-signing-key.pem
```

Keep an offline backup of that key. If it is lost, the only way forward is a release signed by the old key that ships a new public key; without the old key, existing installs can no longer update automatically.
