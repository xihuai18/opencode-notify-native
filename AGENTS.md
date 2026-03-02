# AGENTS.md - opencode-notify-vscode

## 1) Scope

This repository contains two deliverables:

1. OpenCode plugin package: `@leo000001/opencode-notify-vscode`
2. VS Code companion extension: `xihuai18.opencode-notify-vscode`

The plugin writes queue events. The extension sends OS-native notifications and handles click-to-jump.

## 2) Hard constraints

- Do not modify OpenCode core source.
- Keep plugin and extension decoupled (publish independently).
- Terminal jump must be strict no-op when no matching terminal exists.
- Default supported event classes:
  - `complete`
  - `error`
  - `attention` (`permission.asked` and `question.asked`)
- `attention` must keep a third distinct sound profile.

## 3) Runtime architecture

- Queue file: `.opencode/opencode-notify.queue.jsonl`
- Status file: `.opencode/opencode-notify.status.json`
- Plugin writes queue entries.
- Extension watches + polls queue file, tracks byte offsets, emits native notifications.
- Extension URI handler handles `vscode://<ext-id>/opencode-jump?...`.

## 4) Remote behavior

Remote, container, and WSL scenarios are supported through the VS Code UI extension model:

- OpenCode runtime can be remote.
- Notifications are emitted on the local user machine from the VS Code UI side.

## 5) Platform notes

- Windows: Toast via PowerShell + WinRT XML.
- macOS: `terminal-notifier` preferred for clickable notifications; fallback `osascript` is non-clickable.
- Linux: `notify-send`; action click depends on daemon support.

## 6) Security / privacy defaults

- Redact token-like strings from notification text.
- Keep body length bounded.
- Show shortened paths by default.

## 7) Build / validation

Extension:

```bash
npm install
npm run build
```

Plugin:

```bash
npm install --prefix opencode-plugin
npm run build --prefix opencode-plugin
```
