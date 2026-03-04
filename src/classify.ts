import type { ClassifiedEvent } from './types.js'
import { fnv1a32 } from './hash.js'
import { isRecord } from './guards.js'
import { summarizeError } from './text.js'

type RawEvent = {
  type: string
  properties?: unknown
}

function makeKey(kind: ClassifiedEvent['event'], sessionID?: string): string {
  return `${kind}:${sessionID || 'global'}`
}

function attentionKey(
  sessionID: string | undefined,
  topic: string,
): { collapseKey: string; topicKey: string } {
  const base = makeKey('attention', sessionID)
  // Bound hashing work on untrusted payload text.
  const stableTopic =
    topic.length > 512 ? `${topic.slice(0, 512)}#${topic.length}` : topic
  const tagA = fnv1a32(stableTopic).toString(16).padStart(8, '0')
  const tagB = fnv1a32(`oc:${stableTopic}`).toString(16).padStart(8, '0')
  const tag = `${tagA}${tagB}`
  return { collapseKey: `${base}:${tag}`, topicKey: tag }
}

function firstString(
  input: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function readSessionID(properties: Record<string, unknown>): string | undefined {
  return firstString(properties, ['sessionID', 'sessionId'])
}

export function createEventClassifier(): (
  event: unknown,
) => ClassifiedEvent | null {
  // Per-plugin-instance cache to suppress double-notify when both
  // `session.status` (idle) and legacy `session.idle` fire.
  const recentIdleStatusBySession = new Map<string, number>()
  const sessionTitleBySession = new Map<string, string>()
  const sessionSeenAt = new Map<string, number>()
  // Track subagent sessions (child sessions) so we do not notify for their
  // lifecycle events in the main channel.
  const subagentSessions = new Set<string>()

  function evictSession(sessionID: string): void {
    recentIdleStatusBySession.delete(sessionID)
    sessionTitleBySession.delete(sessionID)
    subagentSessions.delete(sessionID)
    sessionSeenAt.delete(sessionID)
  }

  function pruneSessionCaches(now: number): void {
    if (sessionSeenAt.size < 600) return

    const staleCutoff = now - 6 * 60 * 60_000
    for (const [sessionID, ts] of sessionSeenAt) {
      if (ts < staleCutoff) evictSession(sessionID)
    }

    while (sessionSeenAt.size > 500) {
      const oldest = sessionSeenAt.keys().next().value
      if (typeof oldest !== 'string') break
      evictSession(oldest)
    }
  }

  function touchSession(sessionID: string | undefined): void {
    if (!sessionID) return
    const now = Date.now()
    if (sessionSeenAt.has(sessionID)) sessionSeenAt.delete(sessionID)
    sessionSeenAt.set(sessionID, now)
    pruneSessionCaches(now)
  }

  function rememberIdleStatus(sessionID: string | undefined): void {
    if (!sessionID) return
    const now = Date.now()
    recentIdleStatusBySession.set(sessionID, now)
    if (recentIdleStatusBySession.size < 200) return
    // Map iteration remains stable while deleting the current key.
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

  function isSubagentSession(sessionID: string | undefined): boolean {
    if (!sessionID) return false
    return subagentSessions.has(sessionID)
  }

  function getSessionTitle(sessionID: string | undefined): string | undefined {
    if (!sessionID) return undefined
    return sessionTitleBySession.get(sessionID)
  }

  function updateSessionLineage(event: RawEvent): void {
    if (
      event.type !== 'session.created' &&
      event.type !== 'session.updated' &&
      event.type !== 'session.deleted'
    ) {
      return
    }
    if (!isRecord(event.properties)) return

    const info = isRecord(event.properties.info) ? event.properties.info : null
    if (!info) return

    const sessionID = firstString(info, ['id', 'sessionID', 'sessionId'])
    if (!sessionID) return
    touchSession(sessionID)

    if (event.type === 'session.deleted') {
      evictSession(sessionID)
      return
    }

    const parentID = firstString(info, ['parentID', 'parentId'])?.trim() || ''
    if (parentID) subagentSessions.add(sessionID)
    else subagentSessions.delete(sessionID)

    if (typeof info.title === 'string') {
      const title = info.title.trim()
      if (title) sessionTitleBySession.set(sessionID, title)
      else sessionTitleBySession.delete(sessionID)
    }
  }

  function classifySessionStatus(event: RawEvent): ClassifiedEvent | null {
    if (event.type !== 'session.status') return null
    if (!isRecord(event.properties)) return null
    const status = isRecord(event.properties.status)
      ? event.properties.status
      : null
    if (!status || status.type !== 'idle') return null
    const sessionID = readSessionID(event.properties)
    touchSession(sessionID)
    if (isSubagentSession(sessionID)) return null

    rememberIdleStatus(sessionID)
    return {
      event: 'complete',
      source: event.type,
      summary: 'Task completed',
      sessionID,
      sessionTitle: getSessionTitle(sessionID),
      collapseKey: makeKey('complete', sessionID),
    }
  }

  function classifySessionIdle(event: RawEvent): ClassifiedEvent | null {
    if (event.type !== 'session.idle') return null
    if (!isRecord(event.properties)) return null
    const sessionID = readSessionID(event.properties)
    touchSession(sessionID)
    if (isSubagentSession(sessionID)) return null
    if (recentlySawIdleStatus(sessionID)) return null
    return {
      event: 'complete',
      source: event.type,
      summary: 'Task completed',
      sessionID,
      sessionTitle: getSessionTitle(sessionID),
      collapseKey: makeKey('complete', sessionID),
    }
  }

  function classifySessionError(event: RawEvent): ClassifiedEvent | null {
    if (event.type !== 'session.error') return null
    if (!isRecord(event.properties)) return null
    const name =
      typeof event.properties.error === 'object' &&
      event.properties.error &&
      'name' in event.properties.error
        ? String(event.properties.error.name)
        : ''
    if (name === 'MessageAbortedError') return null

    const sessionID = readSessionID(event.properties)
    touchSession(sessionID)
    if (isSubagentSession(sessionID)) return null
    return {
      event: 'error',
      source: event.type,
      summary: summarizeError(event.properties.error),
      sessionID,
      sessionTitle: getSessionTitle(sessionID),
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

    // Legacy streams may reuse `permission.updated` for post-reply updates.
    // Those are not actionable prompts and should not notify.
    const hasTerminalResponse =
      event.properties.response === true ||
      (typeof event.properties.response === 'string' &&
        event.properties.response.trim().length > 0)
    const hasTerminalReply =
      event.properties.reply === true ||
      (typeof event.properties.reply === 'string' &&
        event.properties.reply.trim().length > 0)
    if (
      event.type === 'permission.updated' &&
      (hasTerminalResponse || hasTerminalReply)
    ) {
      return null
    }

    const sessionID = readSessionID(event.properties)
    touchSession(sessionID)
    if (isSubagentSession(sessionID)) return null

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

    const { collapseKey, topicKey } = attentionKey(
      sessionID,
      `${event.type}:${permission}:${firstPattern || ''}`,
    )
    return {
      event: 'attention',
      source: event.type,
      summary: `Permission required: ${permission}${suffix}`,
      sessionID,
      sessionTitle: getSessionTitle(sessionID),
      collapseKey,
      topicKey,
    }
  }

  function classifyQuestion(event: RawEvent): ClassifiedEvent | null {
    if (event.type !== 'question.asked') return null
    if (!isRecord(event.properties)) return null

    const sessionID = readSessionID(event.properties)
    touchSession(sessionID)
    if (isSubagentSession(sessionID)) return null
    const firstQuestion = Array.isArray(event.properties.questions)
      ? event.properties.questions[0]
      : undefined

    const header =
      isRecord(firstQuestion) && typeof firstQuestion.header === 'string'
        ? firstQuestion.header
        : isRecord(firstQuestion) && typeof firstQuestion.question === 'string'
          ? firstQuestion.question
          : 'Input required'

    const { collapseKey, topicKey } = attentionKey(
      sessionID,
      `${event.type}:${header}`,
    )
    return {
      event: 'attention',
      source: event.type,
      summary: `Input required: ${header}`,
      sessionID,
      sessionTitle: getSessionTitle(sessionID),
      collapseKey,
      topicKey,
    }
  }

  return (event: unknown): ClassifiedEvent | null => {
    if (!isRecord(event) || typeof event.type !== 'string') return null
    const raw = event as RawEvent

    updateSessionLineage(raw)

    if (raw.type === 'session.idle') return classifySessionIdle(raw)
    if (raw.type === 'session.status') return classifySessionStatus(raw)
    if (raw.type === 'session.error') return classifySessionError(raw)

    if (raw.type === 'permission.asked' || raw.type === 'permission.updated') {
      return classifyPermission(raw)
    }
    if (raw.type === 'question.asked') {
      return classifyQuestion(raw)
    }
    return null
  }
}
