import { systemIOActor } from '@src/lib/singletons'

export const folderSnapshot = () => {
  const { folders } = systemIOActor.getSnapshot().context
  return folders
}

export const defaultProjectFolderNameSnapshot = () => {
  const { defaultProjectFolderName } = systemIOActor.getSnapshot().context
  return defaultProjectFolderName
}
