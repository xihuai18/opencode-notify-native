import path from "node:path"
import { appendFile, mkdir } from "node:fs/promises"

import type { QueueEntry } from "./types.js"

async function appendQueueEntry(filePath: string, entry: QueueEntry): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8")
}

type Pending = {
  entry: QueueEntry
  count: number
  timer: NodeJS.Timeout
}

type QueueDispatcherInput = {
  queuePath: string
  collapseWindowMs: number
  cooldownMs: number
}

export class QueueDispatcher {
  private readonly queuePath: string
  private readonly collapseWindowMs: number
  private readonly cooldownMs: number
  private readonly pending = new Map<string, Pending>()
  private readonly lastSent = new Map<string, number>()

  constructor(input: QueueDispatcherInput) {
    this.queuePath = input.queuePath
    this.collapseWindowMs = Math.max(0, input.collapseWindowMs)
    this.cooldownMs = Math.max(0, input.cooldownMs)
  }

  enqueue(entry: QueueEntry): void {
    if (!this.collapseWindowMs) {
      void this.flushImmediate(entry, 1)
      return
    }

    const found = this.pending.get(entry.dedupeKey)
    if (found) {
      found.entry = entry
      found.count += 1
      return
    }

    const timer = setTimeout(() => {
      void this.flushPending(entry.dedupeKey)
    }, this.collapseWindowMs)
    timer.unref?.()

    this.pending.set(entry.dedupeKey, {
      entry,
      count: 1,
      timer,
    })
  }

  private async flushPending(key: string): Promise<void> {
    const found = this.pending.get(key)
    if (!found) return

    this.pending.delete(key)
    clearTimeout(found.timer)
    await this.flushImmediate(found.entry, found.count)
  }

  private async flushImmediate(entry: QueueEntry, count: number): Promise<void> {
    const now = Date.now()
    const last = this.lastSent.get(entry.dedupeKey) || 0
    if (now - last < this.cooldownMs) return

    this.lastSent.set(entry.dedupeKey, now)

    const payload =
      count > 1
        ? {
            ...entry,
            count,
          }
        : entry

    try {
      await appendQueueEntry(this.queuePath, payload)
    } catch {
      // The plugin should never crash user sessions because of notifications.
    }
  }
}
