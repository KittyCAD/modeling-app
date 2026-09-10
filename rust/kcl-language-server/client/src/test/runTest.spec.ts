import * as assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { suite, test } from 'mocha'

suite('VS Code suite completion', () => {
  for (const scenario of [
    'no-suite',
    'passing',
    'failing',
    'empty',
    'discovery-error',
  ]) {
    test(`reports the suite outcome for ${scenario}`, async () => {
      const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'kcl-ls-runner-'))
      const loader = path.join(fixtureDir, 'launcher.cjs')
      const testFile = path.join(fixtureDir, 'fixture.test.js')
      try {
        await writeFile(
          testFile,
          scenario === 'empty'
            ? ''
            : `suite('Fixture', () => test('runs', () => {
                ${scenario === 'failing' ? "throw new Error('fixture failure')" : ''}
              }))`
        )
        // Replace only the process-launch boundary and test discovery. The child
        // executes the real launcher, suite runner, Mocha, and profile cleanup.
        await writeFile(
          loader,
          `const Module = require('module')
           const originalLoad = Module._load
           Module._load = function (id, ...args) {
             if (id === '@vscode/test-electron') return {
               runTests: async (options) => {
                 if (${JSON.stringify(scenario)} === 'no-suite') return
                 Object.assign(process.env, options.extensionTestsEnv)
                 await require(options.extensionTestsPath).run()
               }
             }
             if (id === 'glob') return {
               glob: async () => {
                 if (${JSON.stringify(scenario)} === 'discovery-error') {
                   throw new Error('fixture discovery failure')
                 }
                 return [${JSON.stringify(testFile)}]
               }
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
        assert.strictEqual(result.signal, null)
        assert.strictEqual(
          result.status,
          scenario === 'passing' ? 0 : 1,
          result.stdout + result.stderr
        )
        const expectedOutput =
          scenario === 'no-suite'
            ? 'VS Code exited without completing the extension test suite'
            : scenario === 'passing'
              ? '1 passing'
              : scenario === 'failing'
                ? 'fixture failure'
                : scenario === 'empty'
                  ? 'The extension test suite did not pass any tests'
                  : 'fixture discovery failure'
        assert.ok((result.stdout + result.stderr).includes(expectedOutput))
      } finally {
        await rm(fixtureDir, { recursive: true, force: true })
      }
    }).timeout(15_000)
  }
})
