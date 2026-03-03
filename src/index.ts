import type { Hooks, PluginInput } from '@opencode-ai/plugin'
import type { NotifyEventType } from './types.js'

import { loadPluginConfig } from './config.js'
import { createEventClassifier } from './classify.js'
import { NotifyDispatcher } from './dispatcher.js'
import {
  firstLine,
  formatCollapsedBody,
  sanitizeText,
  shortPath,
  toProjectName,
} from './text.js'
import { notifyNativeFallback } from './native.js'

function labelForEvent(event: NotifyEventType): string {
  if (event === 'complete') return 'Complete'
  if (event === 'error') return 'Error'
  return 'Attention'
}

function eventEnabled(
  event: NotifyEventType,
  config: Awaited<ReturnType<typeof loadPluginConfig>>,
): boolean {
  if (!config.enabled) return false
  if (event === 'complete') return config.events.complete
  if (event === 'error') return config.events.error
  return config.events.attention
}

function eventSound(
  event: NotifyEventType,
  config: Awaited<ReturnType<typeof loadPluginConfig>>,
) {
  if (event === 'complete') return config.soundByEvent.complete
  if (event === 'error') return config.soundByEvent.error
  return config.soundByEvent.attention
}

function makeBody(input: {
  sessionID?: string
  event: NotifyEventType
  summary: string
  directory: string
  showDirectory: boolean
  showSessionId: boolean
}): string {
  const lines: string[] = []
  const headline = `${labelForEvent(input.event)}: ${input.summary}`.trim()
  lines.push(headline)

  if (input.showDirectory) {
    lines.push(`Dir: ${input.directory}`)
  }
  if (input.showSessionId && input.sessionID) {
    lines.push(`Session: ${input.sessionID.slice(0, 8)}`)
  }

  return lines.join('\n')
}

export default async function OpenCodeNotifyPlugin(
  input: PluginInput,
): Promise<Hooks> {
  const config = await loadPluginConfig(input.worktree, input.directory)
  const project = sanitizeText(toProjectName(input.worktree, input.directory), {
    enabled: config.sanitize,
    maxLength: 60,
  })
  const classifyEvent = createEventClassifier()

  const dispatcher = new NotifyDispatcher({
    collapseWindowMs: config.collapseWindowMs,
    cooldownMs: config.cooldownMs,
    send: async (payload, count) => {
      const title = sanitizeText(payload.title, {
        enabled: config.sanitize,
        // Title limits vary by platform; keep it short and predictable.
        maxLength: 120,
      })
      const body = formatCollapsedBody(payload.body, count, {
        enabled: config.sanitize,
        maxLength: config.maxBodyLength,
      })
      await notifyNativeFallback({
        title,
        body,
        event: payload.event,
        sound: payload.sound,
        group: payload.replaceKey,
      })
    },
  })

  const notify = (inputEvent: {
    event: NotifyEventType
    source: string
    summary: string
    sessionID?: string
    collapseKey: string
  }) => {
    if (!eventEnabled(inputEvent.event, config)) return

    const summary = firstLine(inputEvent.summary)

    const replaceKey = `opencode:${project}:${inputEvent.event}:${inputEvent.sessionID || 'global'}`

    const body = makeBody({
      sessionID: inputEvent.sessionID,
      event: inputEvent.event,
      summary,
      directory: shortPath(input.directory),
      showDirectory: config.showDirectory,
      showSessionId: config.showSessionId,
    })

    dispatcher.enqueue({
      event: inputEvent.event,
      title: `OpenCode · ${project}`,
      body,
      sound: eventSound(inputEvent.event, config),
      collapseKey: inputEvent.collapseKey,
      replaceKey,
    })
  }

  const hooks: Hooks = {
    event: async ({ event }) => {
      try {
        const classified = classifyEvent(event)
        if (!classified) return
        notify(classified)
      } catch {
        // Notification side effects should never block OpenCode flows.
      }
    },
  }

  return hooks
}
