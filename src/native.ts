import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

import type { NotifyEventType, NotifySound } from './types.js'

export function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
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

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function run(
  command: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    })

    let done = false
    const timer =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? setTimeout(() => {
            if (done) return
            done = true
            child.kill()
            resolve(false)
          }, options.timeoutMs)
        : undefined

    child.on('error', () => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

function normalizeSound(
  event: NotifyEventType,
  sound: NotifySound,
): boolean | string {
  if (typeof sound === 'boolean') return sound
  if (typeof sound === 'string') return sound
  if (event === 'complete') return true
  if (event === 'error') return 'error'
  return 'attention'
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
  title: string,
  body: string,
  sound: boolean | string,
  group: string,
): Promise<void> {
  // Do not bind to an app that would spawn a new window on click.
  // Explorer is always running and generally results in a no-op activation.
  const notifierAppIds = ['Microsoft.Windows.Explorer']

  const toastGroup = 'opencode-notify'
  // Tag length limits vary across Windows versions; 16 chars is the safest.
  const toastTag = hashHex(group, 16)
  // Use background activation to avoid launching a new app window when the user clicks.
  const xml = `<toast activationType="background"><visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual>${windowsAudioNode(sound)}</toast>`
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
  const ok = await run('pwsh', args, { timeoutMs: 12000 })
  if (ok) return
  await run('powershell', args, { timeoutMs: 15000 })
}

async function notifyMac(
  title: string,
  body: string,
  event: NotifyEventType,
  sound: boolean | string,
  group: string,
): Promise<void> {
  const mapped = macSoundName(event, sound)

  const notifierArgs = ['-title', title, '-message', body, '-group', group]
  if (sound !== false) notifierArgs.push('-sound', mapped || 'default')
  // No click handler (no-op on click).

  const ok = await run('terminal-notifier', notifierArgs, { timeoutMs: 8000 })
  if (ok) return

  const script =
    'set t to "" ; set b to "" ; set s to "" ; ' +
    'try ; set t to system attribute "OC_NOTIFY_TITLE" ; end try ; ' +
    'try ; set b to system attribute "OC_NOTIFY_BODY" ; end try ; ' +
    'try ; set s to system attribute "OC_NOTIFY_SOUND" ; end try ; ' +
    'if s is not "" then display notification b with title t sound name s else display notification b with title t end if'

  await run('osascript', ['-e', script], {
    timeoutMs: 8000,
    env: {
      OC_NOTIFY_TITLE: title,
      OC_NOTIFY_BODY: body,
      OC_NOTIFY_SOUND: sound === false ? '' : mapped,
    },
  })
}

async function notifyLinux(
  title: string,
  body: string,
  event: NotifyEventType,
  sound: boolean | string,
  group: string,
): Promise<void> {
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
  let ok = await run('notify-send', args, { timeoutMs: 8000 })
  if (!ok) {
    // Some notify-send builds only support the short -r flag.
    const shortArgs = [...args]
    const idx = shortArgs.findIndex((x) => x.startsWith('--replace-id='))
    if (idx >= 0) shortArgs.splice(idx, 1, '-r', String(replaceId))
    ok = await run('notify-send', shortArgs, { timeoutMs: 8000 })
  }
  if (!ok) {
    await run(
      'notify-send',
      [
        '-a',
        'opencode',
        '-u',
        urgency,
        '-t',
        String(timeoutMs),
        safeTitle,
        safeBody,
      ],
      { timeoutMs: 8000 },
    )
  }

  if (sound === false) return
  const soundId =
    typeof sound === 'string' && sound !== 'attention' && sound !== 'error'
      ? sound
      : event === 'error'
        ? 'dialog-error'
        : event === 'attention'
          ? 'dialog-warning'
          : 'message-new-instant'
  void run('canberra-gtk-play', ['-i', soundId], { timeoutMs: 2000 })
}

export async function notifyNativeFallback(input: {
  title: string
  body: string
  event: NotifyEventType
  sound: NotifySound
  group?: string
}): Promise<void> {
  const sound = normalizeSound(input.event, input.sound)
  const group = input.group?.trim()
    ? input.group.trim().slice(0, 200)
    : 'opencode-notify'

  if (process.platform === 'win32') {
    await notifyWindows(input.title, input.body, sound, group)
    return
  }
  if (process.platform === 'darwin') {
    await notifyMac(input.title, input.body, input.event, sound, group)
    return
  }
  if (process.platform === 'linux') {
    await notifyLinux(input.title, input.body, input.event, sound, group)
  }
}
