import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'

import { createOpenCodeNotifyPlugin } from '../index.js'

const defaultClient = process.env.OPENCODE_CLIENT
process.env.OPENCODE_CLIENT = 'cli'
test.after(() => {
  if (defaultClient === undefined) delete process.env.OPENCODE_CLIENT
  else process.env.OPENCODE_CLIENT = defaultClient
})

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

  const busy = {
    type: 'session.status',
    properties: {
      sessionID: 'ses_1234567890',
      status: { type: 'busy' },
    },
  } as any
  const idle = {
    type: 'session.status',
    properties: {
      sessionID: 'ses_1234567890',
      status: { type: 'idle' },
    },
  } as any

  // Collapse 3 terminal events into a single notification.
  await hooks.event!({ event: busy })
  await hooks.event!({ event: idle })
  await hooks.event!({ event: busy })
  await hooks.event!({ event: idle })
  await hooks.event!({ event: busy })
  await hooks.event!({ event: idle })

  await tick(760)

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

test('plugin auto-silences on desktop client', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  const prevClient = process.env.OPENCODE_CLIENT
  process.env.OPENCODE_CLIENT = 'desktop'

  try {
    const calls: any[] = []
    const plugin = createOpenCodeNotifyPlugin({
      notifyNative: async (input) => {
        calls.push(input)
        return true
      },
    })

    const hooks = await plugin({ worktree: root, directory: root } as any)
    assert.equal(hooks.event, undefined)
    assert.equal(calls.length, 0)
  } finally {
    if (prevClient === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = prevClient
  }
})

test('plugin auto-silences on web command', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  const prevArgv = process.argv
  const prevClient = process.env.OPENCODE_CLIENT
  process.argv = ['node', 'opencode', 'web']
  process.env.OPENCODE_CLIENT = 'cli'

  try {
    const calls: any[] = []
    const plugin = createOpenCodeNotifyPlugin({
      notifyNative: async (input) => {
        calls.push(input)
        return true
      },
    })

    const hooks = await plugin({ worktree: root, directory: root } as any)
    assert.equal(hooks.event, undefined)
    assert.equal(calls.length, 0)
  } finally {
    process.argv = prevArgv
    if (prevClient === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = prevClient
  }
})

test('plugin auto-silences on serve command', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  const prevArgv = process.argv
  const prevClient = process.env.OPENCODE_CLIENT
  process.argv = ['node', 'opencode', 'serve']
  process.env.OPENCODE_CLIENT = 'cli'

  try {
    const calls: any[] = []
    const plugin = createOpenCodeNotifyPlugin({
      notifyNative: async (input) => {
        calls.push(input)
        return true
      },
    })

    const hooks = await plugin({ worktree: root, directory: root } as any)
    assert.equal(hooks.event, undefined)
    assert.equal(calls.length, 0)
  } finally {
    process.argv = prevArgv
    if (prevClient === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = prevClient
  }
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
      status: { type: 'busy' },
    },
  } as any)

  await hooks.event!({
    type: 'session.status',
    properties: {
      sessionID: 'ses_raw_payload',
      status: { type: 'idle' },
    },
  } as any)

  await tick(650)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].event, 'complete')
})

test('plugin prefers nested event payload in wrapped envelopes', async () => {
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
    type: 'event',
    event: {
      type: 'session.status',
      properties: {
        sessionID: 'ses_wrapped_payload',
        status: { type: 'busy' },
      },
    },
  } as any)

  await hooks.event!({
    type: 'event',
    event: {
      type: 'session.status',
      properties: {
        sessionID: 'ses_wrapped_payload',
        status: { type: 'idle' },
      },
    },
  } as any)

  await tick(650)

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
        status: { type: 'busy' },
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

  await tick(650)

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
        status: { type: 'busy' },
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

  await tick(650)

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

test('auto-accepted permission requests do not notify', async () => {
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

  await hooks.event!({
    event: {
      type: 'permission.asked',
      properties: {
        id: 'perm_auto_1',
        sessionID: 'ses_auto_permission',
        permission: 'bash',
        patterns: ['git status'],
      },
    },
  } as any)
  await hooks.event!({
    event: {
      type: 'permission.replied',
      properties: {
        sessionID: 'ses_auto_permission',
        requestID: 'perm_auto_1',
        reply: 'always',
      },
    },
  } as any)

  await tick(450)

  assert.equal(calls.length, 0)
})

test('auto-answered questions do not notify', async () => {
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

  await hooks.event!({
    event: {
      type: 'question.asked',
      properties: {
        id: 'q_auto_1',
        sessionID: 'ses_auto_question',
        questions: [
          {
            header: 'Pick one',
            question: 'Pick one',
            options: [{ label: 'Yes', description: 'Confirm' }],
          },
        ],
      },
    },
  } as any)
  await hooks.event!({
    event: {
      type: 'question.replied',
      properties: {
        sessionID: 'ses_auto_question',
        requestID: 'q_auto_1',
        answers: [['Yes']],
      },
    },
  } as any)

  await tick(450)

  assert.equal(calls.length, 0)
})

test('session deletion cancels pending actionable notification', async () => {
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

  await hooks.event!({
    event: {
      type: 'question.asked',
      properties: {
        id: 'q_deleted_1',
        sessionID: 'ses_deleted_question',
        questions: [
          {
            header: 'Need input',
            question: 'Need input',
            options: [{ label: 'Ok', description: 'Continue' }],
          },
        ],
      },
    },
  } as any)
  await hooks.event!({
    event: {
      type: 'session.deleted',
      properties: {
        info: {
          id: 'ses_deleted_question',
        },
      },
    },
  } as any)

  await tick(450)

  assert.equal(calls.length, 0)
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

test('abort error cancels pending complete notification', async () => {
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
      type: 'session.status',
      properties: {
        sessionID: 'ses_abort_pending',
        status: { type: 'busy' },
      },
    },
  } as any)
  await hooks.event!({
    event: {
      type: 'session.status',
      properties: {
        sessionID: 'ses_abort_pending',
        status: { type: 'idle' },
      },
    },
  } as any)
  await hooks.event!({
    event: {
      type: 'session.error',
      properties: {
        sessionID: 'ses_abort_pending',
        error: {
          name: 'MessageAbortedError',
          data: { message: 'aborted' },
        },
      },
    },
  } as any)

  await tick(650)
  assert.equal(calls.length, 0)
})

test('non-abort session.error cancels pending complete and emits error', async () => {
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
      type: 'session.status',
      properties: {
        sessionID: 'ses_error_pending',
        status: { type: 'busy' },
      },
    },
  } as any)
  await hooks.event!({
    event: {
      type: 'session.status',
      properties: {
        sessionID: 'ses_error_pending',
        status: { type: 'idle' },
      },
    },
  } as any)
  await hooks.event!({
    event: {
      type: 'session.error',
      properties: {
        sessionID: 'ses_error_pending',
        error: { message: 'Rate limit exceeded' },
      },
    },
  } as any)

  await tick(650)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].event, 'error')
  assert.match(calls[0].body, /^Error · /)
})
