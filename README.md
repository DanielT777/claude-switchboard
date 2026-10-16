<p align="center">
  <img src="docs/assets/logo.svg" width="96" alt="">
</p>

<h1 align="center">Claude Switchboard</h1>

<p align="center">
  Switch Claude Code accounts from the macOS menu bar.<br>
  Your open sessions follow: same terminal, same conversation, new account.
</p>

<p align="center">
  <a href="https://github.com/DanielT777/claude-switchboard/actions/workflows/test.yml"><img src="https://github.com/DanielT777/claude-switchboard/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/DanielT777/claude-switchboard/releases/latest"><img src="https://img.shields.io/github/v/release/DanielT777/claude-switchboard?color=D97757" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/macOS-14%2B-000?logo=apple" alt="macOS 14+">
  <img src="https://img.shields.io/badge/dependencies-0-2ea44f" alt="Zero npm dependencies">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
</p>

<p align="center">
  <img src="docs/assets/switch.gif" width="513" alt="Switching from Work to Personal: each open session finishes its reply, closes and resumes under the new account">
</p>

## Why

You have two Claude subscriptions, say work and personal. Switching means logging out, logging in, and restarting every terminal where Claude was running, losing your place in each conversation.

Switchboard puts both accounts in the menu bar. One click, and every open Claude Code session finishes its current reply, exits cleanly and resumes the same conversation under the other account, in the same pane.

## Features

- **Usage at a glance.** 5-hour and 7-day quotas in the menu bar, read from Claude's own status line. No scraping, no polling, no extra prompts.
- **One-click switch.** Sessions migrate in parallel, each one only once it is idle.
- **No surprises.** The menu lists exactly which sessions a switch will restart, and which it leaves alone and why.
- **Never destructive.** Switchboard never kills a process, never types over a draft, and saves a private transcript checkpoint before every exit.
- **Your terminal, unchanged.** Keep typing `claude`. Existing hooks and status lines keep working.
- **Signed auto-updates.** New versions arrive from GitHub releases and install only if signed by the maintainer's ed25519 key.
- **Speaks your language.** English or French, following your macOS language.

<p align="center">
  <img src="docs/assets/menu.png" width="513" alt="The menu at rest: usage gauges with reset times, accounts with their quotas, and the sessions a switch would restart">
</p>

## Works with

<p>
  <img src="https://img.shields.io/badge/Orca-full-2ea44f" alt="Orca">
  <img src="https://img.shields.io/badge/tmux-full-2ea44f?logo=tmux&logoColor=white" alt="tmux">
  <img src="https://img.shields.io/badge/Herdr-full-2ea44f" alt="Herdr">
  <img src="https://img.shields.io/badge/Terminal.app-full-2ea44f?logo=apple&logoColor=white" alt="Terminal.app">
  <img src="https://img.shields.io/badge/Ghostty-new%20sessions-0A84FF" alt="Ghostty">
  <img src="https://img.shields.io/badge/WezTerm-new%20sessions-0A84FF?logo=wezterm&logoColor=white" alt="WezTerm">
  <img src="https://img.shields.io/badge/Alacritty-new%20sessions-0A84FF?logo=alacritty&logoColor=white" alt="Alacritty">
  <img src="https://img.shields.io/badge/kitty-new%20sessions-0A84FF" alt="kitty">
  <img src="https://img.shields.io/badge/Warp-new%20sessions-0A84FF?logo=warp&logoColor=white" alt="Warp">
  <img src="https://img.shields.io/badge/iTerm2-experimental-FF9F0A?logo=iterm2&logoColor=white" alt="iTerm2">
</p>

| Level | Meaning |
|---|---|
| **full** | Sessions already running before install are adopted and switched in place. |
| **new sessions** | Sessions started with `claude` after install are switched in place. Older ones work through tmux or Herdr. |
| **experimental** | Adapter written against the official scripting API, not yet tested end to end. |

Details and evidence per host: [compatibility matrix](docs/compatibility.md).

## Install

Requires macOS, [Claude Code](https://code.claude.com), Node.js 22+ and Python 3. [SwiftBar](https://swiftbar.app) and Node are installed through Homebrew if missing.

```sh
git clone https://github.com/DanielT777/claude-switchboard.git
cd claude-switchboard && ./Install.command
```

Open a new terminal and type `claude` as usual. Add your second account from the menu with **Add Account…**, which runs Claude's official login.

> [!TIP]
> The menu follows your macOS language. To force one, set `"language": "en"` or `"fr"` in `~/.config/claude-switchboard/config.json`.

## How a switch works

```mermaid
flowchart LR
    A[Click account] --> B{Session idle?}
    B -- reply, shell job or permission pending --> W[Wait] --> B
    B -- yes --> C[Checkpoint transcript]
    C --> D["Send /exit"]
    D --> E[Shell is back]
    E --> F["claude --resume &lt;same id&gt;<br>under the new account"]
    F --> G{SessionStart hook<br>confirms account?}
    G -- yes --> H[Done]
    G -- no --> X[Flagged, never retried blindly]
```

Each account is a separate Claude config directory created by the official `claude auth login`. Conversations, settings, commands and skills are shared through symlinks, so every account sees the same history. Credentials never leave Claude's own storage.

A session is left alone, and shown under **Left alone**, when its host cannot be controlled safely, when it is offline, or when its conversation file cannot be confirmed. Avoid typing in a session while it shows **Closing** or **Resuming**: terminals offer no atomic keyboard lock.

## Update and uninstall

The menu shows **Update to vX.Y.Z…** when a new release is out; one click downloads it, verifies its ed25519 signature and SHA-256, and reinstalls in place. Accounts and sessions are kept. By hand: `claude-switchboard update`.

```sh
npm run uninstall:local
```

Uninstall removes the menu, hooks and shell integration. Your accounts, backups and checkpoints stay in `~/.config/claude-switchboard`.

## Privacy

Everything stays on your Mac. State lives in `~/.config/claude-switchboard` with `0700`/`0600` permissions, conversations stay in `~/.claude/projects`. The only network request Switchboard makes on its own is the GitHub release check, at most every six hours.

Each account remains subject to [Anthropic's terms](https://www.anthropic.com/legal/consumer-terms). Switchboard switches between subscriptions you own; it does not pool or bypass usage limits.

## Contributing

Zero dependencies, `npm test` runs in under a second. See [CONTRIBUTING.md](CONTRIBUTING.md), the [adapter contract](docs/adapters.md) to support a new terminal, and the [validation record](docs/validation.md) for what has been tested for real.

## License

MIT. Independent project, not affiliated with Anthropic, SwiftBar, Orca or Herdr.
