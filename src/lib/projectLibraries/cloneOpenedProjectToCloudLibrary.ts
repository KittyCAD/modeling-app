import { cloudStorageService } from '@src/registry/contracts/fileOperations'
import type { App } from '@src/lib/app'
import fsZds from '@src/lib/fs-zds'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import { PATHS } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import {
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import type { NavigateFunction } from 'react-router-dom'

/** Create a cloud project without changing the source, then open the new project. */
export async function cloneOpenedProjectToCloudLibrary({
  app,
  project,
  navigate,
  title,
}: {
  app: App
  project: Project
  navigate: NavigateFunction
  title: string
}): Promise<{ defaultFile: string; projectPath: string } | Error> {
  const actions = app.registry.optional(homeProjectActionsService)
  const homeProject = app.registry
    .get(homeProjectEntriesValueSpec)
    .find(
      (entry) =>
        entry.localProjectPath === project.path ||
        (entry.remoteProjectId &&
          app.registry
            .get(cloudStorageService)
            .pathFor(entry.remoteProjectId) === project.path)
    )
  const cloudLibraryTarget = homeProject
    ? actions
        ?.getCloneToLibraryTargets(homeProject)
        .find((target) => target.library.type === CLOUD_PROJECT_LIBRARY_TYPE)
    : undefined

  if (!actions || !homeProject || !cloudLibraryTarget) {
    return new Error('No cloud library is available for the open project.')
  }

  try {
    const created = await actions.cloneToLibrary(
      homeProject,
      cloudLibraryTarget.library.id,
      { title }
    )
    if (!created?.defaultFile) {
      return new Error(
        'Creating the cloud project did not return its file path.'
      )
    }

    const projectPath =
      created.localProjectPath ?? fsZds.dirname(created.defaultFile)
    await navigate(`${PATHS.FILE}/${encodeURIComponent(created.defaultFile)}`)
    return {
      defaultFile: created.defaultFile,
      projectPath,
    }
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('Creating a cloud project from the open project failed.')
  }
}

/**
 * Persists the publication title through the owning project library's rename
 * operation. This keeps project settings serialization in the domain API that
 * already owns it and completes before publication snapshots any files.
 */
export async function updateProjectTitleForPublication({
  app,
  project,
  title,
}: {
  app: App
  project: Project
  title: string
}): Promise<true | Error> {
  try {
    const actions = app.registry.optional(homeProjectActionsService)
    const homeProject = app.registry
      .get(homeProjectEntriesValueSpec)
      .find(
        (entry) =>
          entry.localProjectPath === project.path ||
          (entry.remoteProjectId &&
            app.registry
              .get(cloudStorageService)
              .pathFor(entry.remoteProjectId) === project.path)
      )
    if (!actions || !homeProject || !actions.canRename(homeProject)) {
      return new Error('The open project title could not be updated.')
    }
    if (getHomeProjectDisplayName(homeProject) === title) {
      return true
    }

    await actions.rename(homeProject, title, { notify: false })
    return true
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('Updating the project title failed.')
  }
}
