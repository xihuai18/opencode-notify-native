# Design: opencode-notify-native

As-of: 2026-03-03

## Product decision

This repository targets a single architecture:

- OpenCode plugin sends native notifications directly.
- No VS Code companion extension.
- No queue/status bridge storage.

## Repository layout

- Repository root is the publishable npm package.
- Runtime code lives in `src/` and builds to `dist/`.
- Repository root also hosts documentation and CI workflows.

## OpenCode plugin runtime facts

Evidence source: local OpenCode source in `opencode/` and official docs.

- Plugins come from local plugin dirs and config `plugin` list.
- Runtime imports plugin modules and invokes exported plugin functions.
- Named hooks are awaited in sequence.
- `event` fan-out is not awaited, so plugin event handlers must be resilient.

## Notification pipeline

1. Receive OpenCode event in `event` hook.
2. Classify to `complete | error | attention`.
3. Build sanitized user-facing text.
4. Pass through dispatcher for collapse/cooldown.
5. Send with platform backend:
   - Windows toast (PowerShell + WinRT)
   - macOS (`terminal-notifier`, fallback `osascript`)
   - Linux (`notify-send`)

## Design constraints

- Never throw from notify path into chat flow.
- Keep payload parsing defensive (event fields can drift by version).
- Keep text short and sanitize token-like substrings.

Notes:

- Config is loaded once at plugin init (no hot-reload).
- Collapse timers are `unref()`'d to keep shutdown fast; the last pending collapsed notification may be dropped on exit.
- Backend backoff state is per notifier instance (created at plugin init) so separate plugin instances do not share suppression state.
- Current OpenCode `Hooks` do not expose a dispose callback; dispatcher `dispose()` exists for tests/future lifecycle hooks.

## Configuration contract

Primary config path: `~/.config/opencode/notify-native.config.json`

Optional project override paths:

- `<worktree>/notify-native.config.json`
- `<worktree>/.opencode/notify-native.config.json`
- `<directory>/notify-native.config.json` (when different from `worktree`)
- `<directory>/.opencode/notify-native.config.json` (when different from `worktree`)

Backward compatibility names still accepted:

- `opencode-native-notify.config.json`
- `opencode-notify.config.json`

Resolution: layered merge (low -> high): global -> `<worktree>` -> `<directory>` -> `.opencode` under each -> `OPENCODE_NOTIFY_NATIVE_CONFIG`.

- `enabled`
- `events.complete|error|attention`
- `soundByEvent.complete|error|attention`
- `collapseWindowMs`
- `cooldownMs`
- `sanitize`
- `maxBodyLength`
- `showDirectory`
- `showSessionId`

## Open-source readiness

- CI/release publish npm package only.
- No committed VSIX artifacts.
- No extension-specific manifests or build scripts.
- README and AGENTS reflect direct-only behavior.
