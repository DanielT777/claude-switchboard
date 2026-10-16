# Validation record

Local validation on macOS arm64, 2026-10-16. Tests use temporary state directories and explicit host handles. Existing user conversations are not transferred by the test suite.

| Check | Result | What it proves |
|---|---|---|
| Node unit/contract tests | 75 passing on Node 22 | Account identity, input validation, archive safety, hooks, usage, menu, registry discovery, nested-host resolution, private RPC, transcript boundaries, transfer ordering, cancellation, failure isolation, duplicate refusal |
| Python supervisor guard | 1 passing test, multiple rejected states | Wrong conversation, working/permission/ended state, fresh hooks and later input cannot trigger exit |
| Installer lifecycle | Included in Node suite | Install/upgrade/uninstall preserve user hooks, original status line, permissions and symlinked dotfiles; rollback restores prior files |
| Original status-line execution | Included in Node suite | Exact stdin reaches the original command; only quota metadata is stored; malformed telemetry cannot suppress original output |
| Direct PTY supervisor | Fixture E2E passed | Draft blocks stop, reply finishes first, same conversation/pane resumes with second fake account, new PID and private checkpoint |
| tmux 3.6a | Fixture E2E passed | Native session adopted without any initial Switchboard hook, named socket autodetected, same-pane second-account resume |
| Herdr 0.9.5 | Fixture E2E passed | Named server auto-discovery, native adoption, busy waiting, same terminal/conversation, confirmed second fake account |
| Orca 1.4.222 | Fixture E2E passed | Native process adoption, rendered prompt check, pane incarnation, shell return, same-pane second-account resume and graceful cleanup |
| Terminal.app | Fixture E2E passed | Exact TTY mapping, native adoption, response completion and same-tab second-account resume via JXA |
| Real Claude Code 2.1.301 | Same-account E2E passed | One real response, same conversation and pane after resume, changed PID, fresh account receipt, actual quota payload captured |
| Real cross-account Anthropic resume | **Not verified** | Only one real account was signed in; fake accounts test orchestration, not service-side authorization |
| iTerm / other terminal GUIs | **Not E2E tested** | See matrix for native versus managed-mode claims |
| SwiftBar visual inspection | Menu output/fixtures verified; native menu screenshot unavailable through the desktop provider | The provider does not expose menu-bar surfaces; do not interpret generated output as a visual screenshot |
| GitHub Actions | Test and signed-release workflows pass actionlint; **not run remotely yet** | Runs once the repository is published |

The real smoke test is opt-in and uses the currently signed-in account for one short answer:

```sh
node scripts/smoke-real.mjs --real-claude
```

It creates its own tmux pane, accepts workspace trust only for its generated temporary directory, disables tools/MCP for that test session, and selects only its own handle for the transfer. Its test conversation may remain in Claude's normal history; it does not purge user history.

## Coverage interpretation

`npm run test:coverage` reports unit/contract coverage. Host E2E scripts and their subprocesses run separately and are **not** counted by that report. In particular, low unit line coverage in a host adapter is not evidence that the corresponding live host test ran; the table above is the execution record. No blanket 100% coverage claim is made.

## Limits still worth testing before a public release

Real two-account switching with both subscriptions signed in; iTerm2 native control; direct-mode GUI behavior in Ghostty/WezTerm/Alacritty/kitty/Warp/VS Code; other macOS versions; interrupted login and long-running detached tasks; clean-machine installation without preinstalled developer tools. Native input checks cannot eliminate a keyboard race during the final exit/start interval.
