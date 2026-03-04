import assert from 'node:assert/strict'
import test from 'node:test'

import { debugEnabled, resetDebugCacheForTests } from '../debug.js'

test('debugEnabled reads OPENCODE_NOTIFY_NATIVE_DEBUG values', () => {
  const prev = process.env.OPENCODE_NOTIFY_NATIVE_DEBUG
  try {
    process.env.OPENCODE_NOTIFY_NATIVE_DEBUG = '1'
    resetDebugCacheForTests()
    assert.equal(debugEnabled(), true)

    process.env.OPENCODE_NOTIFY_NATIVE_DEBUG = 'false'
    resetDebugCacheForTests()
    assert.equal(debugEnabled(), false)
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_NOTIFY_NATIVE_DEBUG
    else process.env.OPENCODE_NOTIFY_NATIVE_DEBUG = prev
    resetDebugCacheForTests()
  }
})
