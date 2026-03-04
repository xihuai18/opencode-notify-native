import assert from 'node:assert/strict'
import test from 'node:test'

import { fnv1a32 } from '../hash.js'

test('fnv1a32 is deterministic (known constants)', () => {
  assert.equal(fnv1a32('test'), 2949673445)
  assert.equal(fnv1a32('hello'), 1335831723)
})
