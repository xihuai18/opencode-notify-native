import assert from 'node:assert/strict'
import test from 'node:test'

import { createEventClassifier } from '../classify.js'

test('classify complete from session.status idle', () => {
  const classifyEvent = createEventClassifier()
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

test('suppress legacy session.idle when status idle seen', () => {
  const classifyEvent = createEventClassifier()
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
