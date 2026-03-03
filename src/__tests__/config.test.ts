import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'

import { defaultPluginConfig, loadPluginConfig } from '../config.js'

test('loadPluginConfig applies project .opencode override', async () => {
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

test('loadPluginConfig supports layered global + project config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  const xdgHome = path.join(root, 'xdg')
  const globalDir = path.join(xdgHome, 'opencode')
  await mkdir(globalDir, { recursive: true })

  const prevXdg = process.env.XDG_CONFIG_HOME
  const prevOverride = process.env.OPENCODE_NOTIFY_NATIVE_CONFIG
  process.env.XDG_CONFIG_HOME = xdgHome
  delete process.env.OPENCODE_NOTIFY_NATIVE_CONFIG

  try {
    await writeFile(
      path.join(globalDir, 'notify-native.config.json'),
      JSON.stringify({
        showDirectory: false,
        events: {
          complete: false,
        },
      }),
      'utf8',
    )

    await writeFile(
      path.join(root, 'notify-native.config.json'),
      JSON.stringify({
        showSessionId: true,
      }),
      'utf8',
    )

    const config = await loadPluginConfig(root, root)
    assert.equal(config.showDirectory, false)
    assert.equal(config.events.complete, false)
    assert.equal(config.showSessionId, true)
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = prevXdg

    if (prevOverride === undefined)
      delete process.env.OPENCODE_NOTIFY_NATIVE_CONFIG
    else process.env.OPENCODE_NOTIFY_NATIVE_CONFIG = prevOverride
  }
})

test('loadPluginConfig allows env override file path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  const overridePath = path.join(root, 'override.json')

  const prev = process.env.OPENCODE_NOTIFY_NATIVE_CONFIG
  process.env.OPENCODE_NOTIFY_NATIVE_CONFIG = overridePath

  try {
    await writeFile(
      path.join(root, 'notify-native.config.json'),
      JSON.stringify({ showSessionId: false }),
      'utf8',
    )

    await writeFile(
      overridePath,
      JSON.stringify({ showSessionId: true }),
      'utf8',
    )

    const config = await loadPluginConfig(root, root)
    assert.equal(config.showSessionId, true)
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_NOTIFY_NATIVE_CONFIG
    else process.env.OPENCODE_NOTIFY_NATIVE_CONFIG = prev
  }
})

test('loadPluginConfig ignores invalid JSON (fail closed)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-notify-native-'))
  const overridePath = path.join(root, 'override.json')

  const prev = process.env.OPENCODE_NOTIFY_NATIVE_CONFIG
  process.env.OPENCODE_NOTIFY_NATIVE_CONFIG = overridePath

  try {
    await writeFile(
      path.join(root, 'notify-native.config.json'),
      JSON.stringify({ showSessionId: true }),
      'utf8',
    )
    await writeFile(overridePath, '{ this is not json', 'utf8')

    const config = await loadPluginConfig(root, root)
    assert.equal(config.showSessionId, true)
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_NOTIFY_NATIVE_CONFIG
    else process.env.OPENCODE_NOTIFY_NATIVE_CONFIG = prev
  }
})

test('defaultPluginConfig returns a deep copy', () => {
  const a = defaultPluginConfig()
  const b = defaultPluginConfig()
  a.events.complete = false
  a.soundByEvent.error = false

  assert.equal(b.events.complete, true)
  assert.equal(b.soundByEvent.error, 'error')
})
