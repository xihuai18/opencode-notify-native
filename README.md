# opencode-notify-vscode

OpenCode notification stack with two components:

1. OpenCode plugin (npm): `@leo000001/opencode-notify-vscode`
2. VS Code extension (Marketplace): `xihuai18.opencode-notify-vscode`

This split is required because terminal jump needs VS Code terminal APIs.

## What you get

- Native notification-center alerts on Linux, Windows, macOS
- Clear source text in every notification (`host/project/path/session`)
- Event types:
  - `complete` (task done)
  - `error` (task failed)
  - `attention` (input required: `permission.asked` / `question.asked`)
- Third sound profile for `attention`
- Click notification -> jump back to an existing VS Code integrated terminal
  - strict no-op if no matching terminal exists

## Install (recommended)

### 1) OpenCode plugin

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@leo000001/opencode-notify-vscode"]
}
```

### 2) VS Code extension

```bash
code --install-extension xihuai18.opencode-notify-vscode
```

Or from this repo:

```bash
npm run install:marketplace
```

VSIX fallback:

```bash
code --install-extension ./opencode-notify-vscode-<version>.vsix
```

## Remote / WSL / Containers

This project is designed so notifications are sent by the VS Code extension on your local UI machine.

- OpenCode can run locally, in WSL, SSH, or dev containers.
- The OpenCode plugin writes queue events into workspace `.opencode/`.
- The VS Code UI extension consumes the queue and sends local OS notifications.

## Verify quickly

1. Run OpenCode tool `notify_test` (default `attention`).
2. Run VS Code command `OpenCode Notify: Show Diagnostics`.

## Add to .gitignore

Queue and status files are runtime artifacts. Add these to your project `.gitignore`:

```text
.opencode/opencode-notify.queue.jsonl
.opencode/opencode-notify.status.json
```

## Repository layout

- `opencode-plugin/` -> npm plugin source (`@leo000001/opencode-notify-vscode`)
- `src/` -> VS Code extension source

## Build

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

## Release readiness

- CI workflow: `.github/workflows/ci.yml`
- Release workflow: `.github/workflows/release.yml`
  - Packs VSIX
  - Packs plugin tarball
  - Optional publish with `NPM_TOKEN` and `VSCE_PAT`
