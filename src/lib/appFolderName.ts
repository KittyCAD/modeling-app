type AppFolderNameOptions = {
  packageName: string
  platform?: string
  isStaging: boolean
  isStagingOrDebug: boolean
  appIdBase?: string
}

export const getAppFolderName = ({
  packageName,
  platform,
  isStaging,
  isStagingOrDebug,
  appIdBase = 'dev.zoo.modeling-app',
}: AppFolderNameOptions) => {
  const normalizedPlatform = platform ?? 'unknown'
  const appId = isStaging
    ? `${appIdBase}-staging`
    : isStagingOrDebug
      ? `${appIdBase}-local`
      : appIdBase

  return normalizedPlatform === 'linux' ? packageName : appId
}
