import assert from 'node:assert/strict'
import test from 'node:test'

import { backendBackoffMs } from '../backoff.js'

test('backendBackoffMs uses exponential backoff with cap', () => {
  assert.equal(backendBackoffMs(1, { jitterRatio: 0 }), 15_000)
  assert.equal(backendBackoffMs(2, { jitterRatio: 0 }), 30_000)
  assert.equal(backendBackoffMs(3, { jitterRatio: 0 }), 60_000)
  assert.equal(backendBackoffMs(4, { jitterRatio: 0 }), 120_000)
  assert.equal(backendBackoffMs(5, { jitterRatio: 0 }), 240_000)
  assert.equal(backendBackoffMs(6, { jitterRatio: 0 }), 300_000)
  assert.equal(backendBackoffMs(7, { jitterRatio: 0 }), 300_000)
})

test('backendBackoffMs clamps non-positive failures', () => {
  assert.equal(backendBackoffMs(0, { jitterRatio: 0 }), 15_000)
  assert.equal(backendBackoffMs(-1, { jitterRatio: 0 }), 15_000)
})

test('backendBackoffMs applies bounded jitter', () => {
  assert.equal(
    backendBackoffMs(3, { random: () => 0, jitterRatio: 0.2 }),
    48_000,
  )
  assert.equal(
    backendBackoffMs(3, { random: () => 1, jitterRatio: 0.2 }),
    72_000,
  )
})
