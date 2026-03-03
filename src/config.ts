import path from 'node:path'
import os from 'node:os'
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

function debugEnabled(): boolean {
  const value = process.env.OPENCODE_NOTIFY_NATIVE_DEBUG?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function debugWarn(message: string): void {
  if (!debugEnabled()) return
  try {
    process.stderr.write(`[notify-native] ${message}\n`)
  } catch {
    // Best-effort only.
  }
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

function resolveConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  if (xdg) return path.join(path.resolve(xdg), 'opencode')
  return path.join(os.homedir(), '.config', 'opencode')
}

function resolveOverridePath(): string | undefined {
  const value = process.env.OPENCODE_NOTIFY_NATIVE_CONFIG?.trim()
  if (!value) return undefined
  return path.resolve(value)
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const filePath of paths) {
    const resolved = path.resolve(filePath)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(key)) continue
    seen.add(key)
    output.push(resolved)
  }
  return output
}

async function mergeIfExists(
  base: PluginConfig,
  filePath: string,
): Promise<PluginConfig> {
  try {
    const parsed = await readConfigFile(filePath)
    return mergeConfig(base, parsed)
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error &&
      'code' in error &&
      typeof (error as any).code === 'string'
        ? String((error as any).code)
        : ''
    if (code === 'ENOENT' || code === 'ENOTDIR') return base
    debugWarn(
      `Failed to load config ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return base
  }
}

export async function loadPluginConfig(
  worktree: string,
  directory: string,
): Promise<PluginConfig> {
  const configDir = resolveConfigDir()
  const override = resolveOverridePath()

  const layers = dedupePaths([
    path.join(configDir, 'notify-native.config.json'),
    path.join(configDir, 'opencode-native-notify.config.json'),
    path.join(configDir, 'opencode-notify.config.json'),

    path.join(worktree, 'notify-native.config.json'),
    path.join(worktree, 'opencode-native-notify.config.json'),
    path.join(worktree, 'opencode-notify.config.json'),

    path.join(directory, 'notify-native.config.json'),
    path.join(directory, 'opencode-native-notify.config.json'),
    path.join(directory, 'opencode-notify.config.json'),

    path.join(worktree, '.opencode', 'notify-native.config.json'),
    path.join(worktree, '.opencode', 'opencode-native-notify.config.json'),
    path.join(worktree, '.opencode', 'opencode-notify.config.json'),

    path.join(directory, '.opencode', 'notify-native.config.json'),
    path.join(directory, '.opencode', 'opencode-native-notify.config.json'),
    path.join(directory, '.opencode', 'opencode-notify.config.json'),

    ...(override ? [override] : []),
  ])

  let config = defaultPluginConfig()
  for (const layer of layers) {
    config = await mergeIfExists(config, layer)
  }
  return config
}

export function defaultPluginConfig(): PluginConfig {
  return {
    ...DEFAULT_CONFIG,
    events: { ...DEFAULT_CONFIG.events },
    soundByEvent: { ...DEFAULT_CONFIG.soundByEvent },
  }
}
