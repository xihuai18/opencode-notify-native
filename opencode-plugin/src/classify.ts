import type { Event } from "@opencode-ai/sdk"

import type { ClassifiedEvent } from "./types.js"
import { summarizeError } from "./text.js"

type RawEvent = {
  type: string
  properties?: unknown
}

function makeKey(kind: ClassifiedEvent["event"], sessionID?: string): string {
  return `${kind}:${sessionID || "global"}`
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function classifySessionStatus(event: Event): ClassifiedEvent | null {
  if (event.type !== "session.status") return null
  if (!isRecord(event.properties)) return null
  const status = isRecord(event.properties.status) ? event.properties.status : null
  if (!status || status.type !== "idle") return null
  const sessionID =
    typeof event.properties.sessionID === "string"
      ? event.properties.sessionID
      : undefined
  return {
    event: "complete",
    source: event.type,
    summary: "Task completed",
    sessionID,
    dedupeKey: makeKey("complete", sessionID),
  }
}

function classifySessionError(event: Event): ClassifiedEvent | null {
  if (event.type !== "session.error") return null
  if (!isRecord(event.properties)) return null
  const name =
    typeof event.properties.error === "object" &&
    event.properties.error &&
    "name" in event.properties.error
      ? String(event.properties.error.name)
      : ""
  if (name === "MessageAbortedError") return null

  const sessionID =
    typeof event.properties.sessionID === "string"
      ? event.properties.sessionID
      : undefined
  return {
    event: "error",
    source: event.type,
    summary: summarizeError(event.properties.error),
    sessionID,
    dedupeKey: makeKey("error", sessionID),
  }
}

function classifyPermissionAsked(event: RawEvent): ClassifiedEvent | null {
  if (event.type !== "permission.asked") return null
  if (!isRecord(event.properties)) return null
  const sessionID =
    typeof event.properties.sessionID === "string"
      ? event.properties.sessionID
      : undefined
  const firstPattern = Array.isArray(event.properties.patterns)
    ? event.properties.patterns[0]
    : undefined
  const suffix = typeof firstPattern === "string" ? ` (${firstPattern})` : ""
  const permission =
    typeof event.properties.permission === "string"
      ? event.properties.permission
      : "action"

  return {
    event: "attention",
    source: event.type,
    summary: `Permission required: ${permission}${suffix}`,
    sessionID,
    dedupeKey: makeKey("attention", sessionID),
  }
}

function classifyQuestionAsked(event: RawEvent): ClassifiedEvent | null {
  if (event.type !== "question.asked") return null
  if (!isRecord(event.properties)) return null
  const sessionID =
    typeof event.properties.sessionID === "string"
      ? event.properties.sessionID
      : undefined
  const firstQuestion = Array.isArray(event.properties.questions)
    ? event.properties.questions[0]
    : undefined
  const header =
    isRecord(firstQuestion) && typeof firstQuestion.header === "string"
      ? firstQuestion.header
      : "Input required"
  return {
    event: "attention",
    source: event.type,
    summary: `Input required: ${header}`,
    sessionID,
    dedupeKey: makeKey("attention", sessionID),
  }
}

export function classifyEvent(event: Event): ClassifiedEvent | null {
  const raw = event as unknown as RawEvent
  if (event.type === "session.status") return classifySessionStatus(event)
  if (event.type === "session.error") return classifySessionError(event)
  if (raw.type === "permission.asked") {
    return classifyPermissionAsked(raw)
  }
  if (raw.type === "question.asked") {
    return classifyQuestionAsked(raw)
  }
  return null
}
