# Adding a terminal adapter

Account management, menu rendering and migration policy live outside terminal adapters. An adapter only locates and controls the exact local process/pane it can prove it owns. Start from `src/adapters/tmux.mjs` or `herdr.mjs`; register the module in `src/adapters/index.mjs` and add a matrix row.

## Contract

| Export | Responsibility |
|---|---|
| `available()` | Cheap local capability check; must not launch an app |
| `inventory({checkShells, records})` | Return session rows; throw on an incomplete host inventory. `records` contains validated native/hook records. No terminal mutations |
| `shellActivity(row)` | Return `{known, count}` after checking process identity; unknown is never equivalent to zero |
| `stopClaude(row)` | Recheck incarnation, conversation, idle state, jobs and empty prompt/input fence; send `/exit` once, never kill |
| `shellReady(row)` | Prove the same pane's shell is available and the old Claude process ended |
| `start(row, command)` | Recheck readiness, submit the quoted resume command once; direct supervisor uses `row.targetId`, `receiptId`, `provider.id` instead |
| `focus(row)` | Focus the exact pane if supported; otherwise explain the limitation |

A row contains `adapter`, stable `handle`, `incarnationId`, `connected`, `state` (`idle`, `done`, `working`, `permission`, `unknown`), `worktreePath`, `name`, and `provider: {id, key: 'session_id', transcriptPath}`. Include `claudePid` and `processStamp` whenever available. Keep host-specific identifiers on the row. `accountId`/`accountEmail` are optional: absence means unknown, never the globally selected account.

`incarnationId` must change when a pane's controlling process is replaced. A reusable window/tab index alone is insufficient. A disappeared pane or stale PID must fail before sending input. Never fall back to another pane, the active tab or `--continue`.

## Shared policy

`src/transfer.mjs` owns locking, duplicate-conversation rejection, target authentication, private transcript checkpoints, bounded concurrency, cancellation, deadlines and fresh resume-receipt validation. Adapters do not duplicate this policy. `src/native.mjs` joins validated Claude metadata to native processes; `src/shells.mjs` classifies shell work without reading command-line secrets.

`src/socket.mjs` provides bounded newline JSON on private same-user sockets. The Herdr and direct adapters use it; the Orca adapter dynamically loads Orca's installed runtime client, isolated behind this same adapter contract. That private Orca dependency is deliberate and version-sensitive; it is not vendored into this repository.

## Required evidence

Add a small unit test for parsing and identity rejection, then an isolated real-host smoke test. The smoke must launch its own fixture process, wait through a reply, move between two fake profiles, and assert the same conversation and pane, a new PID, a fresh account receipt and checkpoint. Test busy state, drafts, process replacement and ambiguous delivery. Cleanup may touch only resources created by that test.

The existing `test/fake-claude.c` publishes a native registry and can omit all initial hooks (`TEST_NATIVE_ONLY=1`), so adoption can be tested independently from managed launch. Tests must not use real tokens or the developer's open conversations. Host-specific tests remain opt-in and are marked honestly in the compatibility matrix.
