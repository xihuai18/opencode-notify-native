import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'

import { loadPluginConfig } from '../config.js'

test('loadPluginConfig uses first matching config file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  const opencodeDir = path.join(root, '.opencode')
  await mkdir(opencodeDir, { recursive: true })

  await writeFile(
    path.join(root, 'opencode-notify.config.json'),
    JSON.stringify({ showSessionId: true, events: { attention: true } }),
    'utf8',
  )

  await writeFile(
    path.join(opencodeDir, 'opencode-native-notify.config.json'),
    JSON.stringify({ showSessionId: false, events: { attention: false } }),
    'utf8',
  )

  const config = await loadPluginConfig(root, root)
  assert.equal(config.showSessionId, false)
  assert.equal(config.events.attention, false)
})

test('loadPluginConfig falls back to directory config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  const dir = path.join(root, 'sub')
  await mkdir(dir, { recursive: true })

  await writeFile(
    path.join(dir, 'opencode-native-notify.config.json'),
    JSON.stringify({ showSessionId: true }),
    'utf8',
  )

  const config = await loadPluginConfig(root, dir)
  assert.equal(config.showSessionId, true)
})
