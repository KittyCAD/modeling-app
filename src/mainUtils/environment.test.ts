import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ENVIRONMENT_FILE_NAME } from '@src/lib/constants'
import {
  getEnvironmentFilePath,
  getEnvironmentFilePathSync,
  getMainAppFolderName,
  writeEnvironmentValueSync,
} from '@src/mainUtils/environment'

const createdPaths: string[] = []

afterEach(async () => {
  for (const createdPath of createdPaths.splice(0)) {
    await fs.promises.rm(createdPath, { recursive: true, force: true })
  }
})

describe('environment helpers', () => {
  it('creates the default environment file path under the app folder', async () => {
    const appDataPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'main-utils-env-')
    )
    createdPaths.push(appDataPath)

    const envPath = await getEnvironmentFilePath({ appDataPath })

    expect(envPath).toBe(
      path.join(appDataPath, getMainAppFolderName(), ENVIRONMENT_FILE_NAME)
    )
    await expect(fs.promises.stat(path.dirname(envPath))).resolves.toBeTruthy()
  })

  it('uses the test settings parent directory when provided', () => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'main-utils-test-'))
    createdPaths.push(testRoot)
    const testSettingsPath = path.join(testRoot, 'settings.json')

    const envPath = getEnvironmentFilePathSync({
      appDataPath: '/unused',
      testSettingsPath,
    })

    expect(envPath).toBe(path.join(testRoot, ENVIRONMENT_FILE_NAME))
  })

  it('writes trimmed environment values and skips blank ones', async () => {
    const appDataPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'main-utils-write-')
    )
    createdPaths.push(appDataPath)

    expect(
      writeEnvironmentValueSync({
        appDataPath,
        environment: '  dev.zoo.dev  ',
      })
    ).toBe(true)

    const envPath = path.join(
      appDataPath,
      getMainAppFolderName(),
      ENVIRONMENT_FILE_NAME
    )
    await expect(fs.promises.readFile(envPath, 'utf8')).resolves.toBe(
      'dev.zoo.dev'
    )

    expect(
      writeEnvironmentValueSync({
        appDataPath,
        environment: '   ',
      })
    ).toBe(false)
  })
})
