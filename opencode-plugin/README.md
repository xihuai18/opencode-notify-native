# @leo000001/opencode-notify-vscode

OpenCode plugin that writes notification requests into:

- `.opencode/opencode-notify.queue.jsonl`

A VS Code companion extension consumes this queue and sends native notifications on your local machine.

## Install

Add this plugin to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@leo000001/opencode-notify-vscode"]
}
```

## Why queue mode

This plugin can run in local, WSL, SSH, or container environments.
By writing queue events into the workspace, the VS Code UI extension can always notify on the computer you are actively using.

## Included tools

- `notify_test`: enqueue a test notification (`complete`/`error`/`attention`)
- `notify_check`: show queue and status diagnostics

## Config file (optional)

Create `.opencode/opencode-notify.config.json` in your project root:

```json
{
  "enabled": true,
  "extensionID": "xihuai18.opencode-notify-vscode",
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
  "showDirectory": true
}
```
