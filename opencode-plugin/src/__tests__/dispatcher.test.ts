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
    send: async (payload) => {
      sent.push(payload)
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
  } finally {
    Date.now = realNow
  }
})

test('collapse window coalesces and annotates count', async () => {
  const sent: any[] = []
  const dispatcher = new NotifyDispatcher({
    collapseWindowMs: 20,
    cooldownMs: 0,
    send: async (payload) => {
      sent.push(payload)
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
  assert.equal(sent[0].title, 't')
  assert.match(sent[0].body, /\(x3\)\s*$/)
})
