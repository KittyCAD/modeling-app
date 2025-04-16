import { systemIOActor } from '@src/machines/appMachine'

export const folderSnapshot = () => {
  const { folders } = systemIOActor.getSnapshot().context
  return folders
}
