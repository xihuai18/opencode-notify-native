import assert from 'node:assert/strict'
import test from 'node:test'

import {
  escapePango,
  escapeXml,
  fnv1a32,
  macSoundName,
  windowsAudioNode,
} from '../native.js'

test('escapeXml escapes XML special characters', () => {
  const input = `a&b<c>d"e'f`
  const out = escapeXml(input)
  assert.equal(out, 'a&amp;b&lt;c&gt;d&quot;e&apos;f')
})

test('escapePango escapes Pango markup characters', () => {
  const input = 'a&b<c>d'
  const out = escapePango(input)
  assert.equal(out, 'a&amp;b&lt;c&gt;d')
})

test('fnv1a32 is deterministic (known constants)', () => {
  assert.equal(fnv1a32('test'), 2949673445)
  assert.equal(fnv1a32('hello'), 1335831723)
})

test('windowsAudioNode maps boolean and named sounds', () => {
  assert.match(windowsAudioNode(false), /silent="true"/)
  assert.match(windowsAudioNode(true), /Notification\.Default/)
  assert.match(windowsAudioNode('attention'), /Notification\.SMS/)
  assert.match(windowsAudioNode('error'), /Notification\.Reminder/)
  assert.match(
    windowsAudioNode('ms-winsoundevent:Notification.Default'),
    /ms-winsoundevent:Notification\.Default/,
  )
})

test('macSoundName maps boolean and named sounds', () => {
  assert.equal(macSoundName('error', true), 'Basso')
  assert.equal(macSoundName('attention', true), 'Glass')
  assert.equal(macSoundName('complete', true), 'Funk')

  assert.equal(macSoundName('complete', 'attention'), 'Glass')
  assert.equal(macSoundName('complete', 'error'), 'Basso')
  assert.equal(macSoundName('complete', 'Ping'), 'Ping')
})
