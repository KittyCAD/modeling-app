import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-ignore: TS1343
import * as packageJSON from '@root/package.json'

import {
  STAGING_BUILD_SUFFIX,
  getAppFolderNameFromBuild,
} from '@src/lib/appFolderName'
import { ENVIRONMENT_FILE_NAME } from '@src/lib/constants'

type EnvironmentPathOptions = {
  appDataPath: string
  testSettingsPath?: string
}

export const isStagingBuild = packageJSON.name.includes(STAGING_BUILD_SUFFIX)
export const isStagingOrDebugBuild =
  isStagingBuild ||
  packageJSON.version === '0.0.0' ||
  packageJSON.version === 'dev'

export const getMainAppFolderName = () => {
  return getAppFolderNameFromBuild({
    packageName: packageJSON.name,
    packageVersion: packageJSON.version,
    platform: os.platform(),
  })
}

const getEnvironmentDirectoryPath = ({
  appDataPath,
  testSettingsPath,
}: EnvironmentPathOptions) => {
  if (testSettingsPath) {
    return path.resolve(testSettingsPath, '..')
  }

  return path.join(appDataPath, getMainAppFolderName())
}

export const getEnvironmentFilePath = async ({
  appDataPath,
  testSettingsPath,
}: EnvironmentPathOptions) => {
  const fullPath = getEnvironmentDirectoryPath({
    appDataPath,
    testSettingsPath,
  })

  try {
    await fs.promises.stat(fullPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.promises.mkdir(fullPath, { recursive: true })
    } else {
      return Promise.reject(error)
    }
  }

  return path.join(fullPath, ENVIRONMENT_FILE_NAME)
}

export const getEnvironmentFilePathSync = ({
  appDataPath,
  testSettingsPath,
}: EnvironmentPathOptions) => {
  const fullPath = getEnvironmentDirectoryPath({
    appDataPath,
    testSettingsPath,
  })

  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true })
  }

  return path.join(fullPath, ENVIRONMENT_FILE_NAME)
}

export const writeEnvironmentValueSync = ({
  appDataPath,
  environment,
  testSettingsPath,
}: EnvironmentPathOptions & { environment: string }) => {
  const trimmed = environment.trim()
  if (!trimmed) {
    return false
  }

  const envPath = getEnvironmentFilePathSync({
    appDataPath,
    testSettingsPath,
  })
  fs.writeFileSync(envPath, trimmed, 'utf8')
  return true
}
