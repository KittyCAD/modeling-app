import fsZds from '@src/lib/fs-zds'
import type {
  Project,
  ProjectDirectory,
} from '@src/lib/projectSession/next/types'
import type { ProjectArchiveFile } from '@src/lib/cloudProjects/runtime/types'
import { readProjectMetadataFromToml } from '@src/lib/projectTomlMetadata'
import { webSafePathSplit } from '@src/lib/pathUtils'
import {
  CLOUD_DIRECTORIES_FILE,
  decodeCloudDirectories,
} from '@src/lib/cloudProjects/runtime/directories'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'

/** Build project data from already-downloaded bytes; editor adoption must not await more I/O. */
export function projectFromCloudSnapshot(
  previous: Project,
  files: readonly ProjectArchiveFile[]
): Project {
  const root: ProjectDirectory = { ...previous.contents, children: [] }
  const directories = new Map<string, ProjectDirectory>([[root.path, root]])
  function directory(parts: readonly string[]) {
    let parent = root
    for (const name of parts) {
      const path = fsZds.join(parent.path, name)
      let child = directories.get(path)
      if (!child) {
        child = { name, path, children: [] }
        directories.set(path, child)
        parent.children.push(child)
      }
      parent = child
    }
    return parent
  }
  for (const file of files) {
    const parts = webSafePathSplit(file.relativePath)
    const name = parts.pop()!
    const parent = directory(parts)
    parent.children.push({
      name,
      path: fsZds.join(parent.path, name),
      children: null,
    })
  }
  const emptyDirectories = files.find(
    (file) => file.relativePath === CLOUD_DIRECTORIES_FILE
  )
  if (emptyDirectories)
    for (const path of decodeCloudDirectories(emptyDirectories.data))
      directory(webSafePathSplit(path))
  const config = files.find(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  const metadata = config
    ? readProjectMetadataFromToml(new TextDecoder().decode(config.data))
    : {}
  // Keep malformed configuration available for editing, with the last usable
  // title/default-file metadata, rather than closing the view needed to repair it.
  return {
    ...previous,
    contents: root,
    metadata:
      metadata instanceof Error
        ? previous.metadata
        : {
            ...previous.metadata,
            title: metadata.title ?? previous.metadata.title,
            defaultFile: metadata.defaultFile,
          },
  }
}
