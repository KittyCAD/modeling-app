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

type AppBuildOptions = Pick<
  AppFolderNameFromBuildOptions,
  'packageName' | 'packageVersion'
>

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

export const isStagingOrDebugAppBuild = ({
  packageName,
  packageVersion,
}: AppBuildOptions) => {
  return (
    packageName.includes('-staging') ||
    packageVersion === '0.0.0' ||
    packageVersion === 'dev'
  )
}

export const getAppFolderNameFromBuild = ({
  packageName,
  packageVersion,
  platform,
  appIdBase,
}: AppFolderNameFromBuildOptions) => {
  const isStaging = packageName.includes('-staging')
  const isStagingOrDebug = isStagingOrDebugAppBuild({
    packageName,
    packageVersion,
  })

  return getAppFolderName({
    packageName,
    platform,
    isStaging,
    isStagingOrDebug,
    appIdBase,
  })
}
