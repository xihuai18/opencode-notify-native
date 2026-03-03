# AGENTS.md - opencode-notify-native

## 1) Repository purpose

This repository maintains a single deliverable:

- npm plugin: `@leo000001/opencode-notify-native`

The plugin sends native system notifications directly from OpenCode runtime events.

Repository layout (authoritative):

- repository root is the publishable package.
- `src/` contains plugin source code.
- `dist/` is generated build output.
- repository root also contains docs and CI workflows.

## 2) Scope and non-goals

In scope:

- Event-driven notifications for `complete` / `error` / `attention`
- Cross-platform notification backends (Windows/macOS/Linux)
- Noise control (collapse + cooldown)
- Safe text handling (sanitize, truncation)

Out of scope:

- VS Code terminal jump
- Queue/status bridge files
- VSIX/Marketplace extension publishing

## 3) OpenCode plugin runtime constraints

Based on docs and source:

- Runtime loads plugin module exports and invokes plugin functions.
- `event` hooks are not awaited by core event fan-out, so handlers must be non-blocking and fault-tolerant.
- Named hooks are executed sequentially.

Design rules for this repo:

- Keep module exports minimal and intentional.
- Never let notification failures break the conversation flow.
- Use defensive payload parsing for events.

## 4) Configuration contract

Config file path:

- Global default: `~/.config/opencode/notify-native.config.json`
- Project overrides:
  - `<worktree>/notify-native.config.json`
  - `<directory>/notify-native.config.json` (when different from `worktree`)
  - `<worktree>/.opencode/notify-native.config.json`
  - `<directory>/.opencode/notify-native.config.json` (when different from `worktree`)
- Env override: `OPENCODE_NOTIFY_NATIVE_CONFIG=/absolute/path/to/config.json`

Backward compatibility names still accepted:

- `opencode-native-notify.config.json`
- `opencode-notify.config.json`

Resolution: layered merge (low -> high): global -> `<worktree>` -> `<directory>` -> `.opencode` under each -> env override.

Supported fields:

- `enabled`
- `events.complete|error|attention`
- `soundByEvent.complete|error|attention`
- `collapseWindowMs`
- `cooldownMs`
- `sanitize`
- `maxBodyLength`
- `showDirectory`
- `showSessionId`

## 5) Security and privacy defaults

- Redact token-like substrings in outgoing notification text.
- Clamp message length.
- Use short directory rendering by default.
- Do not persist notification payloads to local data files.

## 6) Build, test, release

Local commands:

```bash
npm install
npm run build
npm run typecheck
npm test
```

Release pipeline:

- CI builds/tests plugin only.
- Release workflow packs/publishes npm package only.

## 7) Open-source readiness checklist

- README reflects direct-only behavior and platform caveats.
- `package.json` metadata matches current architecture.
- No committed VSIX or extension artifacts.
- No reserved-name junk files (`nul`, etc.).
- Workflows do not publish VS Code extension artifacts.
