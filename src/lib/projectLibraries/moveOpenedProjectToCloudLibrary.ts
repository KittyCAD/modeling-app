import type { App } from '@src/lib/app'
import { PATHS } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import { err } from '@src/lib/trap'
import {
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import type { NavigateFunction } from 'react-router-dom'

/**
 * Relocates the open project through the same closed-session lifecycle used by
 * Home so no editor or settings watcher retains ownership of its old path.
 *
 * TODO: Replace this manual close/navigate/move/reopen sequence with the
 * projectSession and router relocation workflow once that migration lands.
 */
export async function moveOpenedProjectToCloudLibrary({
  app,
  project,
  navigate,
}: {
  app: App
  project: Project
  navigate: NavigateFunction
}): Promise<true | Error> {
  app.closeProject()
  app.settings.actor.send({ type: 'clear.project' })
  await navigate(PATHS.HOME)

  const movedDefaultFile = await moveProjectToCloudLibrary(app, project)
  if (err(movedDefaultFile)) {
    return movedDefaultFile
  }

  await navigate(`${PATHS.FILE}/${encodeURIComponent(movedDefaultFile)}`)
  return true
}

/**
 * Moves a published local realization into its configured cloud library.
 * Publishing runs first so project.toml contains the remote cloud identity.
 */
async function moveProjectToCloudLibrary(app: App, project: Project) {
  try {
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

    const result = await actions.moveToLibrary(
      homeProject,
      cloudLibraryTarget.library.id
    )
    if (!result?.defaultFile) {
      return new Error(
        'Moving the open project did not return its new file path.'
      )
    }

    return result.defaultFile
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('Moving the open project to Personal Cloud failed.')
  }
}
