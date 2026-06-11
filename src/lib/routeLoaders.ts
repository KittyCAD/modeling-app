import { projectSkeletonCreate } from '@src/lang/project'
import type { App } from '@src/lib/app'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { getInitialDefaultDir, getProjectInfo } from '@src/lib/desktop'
import { readAppSettingsFile } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  PATHS,
  getProjectMetaByRouteId,
  getRouterSearchFromRequestUrl,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { webHomeRouteEnabled } from '@src/lib/routeLoaderUtils'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { projectSessionService } from '@src/registry/contracts/projectSession'
import type { LoaderFunction } from 'react-router-dom'
import { redirect } from 'react-router-dom'

export const DEFAULT_WEB_PROJECT_NAME = 'demo-project'

type EmptyLoaderData = Record<string, never>

/**
 * The base loader is used to reroute `/` root path requests,
 * to the home route on desktop, and to a constrained single project view on web.
 *
 * The OPFS cloud feature flag enables the home, multi-project view on web.
 */
export const baseLoader =
  ({
    app,
  }: {
    app: App
  }): LoaderFunction =>
  async ({ request }) => {
    const url = new URL(request.url)
    const routerSearch = getRouterSearchFromRequestUrl(
      request.url,
      Boolean(window.electron)
    )

    // Desktop, redirect and return early
    if (window.electron) {
      return redirect(PATHS.HOME + routerSearch)
    }

    // Let another part of the system handle the "open with web/desktop"...
    if (url.searchParams.has('ask-open-desktop')) {
      return
    }

    if (await webHomeRouteEnabled(app)) {
      return redirect(PATHS.HOME + routerSearch)
    }

    // Web, make a default project and redirect to it.
    const wasmInstance = await app.singletons.kclManager.wasmInstancePromise

    const settings = await loadAndValidateSettings(wasmInstance, undefined)

    const requestedProjectName = fsZds.resolve(
      settings.settings.app.projectDirectory.current,
      DEFAULT_WEB_PROJECT_NAME
    )

    // We have to create and/or navigate to a project on web.
    try {
      await fsZds.stat(requestedProjectName)
      app.systemIOActor.send({
        type: SystemIOMachineEvents.navigateToProject,
        data: { requestedProjectName },
      })
    } catch {
      await projectSkeletonCreate(
        fsZds.resolve(
          await getInitialDefaultDir(),
          DEFAULT_WEB_PROJECT_NAME,
          'main.kcl'
        ),
        settings.settings.modeling.defaultUnit.current ??
          DEFAULT_DEFAULT_LENGTH_UNIT,
        wasmInstance
      )

      const fileURLPath = `${PATHS.FILE}/${encodeURIComponent(requestedProjectName)}`
      return redirect(fileURLPath + routerSearch)
    }
  }

export const fileLoader =
  ({
    app,
  }: {
    app: App
  }): LoaderFunction =>
  async (routerData): Promise<EmptyLoaderData | Response> => {
    const { kclManager } = app.singletons
    const projectSession = app.registry.get(projectSessionService)
    const { params } = routerData

    // Must basically remain for all eternity, until the last person
    // who's ever used ZDS on web before this point has died.
    if (params.id?.startsWith('/browser')) {
      // Pop us back home, which will cause a default project to be
      // created.
      return redirect(PATHS.HOME)
    }

    const heuristicProjectFilePath = params.id
      ? params.id.split(fsZds.sep).slice(0, -1).join(fsZds.sep)
      : undefined

    const wasmInstance = await kclManager.wasmInstancePromise

    const settings = await loadAndValidateSettings(
      wasmInstance,
      heuristicProjectFilePath
    )

    const projectPathData = await getProjectMetaByRouteId(
      readAppSettingsFile,
      wasmInstance,
      params.id,
      settings.configuration
    )

    if (!projectPathData) {
      return Promise.reject(
        new Error('bug: projectPathData undefined, early return')
      )
    }

    const { projectName, projectPath, currentFileName, currentFilePath } =
      projectPathData

    const urlObj = new URL(routerData.request.url)

    if (!urlObj.pathname.endsWith('/settings')) {
      const fallbackFile = (await getProjectInfo(projectPath, wasmInstance))
        .default_file
      let fileExists = true
      if (currentFilePath && fileExists) {
        try {
          await fsZds.stat(currentFilePath)
        } catch (e) {
          if (e === 'ENOENT') {
            fileExists = false
          }
        }
      }

      // If we are navigating to the project and want to navigate to its
      // default file, redirect to it keeping everything else in the URL the same.
      if (projectPath && !currentFileName && fileExists && params.id) {
        const encodedId = safeEncodeForRouterPaths(params.id)
        const requestUrlWithDefaultFile = routerData.request.url.replace(
          encodedId,
          safeEncodeForRouterPaths(fallbackFile)
        )
        return redirect(requestUrlWithDefaultFile)
      }

      if (!fileExists || !currentFileName || !currentFilePath || !projectName) {
        const routerSearch = getRouterSearchFromRequestUrl(
          routerData.request.url,
          Boolean(window.electron)
        )
        return redirect(
          `${PATHS.FILE}/${encodeURIComponent(fallbackFile)}${routerSearch}`
        )
      }
    }

    await projectSession.setOpenedProjectHandle({ projectPath })
    await projectSession.setExecutingEditorHandle({
      projectPath,
      filePath: currentFilePath || PROJECT_ENTRYPOINT,
    })

    return {}
  }

// Loads the settings and by extension the projects in the default directory
// and returns them to the Home route, along with any errors that occurred

export const homeLoader =
  ({
    app,
  }: {
    app: App
  }): LoaderFunction =>
  async (): Promise<EmptyLoaderData | Response> => {
    // If on unflagged web, bump out to root, which will redirect to a project.
    if (!window.electron && !(await webHomeRouteEnabled(app))) {
      return redirect(PATHS.INDEX)
    }

    await app.registry
      .get(projectSessionService)
      .setOpenedProjectHandle(undefined)
    return {}
  }
