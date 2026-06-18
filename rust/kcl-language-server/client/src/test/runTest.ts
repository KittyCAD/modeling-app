import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runTests } from '@vscode/test-electron'

function createShortVSCodeProfileDir() {
  const tempRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp'
  return fs.mkdtempSync(path.join(tempRoot, 'kcl-ls-'))
}

async function main() {
  const vscodeProfileDir = createShortVSCodeProfileDir()

  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../')

    // The path to the extension test runner script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index')

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        `--user-data-dir=${path.join(vscodeProfileDir, 'user-data')}`,
        `--extensions-dir=${path.join(vscodeProfileDir, 'extensions')}`,
      ],
    })
  } catch (err) {
    console.error(err)
    console.error('Failed to run tests')
    process.exitCode = 1
  } finally {
    fs.rmSync(vscodeProfileDir, { force: true, recursive: true })
  }
}

/* eslint-disable */
main()
