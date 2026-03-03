import type { NotifyEventType, NotifySound } from './types.js'

export type NotifyPayload = {
  event: NotifyEventType
  title: string
  body: string
  sound: NotifySound
  collapseKey: string
  replaceKey: string
}

type Pending = {
  payload: NotifyPayload
  count: number
  timer: NodeJS.Timeout
}

type DispatcherInput = {
  collapseWindowMs: number
  cooldownMs: number
  // `count` is the number of collapsed notifications (>= 1).
  // Formatting/clamping is intentionally delegated to the caller so it can
  // enforce config-driven limits (e.g. maxBodyLength) *after* collapse.
  send: (payload: NotifyPayload, count: number) => Promise<void>
}

export class NotifyDispatcher {
  private readonly collapseWindowMs: number
  private readonly cooldownMs: number
  private readonly send: (
    payload: NotifyPayload,
    count: number,
  ) => Promise<void>
  private readonly pending = new Map<string, Pending>()
  private readonly lastSent = new Map<string, number>()
  private sendCounter = 0

  constructor(input: DispatcherInput) {
    this.collapseWindowMs = Math.max(0, input.collapseWindowMs)
    this.cooldownMs = Math.max(0, input.cooldownMs)
    this.send = input.send
  }

  enqueue(payload: NotifyPayload): void {
    if (!this.collapseWindowMs) {
      void this.flushNow(payload, 1).catch(() => {})
      return
    }

    const found = this.pending.get(payload.collapseKey)
    if (found) {
      found.payload = payload
      found.count += 1
      return
    }

    const timer = setTimeout(() => {
      void this.flushPending(payload.collapseKey).catch(() => {})
    }, this.collapseWindowMs)
    // Keep OpenCode shutdown fast; ok to drop last collapsed notification.
    timer.unref?.()

    this.pending.set(payload.collapseKey, {
      payload,
      count: 1,
      timer,
    })
  }

  private async flushPending(key: string): Promise<void> {
    const found = this.pending.get(key)
    if (!found) return

    this.pending.delete(key)
    clearTimeout(found.timer)
    await this.flushNow(found.payload, found.count)
  }

  private async flushNow(payload: NotifyPayload, count: number): Promise<void> {
    const now = Date.now()
    const last = this.lastSent.get(payload.collapseKey) || 0
    if (now - last < this.cooldownMs) return

    this.lastSent.set(payload.collapseKey, now)
    this.sendCounter += 1
    if (this.sendCounter % 50 === 0) {
      this.pruneLastSent(now)
    }

    try {
      await this.send(payload, count)
    } catch {
      // Notification failures should never break conversation flow.
    }
  }

  private pruneLastSent(now: number): void {
    if (this.lastSent.size < 400) return
    const cutoff = now - Math.max(this.cooldownMs * 2, 10 * 60_000)
    for (const [key, ts] of this.lastSent) {
      if (ts < cutoff) this.lastSent.delete(key)
    }
  }
}
