import assert from 'node:assert/strict'
import test from 'node:test'

import { createEventClassifier } from '../classify.js'

function markSessionBusy(
  classifyEvent: ReturnType<typeof createEventClassifier>,
  sessionID: string,
  alias = false,
): void {
  const properties = alias
    ? { sessionId: sessionID, status: { type: 'busy' } }
    : { sessionID, status: { type: 'busy' } }
  const classified = classifyEvent({
    type: 'session.status',
    properties,
  } as any)
  assert.equal(classified, null)
}

test('classify complete from session.status idle', () => {
  const classifyEvent = createEventClassifier()
  markSessionBusy(classifyEvent, 'ses_1')
  const event = {
    type: 'session.status',
    properties: {
      sessionID: 'ses_1',
      status: { type: 'idle' },
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, 'complete')
  assert.equal(classified?.collapseKey, 'complete:ses_1')
})

test('classify complete from session.status idle with sessionId alias', () => {
  const classifyEvent = createEventClassifier()
  markSessionBusy(classifyEvent, 'ses_alias', true)
  const event = {
    type: 'session.status',
    properties: {
      sessionId: 'ses_alias',
      status: { type: 'idle' },
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, 'complete')
  assert.equal(classified?.collapseKey, 'complete:ses_alias')
})

test('classify attaches session title when known', () => {
  const classifyEvent = createEventClassifier()

  assert.equal(
    classifyEvent({
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_title_known',
          title: 'Known Session',
        },
      },
    } as any),
    null,
  )

  markSessionBusy(classifyEvent, 'ses_title_known')

  const classified = classifyEvent({
    type: 'session.status',
    properties: {
      sessionID: 'ses_title_known',
      status: { type: 'idle' },
    },
  } as any)

  assert.ok(classified)
  assert.equal(classified?.sessionTitle, 'Known Session')
})

test('session title cache clears when title is updated to blank', () => {
  const classifyEvent = createEventClassifier()

  assert.equal(
    classifyEvent({
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_title_clear',
          title: 'Temporary Title',
        },
      },
    } as any),
    null,
  )

  assert.equal(
    classifyEvent({
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_title_clear',
          title: '   ',
        },
      },
    } as any),
    null,
  )

  markSessionBusy(classifyEvent, 'ses_title_clear')

  const classified = classifyEvent({
    type: 'session.status',
    properties: {
      sessionID: 'ses_title_clear',
      status: { type: 'idle' },
    },
  } as any)

  assert.ok(classified)
  assert.equal(classified?.sessionTitle, undefined)
})

test('suppress legacy session.idle when status idle seen', () => {
  const classifyEvent = createEventClassifier()
  markSessionBusy(classifyEvent, 'ses_dupe')
  const status = {
    type: 'session.status',
    properties: {
      sessionID: 'ses_dupe',
      status: { type: 'idle' },
    },
  } as any
  const idle = {
    type: 'session.idle',
    properties: {
      sessionID: 'ses_dupe',
    },
  } as any

  assert.ok(classifyEvent(status))
  assert.equal(classifyEvent(idle), null)
})

test('classify complete from legacy session.idle', () => {
  const classifyEvent = createEventClassifier()
  markSessionBusy(classifyEvent, 'ses_legacy')
  const event = {
    type: 'session.idle',
    properties: {
      sessionID: 'ses_legacy',
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, 'complete')
})

test('do not classify idle without recent active status', () => {
  const classifyEvent = createEventClassifier()
  const classified = classifyEvent({
    type: 'session.status',
    properties: {
      sessionID: 'ses_no_active',
      status: { type: 'idle' },
    },
  } as any)

  assert.equal(classified, null)
})

test('ignore non-idle session.status values', () => {
  const classifyEvent = createEventClassifier()

  assert.equal(
    classifyEvent({
      type: 'session.status',
      properties: {
        sessionID: 'ses_status_busy',
        status: { type: 'busy' },
      },
    } as any),
    null,
  )

  assert.equal(
    classifyEvent({
      type: 'session.status',
      properties: {
        sessionID: 'ses_status_retry',
        status: {
          type: 'retry',
          attempt: 1,
          message: 'temporary failure',
          next: Date.now() + 1000,
        },
      },
    } as any),
    null,
  )

  const complete = classifyEvent({
    type: 'session.status',
    properties: {
      sessionID: 'ses_status_retry',
      status: { type: 'idle' },
    },
  } as any)

  assert.ok(complete)
  assert.equal(complete?.event, 'complete')
})

test('classify attention from permission.asked', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'permission.asked',
    properties: {
      sessionID: 'ses_2',
      permission: 'bash',
      patterns: ['git status'],
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, 'attention')
  assert.match(classified?.summary || '', /Permission required:/)
})

test('classify attention from permission.updated', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'permission.updated',
    properties: {
      sessionID: 'ses_legacy_perm',
      type: 'bash',
      pattern: 'git status',
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, 'attention')
  assert.match(classified?.summary || '', /\(git status\)/)
})

test('ignore permission.updated that already has a response', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'permission.updated',
    properties: {
      sessionID: 'ses_legacy_perm_done',
      type: 'bash',
      pattern: 'git status',
      response: 'approved',
    },
  } as any

  const classified = classifyEvent(event)
  assert.equal(classified, null)
})

test('do not ignore permission.updated for non-terminal response shapes', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'permission.updated',
    properties: {
      sessionID: 'ses_legacy_perm_done2',
      type: 'bash',
      pattern: 'git status',
      response: { value: 'approved' },
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, 'attention')
})

test('ignore permission.updated when reply contains terminal value', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'permission.updated',
    properties: {
      sessionID: 'ses_legacy_perm_done3',
      type: 'bash',
      pattern: 'git status',
      reply: 'always',
    },
  } as any

  const classified = classifyEvent(event)
  assert.equal(classified, null)
})

test('ignore permission.updated when status is resolved', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'permission.updated',
    properties: {
      sessionID: 'ses_legacy_perm_resolved',
      type: 'bash',
      pattern: 'git status',
      status: 'resolved',
    },
  } as any

  const classified = classifyEvent(event)
  assert.equal(classified, null)
})

test('do not ignore permission.updated when response is false', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'permission.updated',
    properties: {
      sessionID: 'ses_legacy_perm_pending',
      type: 'bash',
      pattern: 'git status',
      response: false,
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, 'attention')
})

test('do not ignore permission.updated when response is pending string', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'permission.updated',
    properties: {
      sessionID: 'ses_legacy_perm_pending_str',
      type: 'bash',
      pattern: 'git status',
      response: 'pending',
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, 'attention')
})

test('ignore permission.replied acknowledgement events', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'permission.replied',
    properties: {
      sessionID: 'ses_perm_reply',
      requestID: 'perm_1',
      reply: 'once',
    },
  } as any

  const classified = classifyEvent(event)
  assert.equal(classified, null)
})

test('classify attention from question.asked', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'question.asked',
    properties: {
      sessionID: 'ses_q',
      questions: [
        {
          header: 'Confirm action',
          question: 'Proceed?',
          options: [{ label: 'Yes', description: 'y' }],
        },
      ],
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, 'attention')
  assert.match(classified?.summary || '', /Confirm action/)
})

test('ignore question.updated legacy events', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'question.updated',
    properties: {
      sessionID: 'ses_q_updated',
      state: 'pending',
      questions: [{ header: 'Pick one option' }],
    },
  } as any

  const classified = classifyEvent(event)
  assert.equal(classified, null)
})

test('ignore question.replied and question.rejected acknowledgements', () => {
  const classifyEvent = createEventClassifier()

  assert.equal(
    classifyEvent({
      type: 'question.replied',
      properties: {
        sessionID: 'ses_q_done',
        requestID: 'q_1',
        answers: [['Yes']],
      },
    } as any),
    null,
  )

  assert.equal(
    classifyEvent({
      type: 'question.rejected',
      properties: {
        sessionID: 'ses_q_done',
        requestID: 'q_1',
      },
    } as any),
    null,
  )
})

test('attention collapseKey differs by prompt topic', () => {
  const classifyEvent = createEventClassifier()
  const a = {
    type: 'permission.asked',
    properties: {
      sessionID: 'ses_attn_keys',
      permission: 'bash',
      patterns: ['git status'],
    },
  } as any
  const b = {
    type: 'permission.asked',
    properties: {
      sessionID: 'ses_attn_keys',
      permission: 'bash',
      patterns: ['git diff'],
    },
  } as any

  const ca = classifyEvent(a)
  const cb = classifyEvent(b)
  assert.ok(ca)
  assert.ok(cb)
  assert.equal(ca?.event, 'attention')
  assert.equal(cb?.event, 'attention')
  assert.notEqual(ca?.collapseKey, cb?.collapseKey)

  const ca2 = classifyEvent(a)
  assert.ok(ca2)
  assert.equal(ca?.collapseKey, ca2?.collapseKey)
})

test('skip MessageAbortedError', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'session.error',
    properties: {
      sessionID: 'ses_3',
      error: {
        name: 'MessageAbortedError',
        data: { message: 'aborted' },
      },
    },
  } as any

  const classified = classifyEvent(event)
  assert.equal(classified, null)
})

test('skip AbortError', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'session.error',
    properties: {
      sessionID: 'ses_abort_std',
      error: {
        name: 'AbortError',
        message: 'The operation was aborted',
      },
    },
  } as any

  const classified = classifyEvent(event)
  assert.equal(classified, null)
})

test('skip user-cancelled error flags', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'session.error',
    properties: {
      sessionID: 'ses_abort_flag',
      error: {
        canceledByUser: true,
      },
    },
  } as any

  const classified = classifyEvent(event)
  assert.equal(classified, null)
})

test('skip user-cancelled error code', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'session.error',
    properties: {
      sessionID: 'ses_abort_code',
      error: {
        code: 'ERR_CANCELLED',
      },
    },
  } as any

  const classified = classifyEvent(event)
  assert.equal(classified, null)
})

test('suppress complete after abort error for same session', () => {
  const classifyEvent = createEventClassifier()
  markSessionBusy(classifyEvent, 'ses_abort_idle')

  const aborted = classifyEvent({
    type: 'session.error',
    properties: {
      sessionID: 'ses_abort_idle',
      error: {
        name: 'MessageAbortedError',
        data: { message: 'aborted' },
      },
    },
  } as any)
  assert.equal(aborted, null)

  const idle = classifyEvent({
    type: 'session.status',
    properties: {
      sessionID: 'ses_abort_idle',
      status: { type: 'idle' },
    },
  } as any)
  assert.equal(idle, null)
})

test('suppress legacy session.idle after abort error', () => {
  const classifyEvent = createEventClassifier()
  markSessionBusy(classifyEvent, 'ses_abort_idle_legacy')

  assert.equal(
    classifyEvent({
      type: 'session.error',
      properties: {
        sessionID: 'ses_abort_idle_legacy',
        error: {
          name: 'MessageAbortedError',
          data: { message: 'aborted' },
        },
      },
    } as any),
    null,
  )

  const idle = classifyEvent({
    type: 'session.idle',
    properties: {
      sessionID: 'ses_abort_idle_legacy',
    },
  } as any)
  assert.equal(idle, null)
})

test('abort suppression does not affect other sessions', () => {
  const classifyEvent = createEventClassifier()

  assert.equal(
    classifyEvent({
      type: 'session.error',
      properties: {
        sessionID: 'ses_abort_a',
        error: {
          name: 'MessageAbortedError',
          data: { message: 'aborted' },
        },
      },
    } as any),
    null,
  )

  markSessionBusy(classifyEvent, 'ses_abort_b')

  const classified = classifyEvent({
    type: 'session.status',
    properties: {
      sessionID: 'ses_abort_b',
      status: { type: 'idle' },
    },
  } as any)

  assert.ok(classified)
  assert.equal(classified?.event, 'complete')
})

test('suppress complete after abort error without session id', () => {
  const classifyEvent = createEventClassifier()

  assert.equal(
    classifyEvent({
      type: 'session.error',
      properties: {
        error: {
          name: 'MessageAbortedError',
          data: { message: 'aborted' },
        },
      },
    } as any),
    null,
  )

  const idle = classifyEvent({
    type: 'session.status',
    properties: {
      status: { type: 'idle' },
    },
  } as any)
  assert.equal(idle, null)
})

test('classify error from session.error', () => {
  const classifyEvent = createEventClassifier()
  const event = {
    type: 'session.error',
    properties: {
      sessionID: 'ses_err',
      error: {
        message: 'Rate limit exceeded',
      },
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, 'error')
  assert.match(classified?.summary || '', /Rate limit exceeded/)
})

test('suppress immediate complete after non-abort error', () => {
  const classifyEvent = createEventClassifier()
  markSessionBusy(classifyEvent, 'ses_error_idle')

  const errored = classifyEvent({
    type: 'session.error',
    properties: {
      sessionID: 'ses_error_idle',
      error: { message: 'Rate limit exceeded' },
    },
  } as any)
  assert.ok(errored)
  assert.equal(errored?.event, 'error')

  const idle = classifyEvent({
    type: 'session.status',
    properties: {
      sessionID: 'ses_error_idle',
      status: { type: 'idle' },
    },
  } as any)
  assert.equal(idle, null)
})

test('classify recognizes parentId/sessionId alias fields', () => {
  const classifyEvent = createEventClassifier()

  assert.equal(
    classifyEvent({
      type: 'session.updated',
      properties: {
        info: {
          sessionId: 'ses_alias_title',
          title: 'Alias Session',
        },
      },
    } as any),
    null,
  )

  markSessionBusy(classifyEvent, 'ses_alias_title', true)

  const classified = classifyEvent({
    type: 'session.status',
    properties: {
      sessionId: 'ses_alias_title',
      status: { type: 'idle' },
    },
  } as any)

  assert.ok(classified)
  assert.equal(classified?.sessionTitle, 'Alias Session')

  assert.equal(
    classifyEvent({
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_sub_alias',
          parentId: 'ses_root',
        },
      },
    } as any),
    null,
  )

  assert.equal(
    classifyEvent({
      type: 'session.status',
      properties: {
        sessionId: 'ses_sub_alias',
        status: { type: 'idle' },
      },
    } as any),
    null,
  )
})

test('ignore lifecycle notifications for subagent sessions', () => {
  const classifyEvent = createEventClassifier()

  const subagentUpdated = {
    type: 'session.updated',
    properties: {
      info: {
        id: 'ses_sub',
        parentID: 'ses_root',
      },
    },
  } as any
  assert.equal(classifyEvent(subagentUpdated), null)

  const subagentIdle = {
    type: 'session.status',
    properties: {
      sessionID: 'ses_sub',
      status: { type: 'idle' },
    },
  } as any
  assert.equal(classifyEvent(subagentIdle), null)

  const subagentError = {
    type: 'session.error',
    properties: {
      sessionID: 'ses_sub',
      error: { message: 'boom' },
    },
  } as any
  assert.equal(classifyEvent(subagentError), null)

  const subagentPermission = {
    type: 'permission.asked',
    properties: {
      sessionID: 'ses_sub',
      permission: 'bash',
      patterns: ['git status'],
    },
  } as any
  assert.equal(classifyEvent(subagentPermission), null)

  const subagentQuestion = {
    type: 'question.asked',
    properties: {
      sessionID: 'ses_sub',
      questions: [{ header: 'Continue?' }],
    },
  } as any
  assert.equal(classifyEvent(subagentQuestion), null)
})

test('session lineage updates can re-enable notifications', () => {
  const classifyEvent = createEventClassifier()

  const subagentUpdated = {
    type: 'session.updated',
    properties: {
      info: {
        id: 'ses_moved',
        parentID: 'ses_root',
      },
    },
  } as any
  assert.equal(classifyEvent(subagentUpdated), null)

  const nowRootUpdated = {
    type: 'session.updated',
    properties: {
      info: {
        id: 'ses_moved',
        parentID: undefined,
      },
    },
  } as any
  assert.equal(classifyEvent(nowRootUpdated), null)

  markSessionBusy(classifyEvent, 'ses_moved')

  const idle = {
    type: 'session.status',
    properties: {
      sessionID: 'ses_moved',
      status: { type: 'idle' },
    },
  } as any

  const classified = classifyEvent(idle)
  assert.ok(classified)
  assert.equal(classified?.event, 'complete')
})

test('partial session.updated does not clear subagent lineage', () => {
  const classifyEvent = createEventClassifier()

  assert.equal(
    classifyEvent({
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_sub_partial',
          parentID: 'ses_root',
        },
      },
    } as any),
    null,
  )

  assert.equal(
    classifyEvent({
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_sub_partial',
          title: 'Renamed without parent field',
        },
      },
    } as any),
    null,
  )

  const attention = classifyEvent({
    type: 'permission.asked',
    properties: {
      sessionID: 'ses_sub_partial',
      permission: 'bash',
      patterns: ['git status'],
    },
  } as any)
  assert.equal(attention, null)
})

test('session.deleted evicts subagent/session caches', () => {
  const classifyEvent = createEventClassifier()

  assert.equal(
    classifyEvent({
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_deleted',
          parentID: 'ses_root',
          title: 'Will be removed',
        },
      },
    } as any),
    null,
  )

  assert.equal(
    classifyEvent({
      type: 'session.deleted',
      properties: {
        info: {
          id: 'ses_deleted',
        },
      },
    } as any),
    null,
  )

  markSessionBusy(classifyEvent, 'ses_deleted')

  const classified = classifyEvent({
    type: 'session.status',
    properties: {
      sessionID: 'ses_deleted',
      status: { type: 'idle' },
    },
  } as any)
  assert.ok(classified)
  assert.equal(classified?.event, 'complete')
  assert.equal(classified?.sessionTitle, undefined)
})
