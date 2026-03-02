# opencode-notify-native

Direct native notification plugin for OpenCode.

## What this repository ships

- npm package: `@leo000001/opencode-notify-native`

## Features

- Native notifications on Windows, macOS, Linux
- Automatic event hooks:
  - `complete`
  - `error`
  - `attention`
- Per-event sound profile
- Notification anti-spam controls (collapse + cooldown)
- Basic text sanitization and truncation

## Install

### From npm

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@leo000001/opencode-notify-native"]
}
```

### Local development install

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///ABSOLUTE/PATH/TO/opencode-plugin/dist/index.js"]
}
```

Use your own absolute path. Do not copy machine-specific paths from examples.

## Optional config

Create `.opencode/opencode-native-notify.config.json`:

Config resolution: the first config file found wins. Legacy `opencode-notify.config.json` is accepted as a fallback.

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
  "showDirectory": true,
  "showSessionId": false
}
```

## Platform notes

- Windows: notifications depend on system notification settings and Focus Assist.
- macOS: tries `terminal-notifier` first, falls back to `osascript`.
- Linux: requires `notify-send` (for example `libnotify-bin` on Debian/Ubuntu). `notify-send` has no standard sound support; this plugin can only best-effort play sounds when `canberra-gtk-play` is available.

## Build and test

```bash
npm install --prefix opencode-plugin
npm run build --prefix opencode-plugin
npm run typecheck --prefix opencode-plugin
npm test --prefix opencode-plugin
```

## Release

- CI and release workflows publish only the npm plugin.
- Tag push (`v*`) runs build/typecheck/test/pack and optionally publishes to npm when `NPM_TOKEN` is configured.

## Design and maintenance docs

- Runtime design: `DESIGN.md`
- Maintainer guardrails: `AGENTS.md`
