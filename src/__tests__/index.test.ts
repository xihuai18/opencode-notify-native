import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'

import { createOpenCodeNotifyPlugin } from '../index.js'

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('plugin wires event -> classify -> dispatch -> native send', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  await writeFile(
    path.join(root, 'notify-native.config.json'),
    JSON.stringify({
      enabled: true,
      sanitize: true,
      maxBodyLength: 60,
      collapseWindowMs: 20,
      cooldownMs: 0,
      showDirectory: false,
      showSessionId: false,
    }),
    'utf8',
  )

  const calls: any[] = []
  const plugin = createOpenCodeNotifyPlugin({
    notifyNative: async (input) => {
      calls.push(input)
      return true
    },
  })

  const hooks = await plugin({ worktree: root, directory: root } as any)
  assert.ok(typeof hooks.event === 'function')

  const event = {
    type: 'session.status',
    properties: {
      sessionID: 'ses_1234567890',
      status: { type: 'idle' },
    },
  } as any

  // Collapse 3 identical events into a single notification.
  await hooks.event!({ event })
  await hooks.event!({ event })
  await hooks.event!({ event })

  await tick(60)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].event, 'complete')
  assert.match(calls[0].title, /^OpenCode · /)
  assert.ok(!calls[0].title.endsWith(' · Complete'))
  assert.ok(!calls[0].title.endsWith(' · Completed'))
  assert.ok(typeof calls[0].group === 'string' && calls[0].group.length > 0)
  assert.ok(calls[0].body.length <= 60)
  assert.match(calls[0].body, /^Completed · Task completed/)
  assert.ok(!calls[0].body.startsWith('Complete:'))
  assert.match(calls[0].body, /\n\(x3\)$/)
})

test('plugin accepts raw event payload shape', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  await writeFile(
    path.join(root, 'notify-native.config.json'),
    JSON.stringify({
      enabled: true,
      sanitize: true,
      collapseWindowMs: 0,
      cooldownMs: 0,
      showDirectory: false,
      showSessionId: false,
    }),
    'utf8',
  )

  const calls: any[] = []
  const plugin = createOpenCodeNotifyPlugin({
    notifyNative: async (input) => {
      calls.push(input)
      return true
    },
  })

  const hooks = await plugin({ worktree: root, directory: root } as any)
  assert.ok(typeof hooks.event === 'function')

  await hooks.event!({
    type: 'session.status',
    properties: {
      sessionID: 'ses_raw_payload',
      status: { type: 'idle' },
    },
  } as any)

  await tick(20)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].event, 'complete')
})

test('title prefers session title when available', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  await writeFile(
    path.join(root, 'notify-native.config.json'),
    JSON.stringify({
      enabled: true,
      sanitize: true,
      collapseWindowMs: 0,
      cooldownMs: 0,
      showDirectory: false,
      showSessionId: false,
    }),
    'utf8',
  )

  const calls: any[] = []
  const plugin = createOpenCodeNotifyPlugin({
    notifyNative: async (input) => {
      calls.push(input)
      return true
    },
  })

  const hooks = await plugin({ worktree: root, directory: root } as any)
  assert.ok(typeof hooks.event === 'function')

  await hooks.event!({
    event: {
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_title',
          title: 'My Useful Session Title',
        },
      },
    },
  } as any)

  await hooks.event!({
    event: {
      type: 'session.status',
      properties: {
        sessionID: 'ses_title',
        status: { type: 'idle' },
      },
    },
  } as any)

  await tick(20)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].title, 'OpenCode · My Useful Session Title')
})

test('session title uses first line before length clamp', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  await writeFile(
    path.join(root, 'notify-native.config.json'),
    JSON.stringify({
      enabled: true,
      sanitize: true,
      collapseWindowMs: 0,
      cooldownMs: 0,
      showDirectory: false,
      showSessionId: false,
    }),
    'utf8',
  )

  const calls: any[] = []
  const plugin = createOpenCodeNotifyPlugin({
    notifyNative: async (input) => {
      calls.push(input)
      return true
    },
  })

  const hooks = await plugin({ worktree: root, directory: root } as any)

  await hooks.event!({
    event: {
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_title_multiline',
          title: `First line ${'x'.repeat(120)}\nSecond line should be ignored`,
        },
      },
    },
  } as any)

  await hooks.event!({
    event: {
      type: 'session.status',
      properties: {
        sessionID: 'ses_title_multiline',
        status: { type: 'idle' },
      },
    },
  } as any)

  await tick(20)

  assert.equal(calls.length, 1)
  assert.match(calls[0].title, /^OpenCode · First line /)
  assert.ok(calls[0].title.length <= 120)
  assert.ok(!calls[0].title.includes('Second line'))
  assert.ok(!calls[0].title.includes('\n'))
})

test('distinct attention prompts are not suppressed by cooldown', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  await writeFile(
    path.join(root, 'notify-native.config.json'),
    JSON.stringify({
      enabled: true,
      sanitize: true,
      collapseWindowMs: 0,
      cooldownMs: 30_000,
      showDirectory: false,
      showSessionId: false,
      events: { attention: true },
    }),
    'utf8',
  )

  const calls: any[] = []
  const plugin = createOpenCodeNotifyPlugin({
    notifyNative: async (input) => {
      calls.push(input)
      return true
    },
  })

  const hooks = await plugin({ worktree: root, directory: root } as any)
  assert.ok(typeof hooks.event === 'function')

  const a = {
    type: 'permission.asked',
    properties: {
      sessionID: 'ses_attention',
      permission: 'bash',
      patterns: ['git status'],
    },
  } as any
  const b = {
    type: 'permission.asked',
    properties: {
      sessionID: 'ses_attention',
      permission: 'bash',
      patterns: ['git diff'],
    },
  } as any

  await hooks.event!({ event: a })
  await hooks.event!({ event: b })
  await tick()

  assert.equal(calls.length, 2)
  assert.equal(calls[0].event, 'attention')
  assert.equal(calls[1].event, 'attention')
  assert.notEqual(calls[0].group, calls[1].group)
})

test('malformed hook payload is ignored safely', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  await writeFile(
    path.join(root, 'notify-native.config.json'),
    JSON.stringify({ enabled: true }),
    'utf8',
  )

  const calls: any[] = []
  const plugin = createOpenCodeNotifyPlugin({
    notifyNative: async (input) => {
      calls.push(input)
      return true
    },
  })

  const hooks = await plugin({ worktree: root, directory: root } as any)
  assert.ok(typeof hooks.event === 'function')

  await hooks.event!(undefined as any)
  await hooks.event!({} as any)
  await hooks.event!({ event: null } as any)
  await tick(20)

  assert.equal(calls.length, 0)
})
