import { isPathNotFoundError } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  getDefaultDirectoryProjectLibraryPath,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import type { Project } from '@src/lib/project'
import type { ProjectLibrariesService } from '@src/registry/contracts/projectLibraries'
import type { ReadonlySignal } from '@preact/signals-core'

/** The session identity guards missing-path navigation after asynchronous refreshes. */
interface LibraryProject {
  readonly projectIORefSignal: ReadonlySignal<
    Pick<Project, 'path' | 'libraryPath'>
  >
}

export function createProjectLibraries({
  getProject,
  getLibraries,
  getDefaultProjectName,
  listProjects,
  refreshProject,
  navigateHome,
}: {
  getProject: () => LibraryProject | undefined
  getLibraries: () => readonly ProjectLibrarySetting[]
  getDefaultProjectName: () => string
  listProjects: (directory: string) => Promise<unknown>
  refreshProject: () => Promise<unknown>
  navigateHome: () => void | Promise<void>
}): ProjectLibrariesService {
  const service: ProjectLibrariesService = {
    get projectDirectoryPath() {
      const project = getProject()?.projectIORefSignal.value
      return (
        project?.libraryPath ??
        (project
          ? fsZds.dirname(project.path)
          : (getDefaultDirectoryProjectLibraryPath(getLibraries()) ?? ''))
      )
    },
    get defaultProjectName() {
      return getDefaultProjectName()
    },
    async refreshProjects() {
      const current = getProject()
      const directory = service.projectDirectoryPath
      try {
        await Promise.all([
          directory ? listProjects(directory) : Promise.resolve([]),
          refreshProject(),
        ])
      } catch (error) {
        if (current && getProject() === current && isPathNotFoundError(error))
          await navigateHome()
        else return Promise.reject(error)
      }
    },
  }
  return service
}
