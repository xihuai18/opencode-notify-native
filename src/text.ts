import path from 'node:path'
import os from 'node:os'

const TOKEN_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /sk_(live|test)_[0-9a-zA-Z]{10,}/g,
  /rk_(live|test)_[0-9a-zA-Z]{10,}/g,
  /pk_(live|test)_[0-9a-zA-Z]{10,}/g,
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

const REDACTION_SCAN_LIMIT = 4096

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
    .replace(/\t/g, ' ')
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

  const scanLimit = Math.max(REDACTION_SCAN_LIMIT, maxLength + 64)

  const preCapped =
    normalized.length > scanLimit
      ? `${normalized.slice(0, scanLimit)}...`
      : normalized

  let output = preCapped
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
  const home = os.homedir()
  const normalizedInput = path.normalize(input)
  const normalizedHome = path.normalize(home)

  const haystack =
    process.platform === 'win32'
      ? normalizedInput.toLowerCase()
      : normalizedInput
  const needle =
    process.platform === 'win32' ? normalizedHome.toLowerCase() : normalizedHome

  const homeMatch =
    haystack === needle ||
    haystack.startsWith(
      needle.endsWith(path.sep) ? needle : `${needle}${path.sep}`,
    )

  if (homeMatch) {
    const relative = normalizedInput
      .slice(normalizedHome.length)
      .replace(/^[/\\]/, '')
    if (!relative.length) return '~'
    return `~${path.sep}${relative}`
  }

  const segments = normalizedInput.split(path.sep).filter(Boolean)
  if (segments.length <= 3) return normalizedInput

  let prefix = ''
  if (process.platform === 'win32') {
    if (normalizedInput.startsWith('\\\\')) prefix = '\\\\'
  } else if (normalizedInput.startsWith(path.sep)) {
    prefix = path.sep
  }

  const headCount = prefix === '\\\\' ? 2 : 1
  const first = segments.slice(0, headCount).join(path.sep)
  const tail = segments.slice(-2).join(path.sep)

  return `${prefix}${first}${path.sep}...${path.sep}${tail}`
}

export function toProjectName(worktree: string, directory: string): string {
  const fromWorktree = path.basename(worktree)
  if (fromWorktree) return fromWorktree
  const fromDirectory = path.basename(directory)
  if (fromDirectory) return fromDirectory
  return 'project'
}

export function firstLine(input: string): string {
  return input.split(/\r?\n/, 1)[0]?.trim() || ''
}
