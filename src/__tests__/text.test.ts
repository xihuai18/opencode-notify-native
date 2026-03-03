import assert from 'node:assert/strict'
import test from 'node:test'

import { formatCollapsedBody, sanitizeText, shortPath } from '../text.js'

test('sanitizeText redacts token-like strings', () => {
  const output = sanitizeText('Bearer abcdefghijklmnopqrstuvwxyz', {
    enabled: true,
    maxLength: 120,
  })
  assert.match(output, /\[REDACTED\]/)
  assert.ok(!output.includes('abcdefghijklmnopqrstuvwxyz'))
})

test('sanitizeText clamps max length with ellipsis', () => {
  const input = 'x'.repeat(300)
  const output = sanitizeText(input, { enabled: false, maxLength: 200 })
  assert.ok(output.length <= 200)
  assert.ok(output.endsWith('...'))
})

test('sanitizeText strips control characters', () => {
  const output = sanitizeText('hello\u0000world\u0007', {
    enabled: false,
    maxLength: 120,
  })
  assert.ok(!output.includes('\u0000'))
  assert.ok(!output.includes('\u0007'))
  assert.match(output, /helloworld/)
})

test('sanitizeText redacts additional token formats', () => {
  const output = sanitizeText('token=github_pat_1234567890_ABCDEFGHIJ', {
    enabled: true,
    maxLength: 200,
  })
  assert.match(output, /\[REDACTED\]/)
  assert.ok(!output.includes('github_pat_'))
})

test('formatCollapsedBody preserves count suffix within max length', () => {
  const body = 'x'.repeat(200)
  const out = formatCollapsedBody(body, 3, { enabled: false, maxLength: 60 })
  assert.ok(out.length <= 60)
  assert.match(out, /\n\(x3\)$/)
})

test('shortPath keeps concise output', () => {
  const output = shortPath('/a/b/c/d/e')
  assert.ok(output.length > 0)
})
