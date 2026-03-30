import type { PluginConfig } from './types.js'

type RuntimeContext = {
  argv?: string[]
  opencodeClient?: string
}

function normalizeClient(input: string | undefined): string {
  return input?.trim().toLowerCase() || 'cli'
}

function firstCommand(argv: string[]): string | undefined {
  for (const raw of argv.slice(2)) {
    const value = raw.trim().toLowerCase()
    if (!value) continue
    if (value === '--') return undefined
    if (value.startsWith('-')) continue
    return value
  }
  return undefined
}

export function autoSilenceReason(
  config: PluginConfig,
  runtime: RuntimeContext = {},
): string | undefined {
  const client = normalizeClient(
    runtime.opencodeClient ?? process.env.OPENCODE_CLIENT,
  )

  if (!config.autoSilence.nonTui) {
    return undefined
  }

  if (client === 'desktop') {
    return 'desktop client'
  }

  const command = firstCommand(runtime.argv ?? process.argv)
  if (command === 'web' || command === 'serve') {
    return `non-tui command: ${command}`
  }

  return undefined
}
