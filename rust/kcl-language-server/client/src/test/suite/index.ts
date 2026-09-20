import * as path from 'path'
import { writeFile } from 'fs/promises'

const Mocha = require('mocha')
const { glob } = require('glob')

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
  })

  const testsRoot = path.resolve(__dirname, '..')

  const files: string[] = await glob('**/**.test.js', { cwd: testsRoot })
  files.forEach((file) => mocha.addFile(path.resolve(testsRoot, file)))

  const passed = await new Promise<number>((resolve, reject) => {
    const runner = mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`))
      } else if (!runner.stats?.passes) {
        reject(new Error('The extension test suite did not pass any tests'))
      } else {
        resolve(runner.stats.passes)
      }
    })
  })

  const completionPath = process.env['KCL_VSCODE_TEST_COMPLETION']
  if (completionPath) {
    await writeFile(completionPath, String(passed))
  }
}
