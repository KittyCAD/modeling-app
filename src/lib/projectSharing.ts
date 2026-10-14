import type { App } from '@src/lib/app'
import {
  formatCloudProjectUrl,
  isValidProjectFilePath,
} from '@src/lib/cloudProjectOpen'
import { collectLocalProjectFilesForCloudSync } from '@src/lib/cloudSync/localManifest'
import { getProjectArchiveEntrypointPath } from '@src/lib/cloudSync/projectArchive'
import { ZOO_STUDIO_PROTOCOL } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import {
  PATHS,
  safeEncodeForRouterPaths,
  toProjectRelativePath,
} from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import { routerService } from '@src/registry/contracts/router'

export const PROJECT_ACTION_COMMANDS = {
  duplicate: { name: 'Duplicate project', groupId: 'application' },
  share: { name: 'Share project', groupId: 'application' },
  desktop: { name: 'Open in desktop app', groupId: 'application' },
} as const

export function getCloudProjectPath(
  project: Project,
  currentFilePath?: string | null
) {
  const id = project.cloudSource?.id ?? project.cloudProjectId
  if (!id) return undefined
  const relative = currentFilePath
    ? toProjectRelativePath(project.path, currentFilePath)
    : undefined
  return formatCloudProjectUrl(
    id,
    relative && isValidProjectFilePath(relative) ? relative : undefined
  )
}

export function getDesktopProjectUrl(
  project: Project,
  currentFilePath?: string | null
) {
  const path = getCloudProjectPath(project, currentFilePath)
  return path ? `${ZOO_STUDIO_PROTOCOL}://${path.slice(1)}` : undefined
}

export async function duplicateViewOnlyProject(app: App, libraryId?: string) {
  const session = app.project
  const project = session?.projectIORefSignal.value
  if (!session || !project || project.cloudSource?.canEdit !== false) return

  const targets = app.getCreateProjectLibraryTargets()
  const target = libraryId
    ? targets.find(({ library }) => library.id === libraryId)
    : targets[0]
  if (!target) {
    return Promise.reject(new Error('Choose a writable library for the copy.'))
  }

  const currentFilePath = session.executingPath
  const files = await collectLocalProjectFilesForCloudSync({
    fileOperations: app.fileOperations,
    projectRoot: project.path,
  })
  if (app.project !== session) return
  const entrypointFilePath = getProjectArchiveEntrypointPath(files)
  if (!entrypointFilePath) {
    return Promise.reject(new Error('This project has no KCL entrypoint.'))
  }
  const title = `${getProjectDisplayName(project)}-copy`
  const copy = await target.createProject.run({
    library: target.library,
    requestedProjectName: getProjectDirectoryNameFromTitle(
      title,
      'project-copy'
    ),
    requestedProjectTitle: title,
    initialProject: {
      entrypointFilePath,
      files: files.map((file) => ({
        requestedFileName: file.relativePath,
        requestedData: Uint8Array.from(file.data),
      })),
    },
  })
  if (!copy?.default_file) {
    return Promise.reject(new Error('Unable to create the project copy.'))
  }
  if (app.project !== session) return
  const relative = currentFilePath
    ? toProjectRelativePath(project.path, currentFilePath)
    : undefined
  const filePath =
    relative && isValidProjectFilePath(relative)
      ? fsZds.join(copy.path, relative)
      : copy.default_file
  await app.registry
    .get(routerService)
    .navigate(`${PATHS.FILE}/${safeEncodeForRouterPaths(filePath)}`)
}
