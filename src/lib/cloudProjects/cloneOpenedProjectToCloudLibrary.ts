import fsZds from '@src/lib/fs-zds'
import {
  findHomeProjectByPath,
  getHomeProjectDisplayName,
} from '@src/lib/homeProjects'
import { getFileRoute } from '@src/lib/paths'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import type { NavigateFunction } from 'react-router-dom'

/** Create a cloud project without changing the source, then open the new project. */
export async function cloneOpenedProjectToCloudLibrary({
  actions,
  entries,
  projectPath,
  navigate,
  title,
}: {
  actions:
    | Pick<
        HomeProjectActionsService,
        'getCloneToLibraryTargets' | 'cloneToLibrary'
      >
    | undefined
  entries: readonly HomeProjectEntry[]
  projectPath: string
  navigate: NavigateFunction
  title: string
}): Promise<{ defaultFile: string; projectPath: string } | Error> {
  const homeProject = findHomeProjectByPath(entries, projectPath)
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
    await navigate(getFileRoute(created.defaultFile))
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
  actions,
  entries,
  projectPath,
  title,
}: {
  actions: Pick<HomeProjectActionsService, 'canRename' | 'rename'> | undefined
  entries: readonly HomeProjectEntry[]
  projectPath: string
  title: string
}): Promise<true | Error> {
  try {
    const homeProject = findHomeProjectByPath(entries, projectPath)
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
