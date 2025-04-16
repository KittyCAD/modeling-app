import { systemIOActor } from '@src/machines/appMachine'

export const folderSnapshot = () => {
  const { folders } = systemIOActor.getSnapshot().context
  return folders
}

export const defaultProjectFolderNameSnapshot = () => {
  const { defaultProjectFolderName } = systemIOActor.getSnapshot().context
  return defaultProjectFolderName
}
