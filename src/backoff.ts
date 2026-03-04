export function backendBackoffMs(
  failures: number,
  options: {
    jitterRatio?: number
    random?: () => number
  } = {},
): number {
  const base = 15_000
  const max = 300_000
  const exp = Math.min(5, Math.max(0, Math.floor(failures) - 1))
  const raw = Math.min(max, base * 2 ** exp)

  const ratio =
    typeof options.jitterRatio === 'number'
      ? Math.max(0, Math.min(0.5, options.jitterRatio))
      : 0.2
  if (!ratio) return raw

  const random = options.random || Math.random
  const n = random()
  const unit = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5
  const delta = (unit * 2 - 1) * ratio
  return Math.max(base, Math.min(max, Math.round(raw * (1 + delta))))
}
