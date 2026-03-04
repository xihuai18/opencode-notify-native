import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

import { backendBackoffMs } from './backoff.js'
import { debugWarn } from './debug.js'
import { fnv1a32 } from './hash.js'
import type { NotifyEventType, NotifySound } from './types.js'

function stripControlChars(input: string): string {
  return input.replace(/[\u0000-\u001F\u007F]/g, '').trim()
}

const visibleWarned = new Set<string>()

function visibleWarnOnce(key: string, message: string): void {
  if (visibleWarned.has(key)) return
  visibleWarned.add(key)
  try {
    process.stderr.write(`[notify-native] Warning: ${message}\n`)
  } catch {
    // Best-effort only.
  }
}

export function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function escapePango(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function hashHex(input: string, length: number): string {
  return createHash('sha256')
    .update(input, 'utf8')
    .digest('hex')
    .slice(0, length)
}

function run(
  command: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
        env: options.env ? { ...process.env, ...options.env } : process.env,
      })
    } catch (error) {
      visibleWarnOnce(
        `spawn:${command}`,
        `failed to start ${command}; native notifications may be unavailable`,
      )
      debugWarn(
        `Failed to spawn ${command}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      resolve(false)
      return
    }
    // Best-effort: do not keep OpenCode running just to finish a notification.
    child.unref?.()

    let done = false
    let exited = false
    let hardKill: NodeJS.Timeout | undefined

    const settle = (ok: boolean): void => {
      if (done) return
      done = true
      resolve(ok)
    }

    const timer =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? setTimeout(() => {
            if (done) return
            try {
              child.kill()
            } catch (error) {
              debugWarn(
                `Failed to terminate process ${command}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              )
            }
            hardKill = setTimeout(() => {
              if (exited || child.exitCode !== null) return
              try {
                child.kill('SIGKILL')
              } catch (error) {
                debugWarn(
                  `Failed to force-kill process ${command}: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                )
              }
            }, 250)
            hardKill.unref?.()
            settle(false)
          }, options.timeoutMs)
        : undefined

    timer?.unref?.()

    child.on('error', () => {
      exited = true
      if (timer) clearTimeout(timer)
      if (hardKill) clearTimeout(hardKill)
      settle(false)
    })
    child.on('close', (code) => {
      exited = true
      if (timer) clearTimeout(timer)
      if (hardKill) clearTimeout(hardKill)
      settle(code === 0)
    })
  })
}

function normalizeSound(
  event: NotifyEventType,
  sound: NotifySound,
): boolean | string {
  if (typeof sound === 'boolean') return sound
  if (typeof sound === 'string') {
    const value = stripControlChars(sound).slice(0, 200)
    if (value) return value
  }
  if (event === 'complete') return true
  if (event === 'error') return 'error'
  return 'attention'
}

type BackendState = {
  linuxNotifySendDisabledUntil: number
  linuxNotifySendFailures: number
  linuxNotifySendMode: 'auto' | 'long' | 'short' | 'plain'
  windowsNotifyDisabledUntil: number
  windowsNotifyFailures: number
  windowsPreferredShell: '' | 'pwsh' | 'powershell'
  macNotifyDisabledUntil: number
  macNotifyFailures: number
  linuxCanberraDisabledUntil: number
  linuxCanberraFailures: number
  linuxCanberraInFlight: boolean
}

function createBackendState(): BackendState {
  return {
    linuxNotifySendDisabledUntil: 0,
    linuxNotifySendFailures: 0,
    linuxNotifySendMode: 'auto',
    windowsNotifyDisabledUntil: 0,
    windowsNotifyFailures: 0,
    windowsPreferredShell: '',
    macNotifyDisabledUntil: 0,
    macNotifyFailures: 0,
    linuxCanberraDisabledUntil: 0,
    linuxCanberraFailures: 0,
    linuxCanberraInFlight: false,
  }
}

export function windowsAudioNode(sound: boolean | string): string {
  if (sound === false) return '<audio silent="true"/>'
  if (sound === true) {
    return '<audio src="ms-winsoundevent:Notification.Default"/>'
  }
  if (typeof sound === 'string') {
    if (sound.startsWith('ms-winsoundevent:')) {
      return `<audio src="${escapeXml(sound)}"/>`
    }
    if (sound === 'attention') {
      return '<audio src="ms-winsoundevent:Notification.SMS"/>'
    }
    if (sound === 'error') {
      return '<audio src="ms-winsoundevent:Notification.Reminder"/>'
    }
    return '<audio src="ms-winsoundevent:Notification.Default"/>'
  }
  return ''
}

function windowsTextNodes(title: string, body: string): string {
  const bodyLines = body
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)

  const lines = bodyLines.length ? bodyLines : [body]
  return `<text>${escapeXml(title)}</text>${lines
    .map((line) => `<text>${escapeXml(line)}</text>`)
    .join('')}`
}

export function macSoundName(
  event: NotifyEventType,
  sound: boolean | string,
): string {
  if (sound === true) {
    if (event === 'error') return 'Basso'
    if (event === 'attention') return 'Glass'
    return 'Funk'
  }
  if (typeof sound === 'string') {
    if (sound === 'attention') return 'Glass'
    if (sound === 'error') return 'Basso'
    return sound
  }
  return ''
}

async function notifyWindows(
  state: BackendState,
  title: string,
  body: string,
  sound: boolean | string,
  group: string,
): Promise<boolean> {
  const now = Date.now()
  if (now < state.windowsNotifyDisabledUntil) return false

  // Do not bind to an app that would spawn a new window on click.
  // Explorer is always running and generally results in a no-op activation.
  // Keep this list hardcoded. If made user-configurable, PowerShell escaping
  // must be revisited (newlines and other edge cases become injection risks).
  const notifierAppIds = ['Microsoft.Windows.Explorer']

  const toastGroup = 'opencode-notify'
  // Tag length limits vary across Windows versions; 16 chars is the safest.
  const toastTag = hashHex(group, 16)
  // Use background activation to avoid launching a new app window when the user clicks.
  const xml = `<toast activationType="background"><visual><binding template="ToastGeneric">${windowsTextNodes(
    title,
    body,
  )}</binding></visual>${windowsAudioNode(sound)}</toast>`
  const encoded = Buffer.from(xml, 'utf8').toString('base64')
  const appIds = notifierAppIds
    .map((id) => `'${id.replace(/'/g, "''")}'`)
    .join(', ')

  const script = [
    "$bytes = [Convert]::FromBase64String('" + encoded + "')",
    '$xmlString = [Text.Encoding]::UTF8.GetString($bytes)',
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] > $null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$xml.LoadXml($xmlString)',
    '$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
    `$toast.Tag = '${toastTag}'`,
    `$toast.Group = '${toastGroup}'`,
    `$appIds = @(${appIds})`,
    '$shown = $false',
    // Some AUMIDs throw but still post the toast; treat "posted" errors as success.
    'foreach ($appId in $appIds) { if ($shown) { break }; try { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast); $shown = $true } catch { $msg = $_.Exception.Message; if ($msg -match "posted" -or $msg -match "publish" -or $msg -match "发布") { $shown = $true } } }',
    'if (-not $shown) { try { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier().Show($toast); $shown = $true } catch {} }',
    "if (-not $shown) { throw 'ToastNotificationManager failed to show toast' }",
  ].join('; ')

  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]
  const primary = state.windowsPreferredShell || 'pwsh'
  const secondary = primary === 'pwsh' ? 'powershell' : 'pwsh'
  const shells: Array<'pwsh' | 'powershell'> = [primary, secondary]

  let ok = false
  for (const shell of shells) {
    ok = await run(shell, args, { timeoutMs: 8_000 })
    if (ok) {
      state.windowsPreferredShell = shell
      break
    }
  }

  if (ok) {
    state.windowsNotifyFailures = 0
    state.windowsNotifyDisabledUntil = 0
  } else {
    state.windowsNotifyFailures += 1
    state.windowsNotifyDisabledUntil =
      now + backendBackoffMs(state.windowsNotifyFailures)
  }
  return ok
}

async function notifyMac(
  state: BackendState,
  title: string,
  body: string,
  event: NotifyEventType,
  sound: boolean | string,
  group: string,
): Promise<boolean> {
  const now = Date.now()
  if (now < state.macNotifyDisabledUntil) return false

  const mapped = macSoundName(event, sound)

  const notifierArgs = ['-title', title, '-message', body, '-group', group]
  if (sound !== false) notifierArgs.push('-sound', mapped || 'default')
  // No click handler (no-op on click).

  let ok = await run('terminal-notifier', notifierArgs, { timeoutMs: 8000 })

  const script = [
    'set t to ""',
    'set b to ""',
    'set s to ""',
    'try',
    '  set t to system attribute "OC_NOTIFY_TITLE"',
    'end try',
    'try',
    '  set b to system attribute "OC_NOTIFY_BODY"',
    'end try',
    'try',
    '  set s to system attribute "OC_NOTIFY_SOUND"',
    'end try',
    'if s is not "" then',
    '  display notification b with title t sound name s',
    'else',
    '  display notification b with title t',
    'end if',
  ].join('\n')

  if (!ok) {
    ok = await run('osascript', ['-e', script], {
      timeoutMs: 8000,
      env: {
        OC_NOTIFY_TITLE: title,
        OC_NOTIFY_BODY: body,
        OC_NOTIFY_SOUND: sound === false ? '' : mapped,
      },
    })
  }

  if (ok) {
    state.macNotifyFailures = 0
    state.macNotifyDisabledUntil = 0
  } else {
    state.macNotifyFailures += 1
    state.macNotifyDisabledUntil =
      now + backendBackoffMs(state.macNotifyFailures)
  }
  return ok
}

async function notifyLinux(
  state: BackendState,
  title: string,
  body: string,
  event: NotifyEventType,
  sound: boolean | string,
  group: string,
): Promise<boolean> {
  const now = Date.now()
  const urgency =
    event === 'error' ? 'critical' : event === 'attention' ? 'normal' : 'low'
  const timeoutMs =
    event === 'error' ? 12_000 : event === 'attention' ? 10_000 : 4_000
  const replaceId = fnv1a32(group) & 0x7fffffff || 1

  const safeTitle = escapePango(title)
  const safeBody = escapePango(body)

  const args = [
    '-a',
    'opencode',
    '-u',
    urgency,
    '-t',
    String(timeoutMs),
    `--replace-id=${replaceId}`,
    '-h',
    `string:x-canonical-private-synchronous:opencode-${replaceId}`,
    '-h',
    `string:x-dunst-stack-tag:opencode-${replaceId}`,
    safeTitle,
    safeBody,
  ]

  // Some notify-send builds only support a subset of replacement flags.
  const shortArgs = [...args]
  const replaceIdx = shortArgs.findIndex((x) => x.startsWith('--replace-id='))
  if (replaceIdx >= 0) shortArgs.splice(replaceIdx, 1, '-r', String(replaceId))
  const plainArgs = [
    '-a',
    'opencode',
    '-u',
    urgency,
    '-t',
    String(timeoutMs),
    safeTitle,
    safeBody,
  ]

  const modeArgs = {
    long: args,
    short: shortArgs,
    plain: plainArgs,
  }

  const fallbackModes: Array<'long' | 'short' | 'plain'> = [
    'long',
    'short',
    'plain',
  ]
  const modes =
    state.linuxNotifySendMode === 'auto'
      ? fallbackModes
      : [
          state.linuxNotifySendMode,
          ...fallbackModes.filter((m) => m !== state.linuxNotifySendMode),
        ]

  const notifySendTimeoutMs = 2500
  let ok = false
  if (now >= state.linuxNotifySendDisabledUntil) {
    for (const mode of modes) {
      ok = await run('notify-send', modeArgs[mode], {
        timeoutMs: notifySendTimeoutMs,
      })
      if (ok) {
        state.linuxNotifySendMode = mode
        break
      }
    }

    if (ok) {
      state.linuxNotifySendFailures = 0
      state.linuxNotifySendDisabledUntil = 0
    } else {
      state.linuxNotifySendFailures += 1
      state.linuxNotifySendDisabledUntil =
        now + backendBackoffMs(state.linuxNotifySendFailures)
    }
  }

  if (!ok || sound === false) return ok
  const soundId =
    typeof sound === 'string' && sound !== 'attention' && sound !== 'error'
      ? stripControlChars(sound).slice(0, 200) || 'message-new-instant'
      : event === 'error'
        ? 'dialog-error'
        : event === 'attention'
          ? 'dialog-warning'
          : 'message-new-instant'

  if (now < state.linuxCanberraDisabledUntil) return ok
  if (state.linuxCanberraInFlight) {
    debugWarn(
      'Skipping canberra-gtk-play because a previous sound is in flight',
    )
    return ok
  }

  state.linuxCanberraInFlight = true
  void run('canberra-gtk-play', ['-i', soundId], { timeoutMs: 2000 })
    .then((played) => {
      if (played) {
        state.linuxCanberraFailures = 0
        state.linuxCanberraDisabledUntil = 0
        return
      }
      state.linuxCanberraFailures += 1
      state.linuxCanberraDisabledUntil =
        Date.now() + backendBackoffMs(state.linuxCanberraFailures)
    })
    .catch((error) => {
      debugWarn(
        `canberra-gtk-play failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    })
    .finally(() => {
      state.linuxCanberraInFlight = false
    })
  return ok
}

export function createNativeNotifier() {
  const state = createBackendState()

  return async function notifyNativeFallback(input: {
    title: string
    body: string
    event: NotifyEventType
    sound: NotifySound
    group?: string
  }): Promise<boolean> {
    const sound = normalizeSound(input.event, input.sound)
    const groupValue =
      typeof input.group === 'string' ? stripControlChars(input.group) : ''
    const group = groupValue ? groupValue.slice(0, 200) : 'opencode-notify'

    if (process.platform === 'win32') {
      return notifyWindows(state, input.title, input.body, sound, group)
    }
    if (process.platform === 'darwin') {
      return notifyMac(
        state,
        input.title,
        input.body,
        input.event,
        sound,
        group,
      )
    }
    if (process.platform === 'linux') {
      return notifyLinux(
        state,
        input.title,
        input.body,
        input.event,
        sound,
        group,
      )
    }
    return false
  }
}
