import path from 'node:path'
import os from 'node:os'

const TOKEN_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /gh[opsu]_[A-Za-z0-9]{10,}/g,
  /github_pat_[A-Za-z0-9_]{10,}/g,
  /glpat-[A-Za-z0-9_-]{10,}/g,
  /npm_[A-Za-z0-9]{10,}/g,
  /pypi-[A-Za-z0-9]{10,}/g,
  /Bearer\s+[A-Za-z0-9._\-+/=]{10,}/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /A(KIA|SIA)[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /ya29\.[0-9A-Za-z_-]{10,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
]

function clamp(input: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength))
  if (!limit) return ''
  if (input.length <= limit) return input
  if (limit <= 3) return '.'.repeat(limit)
  return `${input.slice(0, limit - 3)}...`
}

function normalizeText(input: string): string {
  // Normalize newlines and strip control characters that can break notification
  // backends (notably Windows toast XML and some D-Bus implementations).
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
}

export function sanitizeText(
  input: string,
  options: { enabled: boolean; maxLength: number },
): string {
  const normalized = normalizeText(input)
  const maxLength = Math.max(1, options.maxLength)
  if (!options.enabled) return clamp(normalized, maxLength)

  let output = normalized
  for (const pattern of TOKEN_PATTERNS) {
    output = output.replace(pattern, '[REDACTED]')
  }
  return clamp(output, maxLength)
}

export function formatCollapsedBody(
  body: string,
  count: number,
  options: { enabled: boolean; maxLength: number },
): string {
  const maxLength = Math.max(1, options.maxLength)
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1
  if (safeCount <= 1) return sanitizeText(body, { ...options, maxLength })

  const suffix = `\n(x${safeCount})`
  const reserved = Math.max(0, maxLength - suffix.length)
  const head = sanitizeText(body, { ...options, maxLength: reserved })
  const combined = `${head}${suffix}`
  return combined.length <= maxLength ? combined : clamp(combined, maxLength)
}

export function summarizeError(error: unknown): string {
  if (!error) return 'OpenCode reported an error'
  if (typeof error === 'string') return error
  if (typeof error !== 'object') return 'OpenCode reported an error'

  const maybe = error as {
    name?: unknown
    data?: { message?: unknown }
    message?: unknown
  }

  if (typeof maybe.data?.message === 'string' && maybe.data.message.trim()) {
    return maybe.data.message.trim()
  }
  if (typeof maybe.message === 'string' && maybe.message.trim()) {
    return maybe.message.trim()
  }
  if (typeof maybe.name === 'string' && maybe.name.trim()) {
    return maybe.name.trim()
  }
  return 'OpenCode reported an error'
}

export function shortPath(input: string): string {
  const value = input.replace(/[\\/]/g, path.sep)
  const home = os.homedir()
  const normalizedInput = path.normalize(value)
  const normalizedHome = path.normalize(home)

  const haystack =
    process.platform === 'win32'
      ? normalizedInput.toLowerCase()
      : normalizedInput
  const needle =
    process.platform === 'win32' ? normalizedHome.toLowerCase() : normalizedHome

  if (haystack.startsWith(needle)) {
    const relative = normalizedInput
      .slice(normalizedHome.length)
      .replace(/^[/\\]/, '')
    if (!relative.length) return '~'
    return `~${path.sep}${relative}`
  }

  const segments = normalizedInput.split(path.sep).filter(Boolean)
  if (segments.length <= 3) return normalizedInput
  return `${segments.slice(0, 1).join(path.sep)}${path.sep}...${path.sep}${segments
    .slice(-2)
    .join(path.sep)}`
}

export function toProjectName(worktree: string, directory: string): string {
  const fromWorktree = path.basename(worktree)
  if (fromWorktree && fromWorktree !== path.sep) return fromWorktree
  const fromDirectory = path.basename(directory)
  if (fromDirectory && fromDirectory !== path.sep) return fromDirectory
  return 'project'
}

export function firstLine(input: string): string {
  return input.split(/\r?\n/, 1)[0]?.trim() || ''
}
