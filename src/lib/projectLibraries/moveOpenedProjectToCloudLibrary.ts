import type { App } from '@src/lib/app'
import { writeProjectTitleToProjectToml } from '@src/lib/desktop'
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

/**
 * Releases the open project, relocates it, then routes directly to the moved
 * file so no intermediate Home navigation is visible to the user.
 *
 * The move must finish before navigation because the destination library may
 * choose a different directory name to avoid a collision.
 */
export async function moveOpenedProjectToCloudLibrary({
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
    .find((entry) => entry.localProjectPath === project.path)
  const cloudLibraryTarget = homeProject
    ? actions
        ?.getMoveToLibraryTargets(homeProject)
        .find((target) => target.library.type === CLOUD_PROJECT_LIBRARY_TYPE)
    : undefined

  if (!actions || !homeProject || !cloudLibraryTarget) {
    return new Error('No cloud library is available for the open project.')
  }

  app.closeProject()
  app.settings.actor.send({ type: 'clear.project' })

  try {
    // Persist through the project metadata API after closing the editor. The
    // destination library uses this title for the final directory name, while
    // the closed project cannot mistake the relocation for an external reload.
    await writeProjectTitleToProjectToml(project.path, title)
    const moved = await actions.moveToLibrary(
      homeProject,
      cloudLibraryTarget.library.id
    )
    if (!moved?.defaultFile) {
      await navigate(PATHS.HOME)
      return new Error(
        'Moving the open project did not return its new file path.'
      )
    }

    const projectPath =
      moved.localProjectPath ?? fsZds.dirname(moved.defaultFile)
    await navigate(`${PATHS.FILE}/${encodeURIComponent(moved.defaultFile)}`)
    return {
      defaultFile: moved.defaultFile,
      projectPath,
    }
  } catch (error) {
    // The old route no longer has an active project session. Fall back to Home
    // only when relocation fails; successful publication never renders it.
    await navigate(PATHS.HOME)
    return error instanceof Error
      ? error
      : new Error('Moving the open project to Personal Cloud failed.')
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
      .find((entry) => entry.localProjectPath === project.path)
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
