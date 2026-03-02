# @leo000001/opencode-notify-native

OpenCode plugin that sends native OS notifications directly.

## Install

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@leo000001/opencode-notify-native"]
}
```

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

## Event mapping

- `complete`: `session.status` idle and legacy `session.idle`
- `error`: `session.error` (skips `MessageAbortedError`)
- `attention`: permission and question events

Note: `permission.asked` and `question.asked` are runtime events and may not be present in the SDK event union type in some versions.

## Platform dependencies

- Windows: PowerShell toast APIs (built in)
- macOS: `terminal-notifier` recommended, fallback `osascript`
- Linux: `notify-send` (no standard sound support; best-effort sound via `canberra-gtk-play` when available)

## Sound values

- `false`: silent
- `true`: enabled sound (best-effort, per-platform defaults)
- Windows: you can pass `ms-winsoundevent:...`
- macOS: you can pass a sound name (for example `Glass`, `Basso`)

## Development

```bash
npm run build
npm run typecheck
npm test
```
