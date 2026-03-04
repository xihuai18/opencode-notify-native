import type { ClassifiedEvent } from './types.js'
import { fnv1a32 } from './hash.js'
import { isRecord } from './guards.js'
import { summarizeError } from './text.js'

type RawEvent = {
  type: string
  properties?: unknown
}

const RECENT_SIGNAL_CACHE_TTL_MS = 60_000
const ABORT_IDLE_SUPPRESS_MS = 10_000
const ERROR_IDLE_SUPPRESS_MS = 5_000
const GLOBAL_SESSION_KEY = 'global'

const TERMINAL_UPDATE_STATES = new Set([
  'approved',
  'denied',
  'rejected',
  'allowed',
  'granted',
  'blocked',
  'cancelled',
  'canceled',
  'aborted',
  'interrupted',
  'resolved',
  'completed',
  'done',
  'answered',
  'closed',
])

const INTERRUPT_REASONS = new Set([
  'interrupt',
  'interrupted',
  'cancel',
  'cancelled',
  'canceled',
  'abort',
  'aborted',
])

function hasTerminalText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasTerminalFlag(value: unknown): boolean {
  return value === true || hasTerminalText(value)
}

function hasTerminalQuestionAnswer(value: unknown): boolean {
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (hasTerminalText(value)) return true
  return false
}

function isTerminalState(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const token = value.trim().toLowerCase()
  if (!token) return false
  return TERMINAL_UPDATE_STATES.has(token)
}

function isInterruptReason(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const token = value.trim().toLowerCase()
  if (!token) return false
  return INTERRUPT_REASONS.has(token)
}

function hasTerminalUpdateState(properties: Record<string, unknown>): boolean {
  if (
    properties.resolved === true ||
    properties.completed === true ||
    properties.done === true ||
    properties.closed === true
  ) {
    return true
  }
  return isTerminalState(properties.status) || isTerminalState(properties.state)
}

function isAbortLikeError(error: unknown): boolean {
  if (!isRecord(error)) return false

  const rawName = typeof error.name === 'string' ? error.name.trim() : ''
  const name = rawName.toLowerCase()
  if (name === 'messageabortederror') return true
  if (name === 'aborterror') return true
  if (name.includes('cancel') || name.includes('interrupt')) return true
  if (name.includes('abort') && name.includes('user')) return true

  const rawCode = typeof error.code === 'string' ? error.code.trim() : ''
  const code = rawCode.toLowerCase()
  if (code.includes('cancel') || code.includes('interrupt')) return true
  if (code.includes('abort') && code.includes('user')) return true

  if (
    error.cancelled === true ||
    error.canceled === true ||
    error.interrupted === true ||
    error.abortedByUser === true ||
    error.cancelledByUser === true ||
    error.canceledByUser === true ||
    error.interruptedByUser === true
  ) {
    return true
  }

  const message =
    typeof error.message === 'string' ? error.message.trim().toLowerCase() : ''
  if (!message) return false
  if (message.includes('user cancelled')) return true
  if (message.includes('user canceled')) return true
  if (message.includes('user interrupted')) return true
  if (message.includes('interrupted by user')) return true
  if (message.includes('aborted by user')) return true
  return false
}

function sessionCacheKey(sessionID: string | undefined): string {
  return sessionID || GLOBAL_SESSION_KEY
}

function makeKey(kind: ClassifiedEvent['event'], sessionID?: string): string {
  return `${kind}:${sessionCacheKey(sessionID)}`
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

export function createEventClassifier(): (
  event: unknown,
) => ClassifiedEvent | null {
  // Per-plugin-instance cache to suppress double-notify when both
  // `session.status` (idle) and legacy `session.idle` fire.
  const recentIdleStatusBySession = new Map<string, number>()
  const recentAbortBySession = new Map<string, number>()
  const recentErrorBySession = new Map<string, number>()
  const sessionTitleBySession = new Map<string, string>()
  const sessionSeenAt = new Map<string, number>()
  // Track subagent sessions (child sessions) so we do not notify for their
  // lifecycle events in the main channel.
  const subagentSessions = new Set<string>()

  function evictSession(sessionID: string): void {
    recentIdleStatusBySession.delete(sessionID)
    recentAbortBySession.delete(sessionID)
    recentErrorBySession.delete(sessionID)
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

  function rememberRecentSignal(
    cache: Map<string, number>,
    sessionID: string | undefined,
  ): void {
    const now = Date.now()
    cache.set(sessionCacheKey(sessionID), now)
    if (cache.size < 200) return
    for (const [key, ts] of cache) {
      if (now - ts > RECENT_SIGNAL_CACHE_TTL_MS) cache.delete(key)
    }
  }

  function sawRecentSignal(
    cache: Map<string, number>,
    sessionID: string | undefined,
    withinMs: number,
  ): boolean {
    const ts = cache.get(sessionCacheKey(sessionID))
    if (!ts) return false
    return Date.now() - ts < withinMs
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
    if (!info || typeof info.id !== 'string') return
    touchSession(info.id)

    if (event.type === 'session.deleted') {
      evictSession(info.id)
      return
    }

    const parentID =
      typeof info.parentID === 'string' ? info.parentID.trim() : ''
    if (parentID) subagentSessions.add(info.id)
    else subagentSessions.delete(info.id)

    if (typeof info.title === 'string') {
      const title = info.title.trim()
      if (title) sessionTitleBySession.set(info.id, title)
      else sessionTitleBySession.delete(info.id)
    }
  }

  function classifySessionStatus(event: RawEvent): ClassifiedEvent | null {
    if (event.type !== 'session.status') return null
    if (!isRecord(event.properties)) return null
    const status = isRecord(event.properties.status)
      ? event.properties.status
      : null
    if (!status || status.type !== 'idle') return null
    if (
      isInterruptReason(status.reason) ||
      status.cancelled === true ||
      status.canceled === true ||
      status.aborted === true ||
      status.interrupted === true
    ) {
      return null
    }
    const sessionID =
      typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : undefined
    touchSession(sessionID)
    if (isSubagentSession(sessionID)) return null
    if (
      sawRecentSignal(recentAbortBySession, sessionID, ABORT_IDLE_SUPPRESS_MS)
    )
      return null
    if (
      sawRecentSignal(recentErrorBySession, sessionID, ERROR_IDLE_SUPPRESS_MS)
    )
      return null

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
    const sessionID =
      typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : undefined
    touchSession(sessionID)
    if (isSubagentSession(sessionID)) return null
    if (
      sawRecentSignal(recentAbortBySession, sessionID, ABORT_IDLE_SUPPRESS_MS)
    )
      return null
    if (
      sawRecentSignal(recentErrorBySession, sessionID, ERROR_IDLE_SUPPRESS_MS)
    )
      return null
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
    const sessionID =
      typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : undefined
    touchSession(sessionID)
    if (isSubagentSession(sessionID)) return null
    if (isAbortLikeError(event.properties.error)) {
      rememberRecentSignal(recentAbortBySession, sessionID)
      return null
    }
    rememberRecentSignal(recentErrorBySession, sessionID)
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
    const hasTerminalResponse = hasTerminalFlag(event.properties.response)
    const hasTerminalReply = hasTerminalFlag(event.properties.reply)
    const hasTerminalDecision = hasTerminalFlag(event.properties.decision)
    const hasTerminalResult = hasTerminalFlag(event.properties.result)
    const hasTerminalState = hasTerminalUpdateState(event.properties)
    if (
      event.type === 'permission.updated' &&
      (hasTerminalResponse ||
        hasTerminalReply ||
        hasTerminalDecision ||
        hasTerminalResult ||
        hasTerminalState)
    ) {
      return null
    }

    const sessionID =
      typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : undefined
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
    if (event.type !== 'question.asked' && event.type !== 'question.updated')
      return null
    if (!isRecord(event.properties)) return null

    if (event.type === 'question.updated') {
      const hasAnswer = hasTerminalQuestionAnswer(event.properties.answer)
      const hasResponse = hasTerminalFlag(event.properties.response)
      const hasReply = hasTerminalFlag(event.properties.reply)
      const hasResult = hasTerminalFlag(event.properties.result)
      const hasResolvedState = hasTerminalUpdateState(event.properties)
      if (
        hasAnswer ||
        hasResponse ||
        hasReply ||
        hasResult ||
        hasResolvedState
      ) {
        return null
      }
    }

    const sessionID =
      typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : undefined
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
    if (raw.type === 'question.asked' || raw.type === 'question.updated') {
      return classifyQuestion(raw)
    }
    return null
  }
}
