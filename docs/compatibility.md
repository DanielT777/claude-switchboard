# Compatibility matrix

Updated 2026-10-16. **Existing** means a Claude process started before Switchboard was installed. **Managed** means an interactive session started through the installed `claude` shell function or `claude-switchboard claude`.

“Fixture E2E” uses the real terminal host and real PTYs, with a compiled native Claude substitute and two fake accounts. It proves discovery, waiting, exit, account isolation and same-ID resume plumbing. It does **not** prove Anthropic accepts a real cross-account resume.

| Host / mode | Adopt existing sessions | Managed sessions | Detection and constraints | Evidence |
|---|---|---|---|---|
| Orca local terminals | Yes, when PID/session/history are confirmed | Yes | Installed runtime client, terminal incarnation, native Claude registry or Orca provider metadata; rendered empty prompt required | Fixture E2E on Orca 1.4.222; native adoption without hooks verified |
| tmux, including inside Orca / Ghostty / iTerm | Yes | Yes | Enumerates own default/named sockets, matches pane TTY and process ancestry; custom socket learned from hooks or `TMUX` | Fixture E2E on tmux 3.6a; native adoption without hooks verified |
| Herdr local sessions | Yes | Yes | Enumerates running local named servers; socket API maps pane, terminal ID and foreground PID; native registry supplies conversation | Fixture E2E on Herdr 0.9.5; native adoption without hooks verified |
| Terminal.app | Yes, when PID/session/history are confirmed | Yes | AppleScript/JXA maps exact TTY and shell incarnation, then verifies foreground process and prompt; requires macOS Automation permission | Native adoption and same-pane resume verified with fixture E2E |
| iTerm2 | Experimental native adapter | Yes | Exact session unique ID and TTY, foreground-process checks; requires Automation permission | Official scripting contract reviewed; app absent from validation machine |
| Ghostty 1.2.x | Through tmux / Herdr; standalone existing sessions cannot be adopted safely | Yes | Direct supervisor needs no Ghostty scripting API | Installed 1.2.3 inspected; supervisor exercised through a real PTY, Ghostty GUI not E2E tested |
| Ghostty 1.3+ | Through tmux / Herdr; standalone native adoption not implemented | Yes | AppleScript exists, but stable PID/TTY association and prompt reads are insufficient for this adapter | Official documentation reviewed; not installed/tested |
| WezTerm, Alacritty, kitty, Warp, VS Code integrated terminal | Through tmux / Herdr; standalone native adoption not implemented | Expected via standard PTY supervisor | No special terminal API needed for managed mode; host-specific UI focus may be unavailable | PTY protocol tested; these GUIs not E2E tested |
| Other interactive local terminals | Only through an available host adapter | Expected if a POSIX PTY is available | Launch with `claude-switchboard claude` when no shell function is installed | No universal GUI guarantee |
| SSH, containers, remote Orca / Herdr | No | Not managed by the local menu | Remote credentials, processes and transcripts require a separate remote agent | Explicitly unsupported in this release |
| `claude -p`, SDK/stream mode, background agents, desktop/cloud launcher | No automatic migration | Passed through to native Claude | These are separate process/lifecycle contracts | Bypass routing unit-tested; no transfer claim |

## Automatic resolution

1. Discover live interactive Claude records and installed Switchboard hooks. Validate UUID, native process name, PID, start time and TTY. Claude registry timestamps can be UTC while `ps` uses local time; both are checked against the same process.
2. Probe available hosts. A host is selected by process identity, never only by current directory, window title or keyboard focus.
3. Resolve nested hosts once per PID/start-time pair: direct supervisor → tmux → Herdr → Orca → macOS scripting. Distinct processes sharing a conversation remain a visible conflict.
4. Show unmatched sessions as **Reprise indisponible**. Host errors mark inventory incomplete. A stale tmux socket whose server has exited is ignored.

There is normally no terminal selection to configure. The optional `config.json` `adapters` array can restrict discovery; `binaries` can point to nonstandard installations. Arbitrary tmux `-S` sockets outside conventional directories need an installed hook, a `TMUX` environment reference, or a future socket-discovery adapter. Herdr is discovered using its CLI; no private server path is guessed.

## Claude and platform requirements

| Component | Contract / tested version | Limit |
|---|---|---|
| Claude Code | Native CLI 2.1.301; live registry discovery also observed on 2.1.299 | Native session registry is an internal, version-sensitive format; unknown identities fail closed |
| Authentication | Official `claude auth login --claudeai` / `auth status --json`, isolated `CLAUDE_CONFIG_DIR` | Subscription accounts only; API-key/Bedrock/Vertex accounts are not switch targets |
| History | Shared local JSONL transcript and `--resume <UUID>` | No new conversation, fork, or inferred “continue latest” fallback |
| Completion evidence | SessionStart, UserPromptSubmit, Stop, StopFailure, PermissionRequest, SessionEnd plus native/host status | Other blocking hooks and detached tasks can complicate idle detection |
| Background work | Hook task/cron counts and descendant shell-process checks | Detached work and Node/Python-only monitors without task metadata cannot be exhaustively classified |
| Usage | Documented status-line `rate_limits.five_hour` / `seven_day` | Available only when Claude emits it; stale/absent values stay explicit |
| Node.js | 22+ | Zero npm runtime dependencies |
| Python | Python 3, standard library PTY module | Required for terminal-independent direct mode |
| SwiftBar | 2.1.1 installed locally | Installer and native application adapters target macOS; Linux is limited to core/PTY testing |
| Shell | Bash / Zsh automatic integration; Fish/others use explicit launcher | Native shell readiness currently recognizes zsh, bash, fish and sh |

## Preserved and unverified behavior

- Preserved: conversation ID/history, working directory, pane where the host permits it, shared settings, account isolation, existing status-line output, existing hooks.
- Managed startup options: supported explicit flags are retained in supervisor memory. Multi-value options should use comma-separated values or repeated flags. Original prompts/session selectors are not replayed. Unknown launch flags are not restored automatically.
- Adopted processes: original ephemeral arguments/environment are not scraped or reconstructed. Permission mode, ad hoc MCP configuration and model overrides may need to be reapplied. No permission bypass is invented from transcript content.
- Native host APIs cannot atomically prevent concurrent keyboard input between the final check and `/exit`. Draft checks and process fences narrow this race; avoid typing during a transfer's closing/restarting stages.
- Real authentication, quota rendering and a real two-account migration are distinct checks. See [validation.md](validation.md) for what has actually run.

## Primary sources


- [Claude session resume](https://code.claude.com/docs/en/cli-reference), [hooks](https://code.claude.com/docs/en/hooks), [status-line usage](https://code.claude.com/docs/en/statusline).
- [SwiftBar plugin format](https://github.com/swiftbar/SwiftBar).
- [Herdr agent automation](https://herdr.dev/docs/agent-automation/), [socket API](https://herdr.dev/docs/socket-api), [CLI reference](https://herdr.dev/docs/cli-reference/), [resume behavior discussion](https://github.com/herdrdev/herdr/discussions/1080).
- [Ghostty AppleScript](https://ghostty.org/docs/features/applescript), [1.3 release notes](https://ghostty.org/docs/install/release-notes/1-3-0), [PID/TTY API limitation](https://github.com/ghostty-org/ghostty/issues/11592).
- [iTerm2 scripting](https://iterm2.com/3.4/documentation-scripting.html).
- Orca: installed `orca skills get orca-cli`, `orca terminal --help`, runtime process fences and rendered-screen API. Terminal.app: installed `Terminal.sdef` scripting dictionary.
