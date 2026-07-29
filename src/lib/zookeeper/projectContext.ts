import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import type { FileMeta } from '@src/lib/types'

export function getZookeeperProjectFilesValidationError(
  projectFiles: readonly FileMeta[]
): Error | undefined {
  const nestedProjectSettings = projectFiles.find((file) => {
    const normalizedPath = file.relPath.replaceAll('\\', '/').toLowerCase()
    return normalizedPath.endsWith(
      `/${PROJECT_SETTINGS_FILE_NAME.toLowerCase()}`
    )
  })

  if (!nestedProjectSettings) {
    return undefined
  }

  return new Error(
    `Zookeeper cannot use nested projects. Move "${nestedProjectSettings.relPath}" into a separate top-level project folder and try again.`
  )
}
