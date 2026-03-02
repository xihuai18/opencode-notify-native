# Design: opencode-notify-native

As-of: 2026-03-02

## Product decision

This repository targets a single architecture:

- OpenCode plugin sends native notifications directly.
- No VS Code companion extension.
- No queue/status bridge storage.

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

## Configuration contract

Config file: `.opencode/opencode-native-notify.config.json`

Backward compatibility: legacy `opencode-notify.config.json` is also accepted.

Resolution: the first config file found in the candidate list wins (no stacking/merging across multiple files).

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
