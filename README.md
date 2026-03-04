# opencode-notify-native

Direct native notification plugin for OpenCode.

## What this repository ships

- npm package: `@leo000001/opencode-notify-native`

## Repository layout

- `src/`: plugin source code
- `dist/`: build output used by npm package entrypoints
- repository root `package.json`: publishable package `@leo000001/opencode-notify-native`
- repository root also contains docs and CI workflows

## Features

- Native notifications on Windows, macOS, Linux
- Automatic event hooks:
  - `complete`
  - `error`
  - `attention`
- Per-event sound profile
- Notification anti-spam controls (collapse + cooldown)
- Basic text sanitization and truncation

## Notification signal policy

- Notify only terminal, user-actionable events.
- Do not notify non-terminal progress states (for example `running`, `thinking`, `retrying`, `progress`).
- User-initiated interrupt/cancel/abort flows are treated as no-notify outcomes.
- Short idle transitions right after cancel/error signals are suppressed to reduce false "Completed" or "Error + Completed" noise.
- Terminal `permission.updated` / `question.updated` replies are suppressed; only unresolved prompts notify as attention.
- When event semantics are unclear, the plugin prefers no-notify and relies on debug logs for observation.

## Runtime compatibility

- This package is ESM-only (`"type": "module"`).

## Notification content

- Title format: `OpenCode · <Session Title or Project>`
- Body first line: `<Completed|Error|Attention> · <summary>`
- Optional body lines:
  - `Project Dir: <shortened worktree path>` (controlled by `showDirectory`)
  - `Session ID: <first 8 chars>` (controlled by `showSessionId`, default off)

## Install

### From npm

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@leo000001/opencode-notify-native"]
}
```

### `opencode.json` vs `tui.json`

- Put plugin registration in `opencode.json` (`plugin: [...]`).
- Use `tui.json` only for terminal UI preferences/keymaps.
- This plugin is loaded from OpenCode runtime config, not from TUI-only config.

### Local development install

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///ABSOLUTE/PATH/TO/plugins/opencode-notify-native/dist/index.js"
  ]
}
```

Use your own absolute path, but always point to this entry file:

- `.../opencode-notify-native/dist/index.js`

Notes:

- `dist/` is generated. Run `npm ci` and `npm run build` before using the file URL (and re-run after making changes).

## Optional config

Recommended global config:

- `~/.config/opencode/notify-native.config.json`
- Windows fallback: `%APPDATA%\\opencode\\notify-native.config.json`

Optional project overrides:

- `<worktree>/notify-native.config.json`
- `<directory>/notify-native.config.json` (when different from `worktree`)
- `<worktree>/.opencode/notify-native.config.json`
- `<directory>/.opencode/notify-native.config.json` (when different from `worktree`)

Note: OpenCode provides both `worktree` (project root) and `directory` (current working directory). In monorepos they can differ; this plugin checks both locations.

Compatibility names still supported:

- `opencode-native-notify.config.json`
- `opencode-notify.config.json`

Resolution order (low -> high):

1. Global config (`~/.config/opencode/...`)
2. `<worktree>/...`
3. `<directory>/...`
4. `<worktree>/.opencode/...`
5. `<directory>/.opencode/...`
6. `OPENCODE_NOTIFY_NATIVE_CONFIG` (if set)

Values are layered; later sources override earlier ones.

```json
{
  "enabled": true,
  "events": {
    "complete": true,
    "error": true,
    "attention": true
  },
  "soundByEvent": {
    "complete": true,
    "error": "error",
    "attention": "attention"
  },
  "collapseWindowMs": 3000,
  "cooldownMs": 30000,
  "sanitize": true,
  "maxBodyLength": 200,
  "showDirectory": false,
  "showSessionId": false
}
```

Notes:

- `sanitize: true` enables best-effort redaction of token-like substrings (for example `Bearer ...`).
- Regardless of `sanitize`, the plugin normalizes whitespace, strips control characters, and clamps lengths to keep notification backends stable.
- If you set `sanitize: false`, notifications may include secrets from tool output or error messages.
- `showDirectory` defaults to `false` to reduce lock-screen/path leakage. Enable it only if directory context is worth the privacy tradeoff.

## Data files

- This plugin does not persist state files.
- No queue/status bridge is used.

## Platform notes

- Windows: notifications depend on system notification settings and Focus Assist.
- macOS: tries `terminal-notifier` first (recommended), falls back to `osascript`. The `osascript` fallback cannot replace/group notifications at the OS level, so install `terminal-notifier` (for example `brew install terminal-notifier`) if you want best replacement behavior.
- Linux: requires `notify-send` (for example `libnotify-bin` on Debian/Ubuntu). `notify-send` has no standard sound support; this plugin can only best-effort play sounds when `canberra-gtk-play` is available.

## Debugging

If a config file exists but is ignored (for example due to invalid JSON), this plugin falls back to the last successfully loaded config (built-in defaults if none).

- Non-ENOENT config load failures emit a one-time warning to stderr.
- Unknown config keys emit a one-time warning and are ignored.
- Set `OPENCODE_NOTIFY_NATIVE_DEBUG=1` for detailed debug logs (including full error messages and ignored event traces).
- Config is loaded once at plugin initialization (no hot-reload during a running session).

If you are testing and expect a banner for every completion, note the defaults:

- `collapseWindowMs` collapses bursts into one notification.
- `cooldownMs` suppresses repeats for the same session/event.

Implementation note:

- `collapseWindowMs` is a fixed window starting at the first event for a given key (it does not extend on each subsequent event).
- Collapse timers are `unref()`'d, so a last pending collapsed notification can be dropped if OpenCode exits before the window fires.

## Click behavior

- The plugin does not register any click action.
- It is intentionally not designed to jump/focus the originating terminal/editor window.

## Build and test

```bash
npm install
npm run build
npm run typecheck
npm test
```

## Release

- CI and release workflows publish only the npm plugin.
- Tag push (`v*`) runs build/typecheck/test/pack and optionally publishes to npm when `NPM_TOKEN` is configured.
- Before release, ensure your local worktree is clean (`git status`) so unpublished local edits do not skew manual verification.

## Design and maintenance docs

- Runtime design: `DESIGN.md`
- Maintainer guardrails: `AGENTS.md`
