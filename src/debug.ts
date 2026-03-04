let cachedDebugEnabled: boolean | undefined

function readDebugEnabled(): boolean {
  const value = process.env.OPENCODE_NOTIFY_NATIVE_DEBUG?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

export function debugEnabled(): boolean {
  if (cachedDebugEnabled === undefined) {
    cachedDebugEnabled = readDebugEnabled()
  }
  return cachedDebugEnabled
}

export function resetDebugCacheForTests(): void {
  cachedDebugEnabled = undefined
}

export function debugWarn(message: string): void {
  if (!debugEnabled()) return
  try {
    process.stderr.write(`[notify-native] ${message}\n`)
  } catch {
    // Best-effort only.
  }
}
