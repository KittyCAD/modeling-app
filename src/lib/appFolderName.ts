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

export const getAppFolderName = ({
  packageName,
  platform,
  isStaging,
  isStagingOrDebug,
  appIdBase = 'dev.zoo.modeling-app',
}: AppFolderNameOptions) => {
  const appId = isStaging
    ? `${appIdBase}-staging`
    : isStagingOrDebug
      ? `${appIdBase}-local`
      : appIdBase

  return platform === 'linux' ? packageName : appId
}

export const getAppFolderNameFromBuild = ({
  packageName,
  packageVersion,
  platform,
  appIdBase,
}: AppFolderNameFromBuildOptions) => {
  const isStaging = packageName.includes('-staging')
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
