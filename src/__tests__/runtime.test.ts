import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultPluginConfig } from '../config.js'
import { autoSilenceReason } from '../runtime.js'

test('autoSilenceReason detects desktop client', () => {
  const config = defaultPluginConfig()
  assert.equal(
    autoSilenceReason(config, { opencodeClient: 'desktop' }),
    'desktop client',
  )
})

test('autoSilenceReason does not silence on app client alone', () => {
  const config = defaultPluginConfig()
  assert.equal(autoSilenceReason(config, { opencodeClient: 'app' }), undefined)
})

test('autoSilenceReason respects config opt-out', () => {
  const config = defaultPluginConfig()
  config.autoSilence.desktop = false

  assert.equal(
    autoSilenceReason(config, { opencodeClient: 'desktop' }),
    undefined,
  )
})
