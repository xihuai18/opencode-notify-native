import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultPluginConfig } from '../config.js'
import { autoSilenceReason } from '../runtime.js'

test('autoSilenceReason detects desktop client', () => {
  const config = defaultPluginConfig()
  assert.equal(
    autoSilenceReason(config, { opencodeClient: 'desktop' }),
    'non-tui client: desktop',
  )
})

test('autoSilenceReason detects acp client', () => {
  const config = defaultPluginConfig()
  assert.equal(
    autoSilenceReason(config, { opencodeClient: 'acp' }),
    'non-tui client: acp',
  )
})

test('autoSilenceReason detects non-tui web command', () => {
  const config = defaultPluginConfig()
  assert.equal(
    autoSilenceReason(config, {
      argv: ['node', 'opencode', 'web'],
      opencodeClient: 'cli',
    }),
    'non-tui command: web',
  )
})

test('autoSilenceReason detects non-tui serve command', () => {
  const config = defaultPluginConfig()
  assert.equal(
    autoSilenceReason(config, {
      argv: ['node', 'opencode', 'serve'],
      opencodeClient: 'cli',
    }),
    'non-tui command: serve',
  )
})

test('autoSilenceReason does not silence on app client alone', () => {
  const config = defaultPluginConfig()
  assert.equal(autoSilenceReason(config, { opencodeClient: 'app' }), undefined)
})

test('autoSilenceReason respects config opt-out', () => {
  const config = defaultPluginConfig()
  config.autoSilence.nonTui = false

  assert.equal(
    autoSilenceReason(config, { opencodeClient: 'desktop' }),
    undefined,
  )
})
