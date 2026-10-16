# Contributing

Use Node.js 22+, Python 3 and a C compiler. There are no npm dependencies to install.

```sh
npm test
npm run test:python
npm run test:tmux
npm run test:coverage
npm run preview
```

Optional host tests create and clean up their own sessions:

```sh
npm run test:herdr  # Herdr installed; or set HERDR_TEST_BINARY
npm run test:orca   # Orca running; checkout registered as an Orca worktree
npm run test:terminal # macOS Terminal.app; may request Automation permission
```

Run host tests from the worktree they should use. Each test has temporary accounts and histories. It does not send prompts to Anthropic or switch existing user sessions.

Keep account/transfer policy separate from terminal control. The [adapter contract](docs/adapters.md) describes the extension point. Add evidence to the [matrix](docs/compatibility.md) when claiming support for another host. Prefer standard-library code and narrow tests of behavior over mocking each implementation line.

Do not commit credentials, Claude histories, local config, terminal captures or downloaded third-party binaries. If debugging needs a trace, reduce it to anonymous states and process-identity facts. Follow local filesystem permissions for runtime data: directories `0700`, JSON/checkpoints `0600`.

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
