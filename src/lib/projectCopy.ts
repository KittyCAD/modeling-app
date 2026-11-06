import { collectLocalProjectFilesForCloudSync } from '@src/lib/cloudSync/localManifest'
import { isCloudSyncExcludedPath } from '@src/lib/cloudSync/paths'
import { getProjectArchiveEntrypointPath } from '@src/lib/cloudSync/projectArchive'
import type { CreateProjectLibraryTarget } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import { toProjectRelativePath } from '@src/lib/paths'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

export type ProjectEditorSnapshot = { path: string; contents: string }

/** Create an independent project through the destination library's normal creation path. */
export async function copyProjectToLibrary({
  fileOperations,
  sourcePath,
  title,
  target,
  editorFiles = [],
  assertCurrent = () => {},
}: {
  fileOperations: FileOperationsRegistryService
  sourcePath: string
  title: string
  target: CreateProjectLibraryTarget
  editorFiles?: readonly ProjectEditorSnapshot[]
  assertCurrent?: () => void
}) {
  assertCurrent()
  const files = await collectLocalProjectFilesForCloudSync({
    fileOperations,
    projectRoot: sourcePath,
    includeIgnored: true,
  })
  assertCurrent()
  const byPath = new Map(files.map((file) => [file.relativePath, file]))
  for (const editor of editorFiles) {
    const relativePath = toProjectRelativePath(sourcePath, editor.path)
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith('../') ||
      relativePath.startsWith('/') ||
      relativePath.startsWith('\\') ||
      /^[a-zA-Z]:/.test(relativePath) ||
      isCloudSyncExcludedPath(relativePath)
    )
      continue
    byPath.set(relativePath, {
      relativePath,
      data: new TextEncoder().encode(editor.contents),
    })
  }
  const copiedFiles = [...byPath.values()]
  const entrypointFilePath = getProjectArchiveEntrypointPath(copiedFiles)
  if (!entrypointFilePath)
    return Promise.reject(
      new Error('This project has no KCL file to open in the copy.')
    )

  const project = await target.createProject.run({
    library: target.library,
    requestedProjectName: getProjectDirectoryNameFromTitle(
      title,
      'project-copy'
    ),
    requestedProjectTitle: title,
    initialProject: {
      entrypointFilePath,
      files: copiedFiles.map((file) => ({
        requestedFileName: file.relativePath,
        requestedData: Uint8Array.from(file.data),
      })),
    },
  })
  assertCurrent()
  return project
}
