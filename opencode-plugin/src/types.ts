export type NotifyEventType = 'complete' | 'error' | 'attention'
export type NotifySound = boolean | string

export type PluginConfig = {
  enabled: boolean
  sanitize: boolean
  maxBodyLength: number
  collapseWindowMs: number
  cooldownMs: number
  showDirectory: boolean
  showSessionId: boolean
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
  collapseKey: string
}
