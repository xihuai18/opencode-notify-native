import assert from "node:assert/strict"
import test from "node:test"

import { sanitizeText, shortPath } from "../text.js"

test("sanitizeText redacts token-like strings", () => {
  const output = sanitizeText("Bearer abcdefghijklmnopqrstuvwxyz", {
    enabled: true,
    maxLength: 120,
  })
  assert.match(output, /\[REDACTED\]/)
  assert.ok(!output.includes("abcdefghijklmnopqrstuvwxyz"))
})

test("sanitizeText clamps max length with ellipsis", () => {
  const input = "x".repeat(300)
  const output = sanitizeText(input, { enabled: false, maxLength: 200 })
  assert.ok(output.length <= 200)
  assert.ok(output.endsWith("..."))
})

test("shortPath keeps concise output", () => {
  const output = shortPath("/a/b/c/d/e")
  assert.ok(output.length > 0)
})
