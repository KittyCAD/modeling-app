import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { runVSCodeTests } from './runTest'

suite('VS Code test launcher', () => {
  test('fails if the extension host exits before running the suite', async () => {
    await assert.rejects(
      runVSCodeTests(async () => 0),
      /VS Code exited without completing the extension tests/
    )
  })
})
