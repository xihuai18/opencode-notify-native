import type { NotifyEventType, NotifySound } from './types.js'
import { debugWarn } from './debug.js'

function visibleWarn(message: string): void {
  try {
    process.stderr.write(`[notify-native] Warning: ${message}\n`)
  } catch {
    // Best-effort only.
  }
}

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

type QueuedSend = {
  payload: NotifyPayload
  count: number
}

type DispatcherInput = {
  collapseWindowMs: number
  cooldownMs: number
  maxInFlight?: number
  // `count` is the number of collapsed notifications (>= 1).
  // Formatting/clamping is intentionally delegated to the caller so it can
  // enforce config-driven limits (e.g. maxBodyLength) *after* collapse.
  // Return true if a notification was successfully delivered.
  send: (payload: NotifyPayload, count: number) => Promise<boolean>
}

export class NotifyDispatcher {
  private readonly collapseWindowMs: number
  private readonly cooldownMs: number
  private readonly maxInFlight: number
  private readonly send: (
    payload: NotifyPayload,
    count: number,
  ) => Promise<boolean>
  private readonly pending = new Map<string, Pending>()
  private readonly lastSent = new Map<string, number>()
  private readonly activeKeys = new Set<string>()
  private readonly queuedAfterActive = new Map<string, QueuedSend>()
  private disposed = false
  private dropWarned = false
  private inFlight = 0
  private sendCounter = 0

  constructor(input: DispatcherInput) {
    this.collapseWindowMs = Math.max(0, input.collapseWindowMs)
    this.cooldownMs = Math.max(0, input.cooldownMs)
    this.maxInFlight = Math.max(1, Math.floor(input.maxInFlight ?? 3))
    this.send = input.send
  }

  enqueue(payload: NotifyPayload): void {
    if (this.disposed) return

    if (!this.collapseWindowMs) {
      // Defer work off the event hook call stack.
      queueMicrotask(() => {
        void this.flushNow(payload, 1).catch((error) => {
          debugWarn(
            `flushNow failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
      })
      return
    }

    const found = this.pending.get(payload.collapseKey)
    if (found) {
      found.payload = payload
      found.count += 1
      return
    }

    const timer = setTimeout(() => {
      void this.flushPending(payload.collapseKey).catch((error) => {
        debugWarn(
          `flushPending failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
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
    if (this.disposed) return

    const found = this.pending.get(key)
    if (!found) return

    this.pending.delete(key)
    clearTimeout(found.timer)
    await this.flushNow(found.payload, found.count)
  }

  private async flushNow(payload: NotifyPayload, count: number): Promise<void> {
    if (this.disposed) return

    const now = Date.now()
    const last = this.lastSent.get(payload.collapseKey) || 0
    if (now - last < this.cooldownMs) return
    if (this.activeKeys.has(payload.collapseKey)) {
      const existing = this.queuedAfterActive.get(payload.collapseKey)
      if (existing) {
        existing.payload = payload
        existing.count += count
      } else {
        this.queuedAfterActive.set(payload.collapseKey, { payload, count })
      }
      return
    }

    // Prefer dropping low-value completion spam over spawning many processes.
    // For attention/error we allow a higher in-flight ceiling, but still cap it.
    const inFlightLimit =
      payload.event === 'complete' ? this.maxInFlight : this.maxInFlight * 3
    if (this.inFlight >= inFlightLimit) {
      if (!this.dropWarned) {
        this.dropWarned = true
        visibleWarn(
          'notification rate exceeded local concurrency limit; some notifications may be dropped',
        )
      }
      debugWarn(
        `Drop notification due to in-flight limit: event=${payload.event} key=${payload.collapseKey}`,
      )
      return
    }

    this.activeKeys.add(payload.collapseKey)
    this.inFlight += 1
    try {
      const delivered = await this.send(payload, count)
      if (delivered) {
        this.lastSent.set(payload.collapseKey, Date.now())
        this.sendCounter += 1
        if (this.sendCounter % 50 === 0) {
          this.pruneLastSent(now)
        }
      }
    } catch (error) {
      debugWarn(
        `send failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      // Notification failures should never break conversation flow.
    } finally {
      this.inFlight -= 1
      if (this.inFlight === 0) this.dropWarned = false
      this.activeKeys.delete(payload.collapseKey)

      const queued = this.queuedAfterActive.get(payload.collapseKey)
      if (queued) {
        this.queuedAfterActive.delete(payload.collapseKey)
        queueMicrotask(() => {
          void this.flushNow(queued.payload, queued.count).catch((error) => {
            debugWarn(
              `queued flush failed: ${error instanceof Error ? error.message : String(error)}`,
            )
          })
        })
      }
    }
  }

  private pruneLastSent(now: number): void {
    if (this.lastSent.size < 400) return
    const cutoff = now - Math.max(this.cooldownMs * 2, 10 * 60_000)
    // Map iteration remains stable while deleting the current key.
    for (const [key, ts] of this.lastSent) {
      if (ts < cutoff) this.lastSent.delete(key)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
    }
    this.pending.clear()
    this.queuedAfterActive.clear()
    this.activeKeys.clear()
    this.lastSent.clear()
  }
}
