import * as assert from 'assert'
import { spawnSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { suite, test } from 'mocha'

suite('VS Code suite completion', () => {
  test('fails if the extension host exits before running the suite', async () => {
    const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'kcl-ls-runner-'))
    const loader = path.join(fixtureDir, 'launcher.cjs')

    try {
      await writeFile(
        loader,
        `const Module = require('module')
         const originalLoad = Module._load
         Module._load = function (id, ...args) {
           if (id === '@vscode/test-electron') {
             return { runTests: async () => {} }
           }
           return originalLoad.call(this, id, ...args)
         }`
      )
      const result = spawnSync(
        process.execPath,
        ['--require', loader, path.join(__dirname, 'runTest.js')],
        { encoding: 'utf8', timeout: 10_000 }
      )

      assert.ifError(result.error)
      assert.strictEqual(result.status, 1, result.stdout + result.stderr)
      assert.match(
        result.stdout + result.stderr,
        /VS Code exited without completing the extension test suite/
      )
    } finally {
      await rm(fixtureDir, { recursive: true, force: true })
    }
  }).timeout(15_000)
})
