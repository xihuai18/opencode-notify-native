export type NotifyEventType = "complete" | "error" | "attention"
export type NotifySound = boolean | string

export type QueueEntry = {
  v: 1
  ts: string
  event: NotifyEventType
  source: string
  title: string
  body: string
  sessionID?: string
  sessionTitle?: string
  host: string
  project: string
  directory: string
  worktree: string
  origin: string
  ppid: number
  jumpUri: string
  sound: NotifySound
  dedupeKey: string
  count?: number
}

export type PluginConfig = {
  enabled: boolean
  extensionID: string
  queueFile: string
  statusFile: string
  sanitize: boolean
  maxBodyLength: number
  collapseWindowMs: number
  cooldownMs: number
  showDirectory: boolean
  events: {
    complete: boolean
    error: boolean
    attention: boolean
  }
  soundByEvent: {
    complete: NotifySound
    error: NotifySound
    attention: NotifySound
  }
}

export type ClassifiedEvent = {
  event: NotifyEventType
  source: string
  summary: string
  sessionID?: string
  dedupeKey: string
}
