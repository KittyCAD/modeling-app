type AppFolderNameOptions = {
  packageName: string
  platform: string
  isStaging: boolean
  isStagingOrDebug: boolean
  appIdBase?: string
}

type AppFolderNameFromBuildOptions = {
  packageName: string
  packageVersion: string
  platform: string
  appIdBase?: string
}

export const STAGING_BUILD_SUFFIX = '-staging'

export const getAppFolderName = ({
  packageName,
  platform,
  isStaging,
  isStagingOrDebug,
  appIdBase = 'dev.zoo.modeling-app',
}: AppFolderNameOptions) => {
  if (platform === 'linux') {
    return isStagingOrDebug && !isStaging ? `${packageName}-local` : packageName
  }

  const appId = isStaging
    ? `${appIdBase}${STAGING_BUILD_SUFFIX}`
    : isStagingOrDebug
      ? `${appIdBase}-local`
      : appIdBase

  return appId
}

export const getAppFolderNameFromBuild = ({
  packageName,
  packageVersion,
  platform,
  appIdBase,
}: AppFolderNameFromBuildOptions) => {
  const isStaging = packageName.includes(STAGING_BUILD_SUFFIX)
  const isStagingOrDebug =
    isStaging || packageVersion === '0.0.0' || packageVersion === 'dev'

  return getAppFolderName({
    packageName,
    platform,
    isStaging,
    isStagingOrDebug,
    appIdBase,
  })
}
