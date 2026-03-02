import assert from "node:assert/strict"
import test from "node:test"

import { classifyEvent } from "../classify.js"

test("classify complete from session.status idle", () => {
  const event = {
    type: "session.status",
    properties: {
      sessionID: "ses_1",
      status: { type: "idle" },
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, "complete")
  assert.equal(classified?.dedupeKey, "complete:ses_1")
})

test("classify attention from permission.asked", () => {
  const event = {
    type: "permission.asked",
    properties: {
      sessionID: "ses_2",
      permission: "bash",
      patterns: ["git status"],
    },
  } as any

  const classified = classifyEvent(event)
  assert.ok(classified)
  assert.equal(classified?.event, "attention")
  assert.match(classified?.summary || "", /Permission required:/)
})

test("skip MessageAbortedError", () => {
  const event = {
    type: "session.error",
    properties: {
      sessionID: "ses_3",
      error: {
        name: "MessageAbortedError",
        data: { message: "aborted" },
      },
    },
  } as any

  const classified = classifyEvent(event)
  assert.equal(classified, null)
})
