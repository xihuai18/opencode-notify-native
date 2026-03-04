import os from 'node:os'
import path from 'node:path'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  firstLine,
  formatCollapsedBody,
  sanitizeText,
  shortPath,
  summarizeError,
  toProjectName,
} from '../text.js'

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

test('sanitizeText pre-caps very large payload before redaction scan', () => {
  const input = `Bearer token_abcdefghijklmnopqrstuvwxyz ${'x'.repeat(20_000)}`
  const output = sanitizeText(input, {
    enabled: true,
    maxLength: 400,
  })
  assert.ok(output.length <= 400)
  assert.match(output, /\[REDACTED\]/)
})

test('formatCollapsedBody preserves count suffix within max length', () => {
  const body = 'x'.repeat(200)
  const out = formatCollapsedBody(body, 3, { enabled: false, maxLength: 60 })
  assert.ok(out.length <= 60)
  assert.match(out, /\n\(x3\)$/)
})

test('shortPath keeps concise output', () => {
  const input =
    process.platform === 'win32' ? 'C:\\a\\b\\c\\d\\e' : '/a/b/c/d/e'
  const output = shortPath(input)
  assert.ok(output.length > 0)
  if (process.platform === 'win32') {
    assert.match(output, /^[A-Za-z]:\\/)
  } else {
    assert.ok(output.startsWith('/'))
  }
})

test('shortPath renders home-relative path with tilde', () => {
  const input = path.join(os.homedir(), 'a', 'b', 'c', 'd')
  const output = shortPath(input)
  assert.match(output, /^~/)
})

test('shortPath preserves UNC share prefix when shortened', () => {
  if (process.platform !== 'win32') return
  const output = shortPath('\\\\server\\share\\a\\b\\c\\d')
  assert.match(output, /^\\\\server\\share\\\.\.\./)
})

test('toProjectName falls back to project for root paths', () => {
  const root = path.parse(process.cwd()).root
  assert.equal(toProjectName(root, root), 'project')
})

test('firstLine returns trimmed first line', () => {
  assert.equal(firstLine('  hello world  \nsecond'), 'hello world')
})

test('summarizeError prefers data.message over message', () => {
  const message = summarizeError({
    data: { message: 'from data' },
    message: 'from message',
  })
  assert.equal(message, 'from data')
})
