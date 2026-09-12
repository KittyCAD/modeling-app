import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { glob } from 'glob'
import Mocha from 'mocha'

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
  })

  const testsRoot = path.resolve(__dirname, '..')

  const files = await glob('**/**.test.js', { cwd: testsRoot })
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file))
  }

  const passed = await new Promise<number>((resolve, reject) => {
    const runner = mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`))
      } else if (!runner.stats?.passes) {
        reject(new Error('The extension test suite did not pass any tests'))
      } else {
        resolve(runner.stats.passes)
      }
    })
  })

  // The launcher uses a fresh profile for each run, so another run cannot
  // supply this completion marker. Manual extension-host runs need no marker.
  const { KCL_VSCODE_TEST_COMPLETION: completionPath } = process.env
  if (completionPath) {
    await writeFile(completionPath, String(passed))
  }
}
