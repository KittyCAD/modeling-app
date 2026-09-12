import path from 'node:path'

export const getWindowIconPath = ({
  isPackaged,
  resourcesPath,
  workingDirectory,
}: {
  isPackaged: boolean
  resourcesPath: string
  workingDirectory: string
}) =>
  isPackaged
    ? path.join(resourcesPath, 'icon.png')
    : path.join(workingDirectory, 'assets', 'icon.png')
