import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runTests } from '@vscode/test-electron'
import { removeVSCodeProfile } from './vscodeProfile'

function createShortVSCodeProfileDir() {
  const tempRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp'
  return fs.mkdtempSync(path.join(tempRoot, 'kcl-ls-'))
}

async function main() {
  const vscodeProfileDir = createShortVSCodeProfileDir()
  const completionPath = path.join(vscodeProfileDir, 'suite-completed')

  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../../')

    // The path to the extension test runner script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index')

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: { KCL_VSCODE_TEST_COMPLETION: completionPath },
      launchArgs: [
        `--user-data-dir=${path.join(vscodeProfileDir, 'user-data')}`,
        `--extensions-dir=${path.join(vscodeProfileDir, 'extensions')}`,
      ],
    })

    // VS Code can exit successfully without finishing the extension host tests.
    if (!fs.existsSync(completionPath)) {
      console.error(
        'VS Code exited without completing the extension test suite'
      )
      process.exitCode = 1
      return
    }
    const passed = Number(fs.readFileSync(completionPath, 'utf8'))
    if (!Number.isSafeInteger(passed) || passed <= 0) {
      console.error('Invalid VS Code extension test completion count')
      process.exitCode = 1
      return
    }
    // Report from the parent too: the launcher can close the child's output
    // streams before its last console messages have been forwarded on Windows.
    console.log(`VS Code extension tests: ${passed} passed`)
  } catch (err) {
    console.error(err)
    console.error('Failed to run tests')
    process.exitCode = 1
  } finally {
    await removeVSCodeProfile(vscodeProfileDir)
  }
}

/* eslint-disable */
main()
