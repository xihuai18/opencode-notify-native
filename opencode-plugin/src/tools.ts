import { readFile, stat } from "node:fs/promises"

import { tool } from "@opencode-ai/plugin/tool"

import type { NotifyEventType, PluginConfig } from "./types.js"

const z = tool.schema

type NotifyToolsInput = {
  config: PluginConfig
  queuePath: string
  statusPath: string
  emitTest: (event: NotifyEventType, sessionID: string) => Promise<void>
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const info = await stat(filePath)
    return info.size
  } catch {
    return 0
  }
}

async function readStatusFile(statusPath: string): Promise<string> {
  try {
    const content = await readFile(statusPath, "utf8")
    return content
  } catch {
    return "(missing)"
  }
}

export function createNotifyTools(input: NotifyToolsInput) {
  return {
    notify_test: tool({
      description:
        "Write a test notification event into the queue for complete/error/attention.",
      args: {
        event: z.enum(["complete", "error", "attention"]).optional(),
      },
      execute: async (args, context) => {
        const kind = args.event || "attention"
        await input.emitTest(kind, context.sessionID)
        return `notify_test queued: ${kind}`
      },
    }),

    notify_check: tool({
      description: "Show queue/status diagnostics for OpenCode notifications.",
      args: {},
      execute: async () => {
        const [queueBytes, statusContent] = await Promise.all([
          fileSize(input.queuePath),
          readStatusFile(input.statusPath),
        ])

        const lines = [
          "# OpenCode Notify Diagnostics",
          `- enabled: ${input.config.enabled ? "true" : "false"}`,
          `- extensionID: ${input.config.extensionID}`,
          `- queuePath: ${input.queuePath}`,
          `- queueBytes: ${queueBytes}`,
          `- statusPath: ${input.statusPath}`,
          "- status:",
          "```json",
          statusContent,
          "```",
        ]

        return lines.join("\n")
      },
    }),
  }
}
