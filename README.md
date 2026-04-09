# opencode-notify-native

Direct native notification plugin for OpenCode.

When OpenCode is running outside the TUI, this plugin stays quiet by default.

## What this repository ships

- npm package: `@leo000001/opencode-notify-native`

## Repository layout

- `src/`: plugin source code
- `dist/`: build output used by npm package entrypoints
- repository root `package.json`: publishable package `@leo000001/opencode-notify-native`
- repository root also contains docs and CI workflows

## Features

- Native notifications on Windows, macOS, Linux
- Auto-silence in non-TUI runtimes to avoid duplicate frontend alerts
- Automatic event hooks:
  - `complete`
  - `error`
  - `attention`
- Defensive event payload parsing (raw + wrapped hook envelopes)
- Per-event sound profile
- Notification anti-spam controls (collapse + cooldown)
- Basic text sanitization and truncation

## Notification signal policy

- Notify only terminal, user-actionable events.
- Do not notify non-terminal progress states; specifically, `session.status` with `busy` / `retry` is always ignored.
- Treat user-initiated interrupt/cancel/abort flows as no-notify outcomes.
- `session.status idle` is considered complete only after a recent active status for the same session.
- Legacy `session.idle` duplicates are suppressed when `session.status idle` has already been seen.
- Complete notifications are held briefly and canceled if a `session.error` arrives right after idle, preventing false "Completed" after failures/aborts.
- Idle transitions right after non-abort errors are suppressed to avoid "Error + Completed" double noise.
- Attention notifications are emitted only for unresolved prompts (`permission.asked`, unresolved legacy `permission.updated`, and `question.asked`).
- Permission and question prompts are briefly delayed and canceled if the same request is resolved immediately, so auto-approved or instantly answered flows stay quiet by default.
- Acknowledgement events (`permission.replied`, `question.replied`, `question.rejected`) and legacy `question.updated` are ignored.
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
  "autoSilence": {
    "nonTui": true
  },
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

- `autoSilence.nonTui` silences the plugin for non-TUI OpenCode runtimes, including Desktop, ACP, and server commands such as `opencode web` and `opencode serve`.
- Backward compatibility: older configs can still use `autoSilence.desktop`, which is treated as an alias for `autoSilence.nonTui`.
- `sanitize: true` enables best-effort redaction of token-like substrings (for example `Bearer ...`).
- Regardless of `sanitize`, the plugin normalizes whitespace, strips control characters, and clamps lengths to keep notification backends stable.
- If you set `sanitize: false`, notifications may include secrets from tool output or error messages.
- `showDirectory` defaults to `false` to reduce lock-screen/path leakage. Enable it only if directory context is worth the privacy tradeoff.

## Data files

- This plugin does not persist state files.
- No queue/status bridge is used.

## Platform notes

- Windows: notifications depend on system notification settings and Focus Assist.
- Windows sender label: defaults to Explorer to keep click behavior stable. Set `OPENCODE_NOTIFY_NATIVE_WINDOWS_SENDER=terminal` to prefer Windows Terminal app IDs.
- Windows command launch is hardened for `.cmd`/shim-heavy environments (including CI) with retry and shell fallbacks.
- macOS: prefers the bundled `NotifyNativeHelper.app` for notification UI/click handling and uses best-effort explicit sound playback. If the helper is unavailable, it falls back to `osascript` (`display notification`).
- macOS sound names accept both legacy file names (`Glass`, `Basso`, `Funk`, ...) and newer UI labels (`Crystal`, `Mezzo`, `Boop`, ...). Custom sounds resolve from `~/Library/Sounds`, `/Library/Sounds`, then `/System/Library/Sounds`.
- Linux: requires `notify-send` (for example `libnotify-bin` on Debian/Ubuntu). Backend delivery falls back through `long -> short -> plain -> minimal` argument modes for compatibility.
- Linux sound: `notify-send` has no standard sound support; this plugin can only best-effort play sounds when `canberra-gtk-play` is available.
- Sender identity is platform-defined: macOS `osascript` does not support setting the sender to the current terminal, Windows sender is tied to the selected AUMID, and Linux can only provide a best-effort app name (`opencode`).

## Debugging

If a config file exists but is ignored (for example due to invalid JSON), this plugin falls back to the last successfully loaded config (built-in defaults if none).

- Non-ENOENT config load failures emit a one-time warning to stderr.
- Unknown config keys emit a one-time warning and are ignored.
- Backend command spawn failures also emit one-time warnings to stderr.
- macOS helper overrides: set `OPENCODE_NOTIFY_NATIVE_MAC_HELPER=/path/to/NotifyNativeHelper` to test a custom helper binary, or `OPENCODE_NOTIFY_NATIVE_DISABLE_MAC_HELPER=1` to force `osascript` fallback.
- Set `OPENCODE_NOTIFY_NATIVE_DEBUG=1` for detailed debug logs (including full error messages and ignored event traces).
- Config is loaded once at plugin initialization (no hot-reload during a running session).

If you are testing and expect a banner for every completion, note the defaults:

- `collapseWindowMs` collapses bursts into one notification.
- `cooldownMs` suppresses repeats for the same session/event.
- Auto-resolved permission/question requests are suppressed by default, so `attention` notifications usually surface only for prompts that still need user action.

Implementation note:

- `collapseWindowMs` is a fixed window starting at the first event for a given key (it does not extend on each subsequent event).
- Collapse timers are `unref()`'d, so a last pending collapsed notification can be dropped if OpenCode exits before the window fires.

## Click behavior

- The plugin keeps click behavior as best-effort no-op.
- The plugin does not register any custom click action.
- On macOS helper-backed notifications, clicking the notification should only dismiss that notification without surfacing any editor or terminal window.
- On macOS `osascript` fallback, custom click actions are not supported; click behavior is controlled by Notification Center and varies by system settings.
- On Linux and Windows, click handling still depends on the OS notification service and cannot be guaranteed as strict no-op in every environment.
- It is intentionally not designed to jump/focus the originating terminal/editor window.
- If you opt into `OPENCODE_NOTIFY_NATIVE_WINDOWS_SENDER=terminal`, click behavior is still best-effort no-op but depends on Windows Terminal activation handling.

## Build and test

```bash
npm install
npm run build
npm run typecheck
npm test
```

- On macOS, `npm run build` also rebuilds the bundled `NotifyNativeHelper.app` used for close-only click handling.
- On non-macOS source checkouts, helper bundling is skipped and runtime falls back to `osascript` unless you point `OPENCODE_NOTIFY_NATIVE_MAC_HELPER` at a custom build.

Optional local integration check on macOS (sends a real notification):

```bash
OC_NOTIFY_NATIVE_INTEGRATION=1 npm test
```

## Release

- CI and release workflows publish only the npm plugin.
- Tag push (`v*`) runs build/typecheck/test/pack and optionally publishes to npm when `NPM_TOKEN` is configured.
- Before release, ensure your local worktree is clean (`git status`) so unpublished local edits do not skew manual verification.

## Design and maintenance docs

- Runtime design: `DESIGN.md`
- Maintainer guardrails: `AGENTS.md`
