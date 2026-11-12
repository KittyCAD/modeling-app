/* eslint suggest-no-throw/suggest-no-throw: 0 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runTests } from '@vscode/test-electron'
import { removeVSCodeProfile } from './vscodeProfile'

function createShortVSCodeProfileDir() {
  const tempRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp'
  return fs.mkdtempSync(path.join(tempRoot, 'kcl-ls-'))
}

export async function runVSCodeTests(launchVSCode = runTests) {
  const vscodeProfileDir = createShortVSCodeProfileDir()
  const completionPath = path.join(vscodeProfileDir, 'suite-completed')

  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    // This file is compiled to <extension>/dist/client/src/test/runTest.js, so
    // the manifest is four levels up. Pointing anywhere inside dist/ leaves the
    // extension unloaded and vscode.extensions.getExtension returning undefined.
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../../')
    const serverPath = path.resolve(
      extensionDevelopmentPath,
      '../target/debug',
      process.platform === 'win32'
        ? 'kcl-language-server.exe'
        : 'kcl-language-server'
    )

    // The path to the extension test runner script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index')

    // Download VS Code, unzip it and run the integration test
    await launchVSCode({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        KCL_VSCODE_TEST_COMPLETION: completionPath,
        __KCL_LSP_SERVER_DEBUG: serverPath,
      },
      launchArgs: [
        `--user-data-dir=${path.join(vscodeProfileDir, 'user-data')}`,
        `--extensions-dir=${path.join(vscodeProfileDir, 'extensions')}`,
      ],
    })

    if (!fs.existsSync(completionPath)) {
      throw new Error('VS Code exited without completing the extension tests')
    }
  } finally {
    await removeVSCodeProfile(vscodeProfileDir)
  }
}

async function main() {
  try {
    await runVSCodeTests()
  } catch (err) {
    console.error(err)
    console.error('Failed to run tests')
    process.exitCode = 1
  }
}

/* eslint-disable */
if (require.main === module) {
  main()
}
