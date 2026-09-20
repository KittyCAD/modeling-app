import { writeFile } from 'node:fs/promises'
import * as path from 'node:path'

const Mocha = require('mocha')
const { glob } = require('glob')

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
  })

  const testsRoot = path.resolve(__dirname, '..')

  const files: string[] = await glob('**/**.test.js', { cwd: testsRoot })
  if (files.length === 0) {
    throw new Error('No VS Code extension tests found')
  }
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file))
  }

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`))
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
