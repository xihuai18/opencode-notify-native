import assert from 'node:assert/strict'
import test from 'node:test'

import { NotifyDispatcher } from '../dispatcher.js'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

test('cooldown blocks repeated notifications', async () => {
  const sent: any[] = []
  const dispatcher = new NotifyDispatcher({
    collapseWindowMs: 0,
    cooldownMs: 1000,
    send: async (payload, count) => {
      sent.push({ payload, count })
      return true
    },
  })

  const realNow = Date.now
  let now = 1_700_000_000_000
  Date.now = () => now
  try {
    dispatcher.enqueue({
      event: 'complete',
      title: 't',
      body: 'b',
      sound: false,
      collapseKey: 'k',
      replaceKey: 'r',
    })
    await tick()

    dispatcher.enqueue({
      event: 'complete',
      title: 't',
      body: 'b',
      sound: false,
      collapseKey: 'k',
      replaceKey: 'r',
    })
    await tick()

    assert.equal(sent.length, 1)
    assert.equal(sent[0].count, 1)

    now += 1000
    dispatcher.enqueue({
      event: 'complete',
      title: 't',
      body: 'b',
      sound: false,
      collapseKey: 'k',
      replaceKey: 'r',
    })
    await tick()

    assert.equal(sent.length, 2)
    assert.equal(sent[1].count, 1)
  } finally {
    Date.now = realNow
  }
})

test('collapse window coalesces and reports count', async () => {
  const sent: any[] = []
  const dispatcher = new NotifyDispatcher({
    collapseWindowMs: 20,
    cooldownMs: 0,
    send: async (payload, count) => {
      sent.push({ payload, count })
      return true
    },
  })

  for (let i = 0; i < 3; i += 1) {
    dispatcher.enqueue({
      event: 'attention',
      title: 't',
      body: 'b',
      sound: true,
      collapseKey: 'k',
      replaceKey: 'r',
    })
  }

  await new Promise((resolve) => setTimeout(resolve, 40))

  assert.equal(sent.length, 1)
  assert.equal(sent[0].payload.title, 't')
  assert.equal(sent[0].payload.body, 'b')
  assert.equal(sent[0].count, 3)
})

test('in-flight limit drops complete spam but preserves attention', async () => {
  const sent: any[] = []
  let release: (() => void) | undefined
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })

  const dispatcher = new NotifyDispatcher({
    collapseWindowMs: 0,
    cooldownMs: 0,
    maxInFlight: 1,
    send: async (payload, count) => {
      sent.push({ payload, count })
      if (payload.event === 'complete' && payload.collapseKey === 'k1') {
        await hold
      }
      return true
    },
  })

  dispatcher.enqueue({
    event: 'complete',
    title: 't',
    body: 'b',
    sound: false,
    collapseKey: 'k1',
    replaceKey: 'r1',
  })
  await tick()

  // This completion is dropped due to in-flight limit.
  dispatcher.enqueue({
    event: 'complete',
    title: 't',
    body: 'b',
    sound: false,
    collapseKey: 'k2',
    replaceKey: 'r2',
  })

  // Attention should still pass through even when complete is saturated.
  dispatcher.enqueue({
    event: 'attention',
    title: 't',
    body: 'b',
    sound: false,
    collapseKey: 'a1',
    replaceKey: 'r3',
  })

  await tick()
  assert.equal(sent.length, 2)
  assert.equal(sent[0].payload.collapseKey, 'k1')
  assert.equal(sent[1].payload.collapseKey, 'a1')

  release?.()
  await tick()

  // Once capacity frees up, the completion can be delivered.
  dispatcher.enqueue({
    event: 'complete',
    title: 't',
    body: 'b',
    sound: false,
    collapseKey: 'k2',
    replaceKey: 'r2',
  })
  await tick()
  assert.equal(sent.length, 3)
  assert.equal(sent[2].payload.collapseKey, 'k2')
})

test('failed send does not start cooldown window', async () => {
  const sent: any[] = []
  let first = true
  const dispatcher = new NotifyDispatcher({
    collapseWindowMs: 0,
    cooldownMs: 1000,
    send: async (payload, count) => {
      sent.push({ payload, count })
      if (first) {
        first = false
        return false
      }
      return true
    },
  })

  const realNow = Date.now
  Date.now = () => 1_700_000_000_000
  try {
    dispatcher.enqueue({
      event: 'error',
      title: 't',
      body: 'b',
      sound: false,
      collapseKey: 'err',
      replaceKey: 'r',
    })
    await tick()

    dispatcher.enqueue({
      event: 'error',
      title: 't',
      body: 'b',
      sound: false,
      collapseKey: 'err',
      replaceKey: 'r',
    })
    await tick()
  } finally {
    Date.now = realNow
  }

  assert.equal(sent.length, 2)
})

test('same key is not sent concurrently while first send is in-flight', async () => {
  const sent: any[] = []
  let release: (() => void) | undefined
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })

  const dispatcher = new NotifyDispatcher({
    collapseWindowMs: 0,
    cooldownMs: 1000,
    send: async (payload, count) => {
      sent.push({ payload, count })
      await hold
      return true
    },
  })

  dispatcher.enqueue({
    event: 'complete',
    title: 't',
    body: 'b',
    sound: false,
    collapseKey: 'k',
    replaceKey: 'r',
  })
  dispatcher.enqueue({
    event: 'complete',
    title: 't',
    body: 'b',
    sound: false,
    collapseKey: 'k',
    replaceKey: 'r',
  })

  await tick()
  assert.equal(sent.length, 1)

  release?.()
  await tick()
})

test('same-key events queued during in-flight are retried after failed send', async () => {
  const sent: any[] = []
  let release: (() => void) | undefined
  let first = true
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })

  const dispatcher = new NotifyDispatcher({
    collapseWindowMs: 0,
    cooldownMs: 1000,
    send: async (payload, count) => {
      sent.push({ payload, count })
      if (first) {
        first = false
        await hold
        return false
      }
      return true
    },
  })

  dispatcher.enqueue({
    event: 'attention',
    title: 't',
    body: 'b',
    sound: false,
    collapseKey: 'retry-key',
    replaceKey: 'r',
  })
  dispatcher.enqueue({
    event: 'attention',
    title: 't2',
    body: 'b2',
    sound: false,
    collapseKey: 'retry-key',
    replaceKey: 'r',
  })

  await tick()
  assert.equal(sent.length, 1)

  release?.()
  await tick()
  await tick()

  assert.equal(sent.length, 2)
  assert.equal(sent[1].payload.title, 't2')
})

test('same-key queued event is suppressed after successful send cooldown', async () => {
  const sent: any[] = []
  let release: (() => void) | undefined
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })

  const dispatcher = new NotifyDispatcher({
    collapseWindowMs: 0,
    cooldownMs: 1000,
    send: async (payload, count) => {
      sent.push({ payload, count })
      await hold
      return true
    },
  })

  const realNow = Date.now
  Date.now = () => 1_700_000_000_000
  try {
    dispatcher.enqueue({
      event: 'complete',
      title: 't1',
      body: 'b1',
      sound: false,
      collapseKey: 'cooldown-key',
      replaceKey: 'r1',
    })
    dispatcher.enqueue({
      event: 'complete',
      title: 't2',
      body: 'b2',
      sound: false,
      collapseKey: 'cooldown-key',
      replaceKey: 'r2',
    })

    await tick()
    assert.equal(sent.length, 1)

    release?.()
    await tick()
    await tick()
  } finally {
    Date.now = realNow
  }

  assert.equal(sent.length, 1)
})

test('dispose clears timers and ignores future enqueue', async () => {
  const sent: any[] = []
  const dispatcher = new NotifyDispatcher({
    collapseWindowMs: 20,
    cooldownMs: 0,
    send: async (payload, count) => {
      sent.push({ payload, count })
      return true
    },
  })

  dispatcher.enqueue({
    event: 'complete',
    title: 't',
    body: 'b',
    sound: false,
    collapseKey: 'dispose-key',
    replaceKey: 'r',
  })

  dispatcher.dispose()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(sent.length, 0)

  dispatcher.enqueue({
    event: 'complete',
    title: 't',
    body: 'b',
    sound: false,
    collapseKey: 'dispose-key',
    replaceKey: 'r',
  })
  await tick()
  assert.equal(sent.length, 0)
})
