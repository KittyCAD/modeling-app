import * as path from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { runTests } from '@vscode/test-electron'

async function main() {
  let userDataDir: string | undefined
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../')

    // The path to the extension test runner script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index')

    // Download VS Code, unzip it and run the integration test
    // Keep VS Code's Unix socket path below macOS's 103-character limit.
    userDataDir = await mkdtemp(path.join(tmpdir(), 'kcl-lsp-'))
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [`--user-data-dir=${userDataDir}`],
    })
  } catch (err) {
    console.error(err)
    console.error('Failed to run tests')
    process.exitCode = 1
  } finally {
    if (userDataDir) {
      await rm(userDataDir, { recursive: true, force: true })
    }
  }
}

/* eslint-disable */
main()
