import type { PluginConfig } from './types.js'

type RuntimeContext = {
  opencodeClient?: string
}

function normalizeClient(input: string | undefined): string {
  return input?.trim().toLowerCase() || 'cli'
}

export function autoSilenceReason(
  config: PluginConfig,
  runtime: RuntimeContext = {},
): string | undefined {
  const client = normalizeClient(
    runtime.opencodeClient ?? process.env.OPENCODE_CLIENT,
  )

  if (config.autoSilence.desktop && client === 'desktop') {
    return 'desktop client'
  }

  return undefined
}
