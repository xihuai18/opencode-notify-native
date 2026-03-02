import type { Event } from '@opencode-ai/sdk'

import type { ClassifiedEvent } from './types.js'
import { summarizeError } from './text.js'

type RawEvent = {
  type: string
  properties?: unknown
}

function makeKey(kind: ClassifiedEvent['event'], sessionID?: string): string {
  return `${kind}:${sessionID || 'global'}`
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

export function createEventClassifier(): (
  event: Event,
) => ClassifiedEvent | null {
  // Per-plugin-instance cache to suppress double-notify when both
  // `session.status` (idle) and legacy `session.idle` fire.
  const recentIdleStatusBySession = new Map<string, number>()

  function rememberIdleStatus(sessionID: string | undefined): void {
    if (!sessionID) return
    const now = Date.now()
    recentIdleStatusBySession.set(sessionID, now)
    if (recentIdleStatusBySession.size < 200) return
    for (const [key, ts] of recentIdleStatusBySession) {
      if (now - ts > 60_000) recentIdleStatusBySession.delete(key)
    }
  }

  function recentlySawIdleStatus(sessionID: string | undefined): boolean {
    if (!sessionID) return false
    const ts = recentIdleStatusBySession.get(sessionID)
    if (!ts) return false
    return Date.now() - ts < 5_000
  }

  function classifySessionStatus(event: Event): ClassifiedEvent | null {
    if (event.type !== 'session.status') return null
    if (!isRecord(event.properties)) return null
    const status = isRecord(event.properties.status)
      ? event.properties.status
      : null
    if (!status || status.type !== 'idle') return null
    const sessionID =
      typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : undefined

    rememberIdleStatus(sessionID)
    return {
      event: 'complete',
      source: event.type,
      summary: 'Task completed',
      sessionID,
      collapseKey: makeKey('complete', sessionID),
    }
  }

  function classifySessionIdle(event: Event): ClassifiedEvent | null {
    if (event.type !== 'session.idle') return null
    if (!isRecord(event.properties)) return null
    const sessionID =
      typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : undefined
    if (recentlySawIdleStatus(sessionID)) return null
    return {
      event: 'complete',
      source: event.type,
      summary: 'Task completed',
      sessionID,
      collapseKey: makeKey('complete', sessionID),
    }
  }

  function classifySessionError(event: Event): ClassifiedEvent | null {
    if (event.type !== 'session.error') return null
    if (!isRecord(event.properties)) return null
    const name =
      typeof event.properties.error === 'object' &&
      event.properties.error &&
      'name' in event.properties.error
        ? String(event.properties.error.name)
        : ''
    if (name === 'MessageAbortedError') return null

    const sessionID =
      typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : undefined
    return {
      event: 'error',
      source: event.type,
      summary: summarizeError(event.properties.error),
      sessionID,
      collapseKey: makeKey('error', sessionID),
    }
  }

  function classifyPermission(event: RawEvent): ClassifiedEvent | null {
    if (
      event.type !== 'permission.asked' &&
      event.type !== 'permission.updated'
    )
      return null
    if (!isRecord(event.properties)) return null

    const sessionID =
      typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : undefined

    const firstPattern = (() => {
      const patterns = event.properties.patterns
      if (Array.isArray(patterns)) {
        const first = patterns[0]
        if (typeof first === 'string') return first
      }

      const pattern = event.properties.pattern
      if (typeof pattern === 'string') return pattern
      if (Array.isArray(pattern)) {
        const first = pattern[0]
        if (typeof first === 'string') return first
      }

      return undefined
    })()

    const suffix = firstPattern ? ` (${firstPattern})` : ''
    const permission = (() => {
      if (typeof event.properties.permission === 'string')
        return event.properties.permission
      if (typeof event.properties.type === 'string')
        return event.properties.type
      if (typeof event.properties.title === 'string')
        return event.properties.title
      if (typeof event.properties.message === 'string')
        return event.properties.message
      return 'action'
    })()

    return {
      event: 'attention',
      source: event.type,
      summary: `Permission required: ${permission}${suffix}`,
      sessionID,
      collapseKey: makeKey('attention', sessionID),
    }
  }

  function classifyQuestion(event: RawEvent): ClassifiedEvent | null {
    if (event.type !== 'question.asked') return null
    if (!isRecord(event.properties)) return null

    const sessionID =
      typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : undefined
    const firstQuestion = Array.isArray(event.properties.questions)
      ? event.properties.questions[0]
      : undefined

    const header =
      isRecord(firstQuestion) && typeof firstQuestion.header === 'string'
        ? firstQuestion.header
        : isRecord(firstQuestion) && typeof firstQuestion.question === 'string'
          ? firstQuestion.question
          : 'Input required'

    return {
      event: 'attention',
      source: event.type,
      summary: `Input required: ${header}`,
      sessionID,
      collapseKey: makeKey('attention', sessionID),
    }
  }

  return (event: Event): ClassifiedEvent | null => {
    const raw = event as unknown as RawEvent

    if (event.type === 'session.idle') return classifySessionIdle(event)
    if (event.type === 'session.status') return classifySessionStatus(event)
    if (event.type === 'session.error') return classifySessionError(event)

    if (raw.type === 'permission.asked' || raw.type === 'permission.updated') {
      return classifyPermission(raw)
    }
    if (raw.type === 'question.asked') {
      return classifyQuestion(raw)
    }
    return null
  }
}
