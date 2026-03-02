import path from "node:path"
import { createHash } from "node:crypto"
import { hostname } from "node:os"

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { NotifyEventType, QueueEntry } from "./types.js"

import { loadPluginConfig } from "./config.js"
import { classifyEvent } from "./classify.js"
import { QueueDispatcher } from "./queue.js"
import { createNotifyTools } from "./tools.js"
import { firstLine, sanitizeText, shortPath, toProjectName } from "./text.js"

function originKey(worktree: string): string {
  return createHash("sha256").update(worktree, "utf8").digest("hex").slice(0, 8)
}

function buildJumpUri(input: {
  extensionID: string
  ppid: number
  worktree: string
  directory: string
  sessionID?: string
  origin: string
}): string {
  const query = new URLSearchParams({
    ppid: String(input.ppid),
    worktree: input.worktree,
    directory: input.directory,
    origin: input.origin,
  })
  if (input.sessionID) query.set("sessionID", input.sessionID)
  return `vscode://${input.extensionID}/opencode-jump?${query.toString()}`
}

async function getSessionTitle(input: PluginInput, sessionID?: string): Promise<string | undefined> {
  if (!sessionID) return undefined
  try {
    const result = await input.client.session.get({
      path: { id: sessionID },
      query: { directory: input.directory },
      throwOnError: true,
    })
    return typeof result.data.title === "string" ? result.data.title : undefined
  } catch {
    return undefined
  }
}

function eventEnabled(
  event: NotifyEventType,
  config: Awaited<ReturnType<typeof loadPluginConfig>>,
): boolean {
  if (!config.enabled) return false
  if (event === "complete") return config.events.complete
  if (event === "error") return config.events.error
  return config.events.attention
}

function eventSound(
  event: NotifyEventType,
  config: Awaited<ReturnType<typeof loadPluginConfig>>,
) {
  if (event === "complete") return config.soundByEvent.complete
  if (event === "error") return config.soundByEvent.error
  return config.soundByEvent.attention
}

function makeBody(input: {
  host: string
  project: string
  origin: string
  sessionID?: string
  event: NotifyEventType
  summary: string
  directory: string
  showDirectory: boolean
}): string {
  const lines = [
    `From: ${input.host} · ${input.project} · ${input.origin}`,
    `Session: ${(input.sessionID || "global").slice(0, 8)} · ${input.event}`,
  ]
  if (input.showDirectory) lines.push(`Dir: ${input.directory}`)
  lines.push(`Note: ${input.summary}`)
  return lines.join("\n")
}

function testSummary(kind: NotifyEventType): string {
  if (kind === "complete") return "Test notification: task completed"
  if (kind === "error") return "Test notification: task failed"
  return "Test notification: your input is required"
}

export default async function OpenCodeNotifyPlugin(
  input: PluginInput,
): Promise<Hooks> {
  const config = await loadPluginConfig(input.worktree, input.directory)
  const host = hostname()
  const project = toProjectName(input.worktree, input.directory)
  const origin = originKey(input.worktree)
  const queuePath = path.join(input.worktree, config.queueFile)
  const statusPath = path.join(input.worktree, config.statusFile)

  const dispatcher = new QueueDispatcher({
    queuePath,
    collapseWindowMs: config.collapseWindowMs,
    cooldownMs: config.cooldownMs,
  })

  const enqueue = async (inputEvent: {
    event: NotifyEventType
    source: string
    summary: string
    sessionID?: string
    dedupeKey: string
  }) => {
    if (!eventEnabled(inputEvent.event, config)) return

    const summary = sanitizeText(firstLine(inputEvent.summary), {
      enabled: config.sanitize,
      maxLength: Math.max(60, config.maxBodyLength),
    })
    const sessionTitle = await getSessionTitle(input, inputEvent.sessionID)

    const entry: QueueEntry = {
      v: 1,
      ts: new Date().toISOString(),
      event: inputEvent.event,
      source: inputEvent.source,
      title: `OpenCode · ${project}`,
      body: sanitizeText(
        makeBody({
          host,
          project,
          origin,
          sessionID: inputEvent.sessionID,
          event: inputEvent.event,
          summary,
          directory: shortPath(input.directory),
          showDirectory: config.showDirectory,
        }),
        {
          enabled: config.sanitize,
          maxLength: config.maxBodyLength,
        },
      ),
      sessionID: inputEvent.sessionID,
      sessionTitle,
      host,
      project,
      directory: input.directory,
      worktree: input.worktree,
      origin,
      ppid: process.ppid,
      jumpUri: buildJumpUri({
        extensionID: config.extensionID,
        ppid: process.ppid,
        worktree: input.worktree,
        directory: input.directory,
        sessionID: inputEvent.sessionID,
        origin,
      }),
      sound: eventSound(inputEvent.event, config),
      dedupeKey: inputEvent.dedupeKey,
    }

    dispatcher.enqueue(entry)
  }

  const emitTest = async (event: NotifyEventType, sessionID: string) => {
    await enqueue({
      event,
      source: "tool.notify_test",
      summary: testSummary(event),
      sessionID,
      dedupeKey: `${event}:${sessionID || "global"}`,
    })
  }

  return {
    event: async ({ event }) => {
      try {
        const classified = classifyEvent(event)
        if (!classified) return
        await enqueue(classified)
      } catch {
        // Notification side effects should never block OpenCode flows.
      }
    },
    tool: createNotifyTools({
      config,
      queuePath,
      statusPath,
      emitTest,
    }),
  }
}
