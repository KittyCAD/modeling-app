import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'

const Mocha = require('mocha')
const { glob } = require('glob')
const EXPECTED_PASSES = 4

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
  })

  const testsRoot = path.resolve(__dirname, '..')

  const files: string[] = await glob('**/**.test.js', { cwd: testsRoot })
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file))
  }

  await new Promise<void>((resolve, reject) => {
    const runner = mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`))
      } else if (runner.stats?.passes !== EXPECTED_PASSES) {
        reject(
          new Error(
            `Expected ${EXPECTED_PASSES} passing VS Code extension tests, found ${runner.stats?.passes ?? 0}`
          )
        )
      } else {
        resolve()
      }
    })
  })

  const completionPath = process.env['KCL_VSCODE_TEST_COMPLETION']
  if (!completionPath) {
    throw new Error('Missing VS Code test completion path')
  }
  await writeFile(completionPath, '')
}
