import path from 'node:path'
import { readFile } from 'node:fs/promises'

import type { NotifySound, PluginConfig } from './types.js'

const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  sanitize: true,
  maxBodyLength: 200,
  collapseWindowMs: 3000,
  cooldownMs: 30000,
  showDirectory: true,
  showSessionId: false,
  events: {
    complete: true,
    error: true,
    attention: true,
  },
  soundByEvent: {
    complete: true,
    error: 'error',
    attention: 'attention',
  },
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function asBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === 'boolean' ? input : fallback
}

function asNumber(
  input: unknown,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  if (typeof options.min === 'number' && input < options.min) return options.min
  if (typeof options.max === 'number' && input > options.max) return options.max
  return Math.floor(input)
}

function asSound(input: unknown, fallback: NotifySound): NotifySound {
  if (typeof input === 'boolean') return input
  if (typeof input === 'string') {
    const value = input.trim()
    if (value.length) return value
  }
  return fallback
}

function mergeConfig(base: PluginConfig, input: unknown): PluginConfig {
  if (!isRecord(input)) return base

  const next: PluginConfig = {
    ...base,
    enabled: asBoolean(input.enabled, base.enabled),
    sanitize: asBoolean(input.sanitize, base.sanitize),
    maxBodyLength: asNumber(input.maxBodyLength, base.maxBodyLength, {
      min: 60,
      max: 1200,
    }),
    collapseWindowMs: asNumber(input.collapseWindowMs, base.collapseWindowMs, {
      min: 0,
      max: 10000,
    }),
    cooldownMs: asNumber(input.cooldownMs, base.cooldownMs, {
      min: 0,
      max: 300000,
    }),
    showDirectory: asBoolean(input.showDirectory, base.showDirectory),
    showSessionId: asBoolean(input.showSessionId, base.showSessionId),
    events: { ...base.events },
    soundByEvent: { ...base.soundByEvent },
  }

  if (isRecord(input.events)) {
    next.events.complete = asBoolean(
      input.events.complete,
      next.events.complete,
    )
    next.events.error = asBoolean(input.events.error, next.events.error)
    next.events.attention = asBoolean(
      input.events.attention,
      next.events.attention,
    )
  }

  if (isRecord(input.soundByEvent)) {
    next.soundByEvent.complete = asSound(
      input.soundByEvent.complete,
      next.soundByEvent.complete,
    )
    next.soundByEvent.error = asSound(
      input.soundByEvent.error,
      next.soundByEvent.error,
    )
    next.soundByEvent.attention = asSound(
      input.soundByEvent.attention,
      next.soundByEvent.attention,
    )
  }

  return next
}

async function readConfigFile(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content)
}

export async function loadPluginConfig(
  worktree: string,
  directory: string,
): Promise<PluginConfig> {
  const candidates = [
    path.join(worktree, '.opencode', 'opencode-native-notify.config.json'),
    path.join(worktree, 'opencode-native-notify.config.json'),
    path.join(directory, 'opencode-native-notify.config.json'),
    path.join(worktree, '.opencode', 'opencode-notify.config.json'),
    path.join(worktree, 'opencode-notify.config.json'),
    path.join(directory, 'opencode-notify.config.json'),
  ]

  for (const candidate of candidates) {
    try {
      const parsed = await readConfigFile(candidate)
      return mergeConfig({ ...DEFAULT_CONFIG }, parsed)
    } catch {
      // Missing or invalid config files are ignored by default.
    }
  }

  return { ...DEFAULT_CONFIG }
}

export function defaultPluginConfig(): PluginConfig {
  return { ...DEFAULT_CONFIG }
}
