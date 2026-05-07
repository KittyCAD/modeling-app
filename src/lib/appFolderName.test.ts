import { describe, expect, it } from 'vitest'

import {
  getAppFolderNameFromBuild,
  isStagingOrDebugAppBuild,
} from '@src/lib/appFolderName'

type AppFolderNameFromBuildCase = {
  name: string
  input: Parameters<typeof getAppFolderNameFromBuild>[0]
  expected: string
}

const cases: AppFolderNameFromBuildCase[] = [
  {
    name: 'uses the production app id for versioned macOS builds',
    input: {
      packageName: 'zoo-modeling-app',
      packageVersion: '1.2.3',
      platform: 'darwin',
    },
    expected: 'dev.zoo.modeling-app',
  },
  {
    name: 'uses the staging app id for staging builds',
    input: {
      packageName: 'zoo-modeling-app-staging',
      packageVersion: '1.2.3',
      platform: 'darwin',
    },
    expected: 'dev.zoo.modeling-app-staging',
  },
  {
    name: 'uses the local app id for unversioned debug builds',
    input: {
      packageName: 'zoo-modeling-app',
      packageVersion: '0.0.0',
      platform: 'darwin',
    },
    expected: 'dev.zoo.modeling-app-local',
  },
  {
    name: 'uses the local app id for dev builds',
    input: {
      packageName: 'zoo-modeling-app',
      packageVersion: 'dev',
      platform: 'win32',
    },
    expected: 'dev.zoo.modeling-app-local',
  },
  {
    name: 'preserves the package name on Linux',
    input: {
      packageName: 'zoo-modeling-app-staging',
      packageVersion: '1.2.3',
      platform: 'linux',
    },
    expected: 'zoo-modeling-app-staging',
  },
  {
    name: 'uses custom app id bases for non-Linux builds',
    input: {
      packageName: 'zoo-modeling-app',
      packageVersion: 'dev',
      platform: 'darwin',
      appIdBase: 'corp.zoo.design-studio',
    },
    expected: 'corp.zoo.design-studio-local',
  },
]

describe('getAppFolderNameFromBuild', () => {
  it.each(cases)('$name', ({ input, expected }) => {
    expect(getAppFolderNameFromBuild(input)).toBe(expected)
  })
})

describe('isStagingOrDebugAppBuild', () => {
  it.each([
    {
      packageName: 'zoo-modeling-app',
      packageVersion: '1.2.3',
      expected: false,
    },
    {
      packageName: 'zoo-modeling-app-staging',
      packageVersion: '1.2.3',
      expected: true,
    },
    {
      packageName: 'zoo-modeling-app',
      packageVersion: '0.0.0',
      expected: true,
    },
    {
      packageName: 'zoo-modeling-app',
      packageVersion: 'dev',
      expected: true,
    },
  ])(
    'returns $expected for $packageName@$packageVersion',
    ({ packageName, packageVersion, expected }) => {
      expect(
        isStagingOrDebugAppBuild({
          packageName,
          packageVersion,
        })
      ).toBe(expected)
    }
  )
})
