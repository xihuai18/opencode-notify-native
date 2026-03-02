import path from 'node:path'
import os from 'node:os'

const TOKEN_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /ghp_[A-Za-z0-9]{10,}/g,
  /Bearer\s+[A-Za-z0-9._\-+/=]{10,}/gi,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
]

function clamp(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input
  return `${input.slice(0, Math.max(0, maxLength - 3))}...`
}

export function sanitizeText(
  input: string,
  options: { enabled: boolean; maxLength: number },
): string {
  const normalized = input.replace(/\r\n/g, '\n').trim()
  const maxLength = Math.max(60, options.maxLength)
  if (!options.enabled) return clamp(normalized, maxLength)

  let output = normalized
  for (const pattern of TOKEN_PATTERNS) {
    output = output.replace(pattern, '[REDACTED]')
  }
  return clamp(output, maxLength)
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

  if (normalizedInput.startsWith(normalizedHome)) {
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
