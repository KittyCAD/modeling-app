import fsZds from '@src/lib/fs-zds'
import { authService } from '@src/registry/contracts/auth'
import { cloudStorageService } from '@src/registry/contracts/fileOperations'
import { resolveProjectLocation } from '@src/lib/fileSystem/mounts'
import { reportRejection } from '@src/lib/trap'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import { FILE_EXT, PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { getProjectInfo, isPathNotFoundError } from '@src/lib/desktop'
import {
  getRouterSearchFromRequestUrl,
  PATHS,
  parseProjectRoute,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { getProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import { loadHomeProjects } from '@src/lib/routeLoaderUtils'
import { getOnboardingChildRoute } from '@src/lib/routeLoaderNavigation'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import type { HomeLoaderData } from '@src/lib/types'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import type { LoaderFunction } from 'react-router-dom'
import { redirect } from 'react-router-dom'
import { waitFor } from 'xstate'
import { hasProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { waitForUserFeaturesSettled } from '@src/machines/userFeaturesMachine'
import { readProject } from '@src/lib/projectSession/next/utils'
import { projectSessionService } from '@src/lib/projectSession/next/contract'

export const DEFAULT_WEB_PROJECT_NAME = 'demo-project'

function loadRouteSettings(
  app: App,
  wasmInstance: Awaited<App['wasmPromise']>,
  projectPath?: string
) {
  return loadAndValidateSettings(
    app.registry.get(fileOperationsService),
    wasmInstance,
    {
      defaultProjectLibraries: app.registry.get(
        projectLibrarySettingDefaultsValueSpec
      ),
      projectLibrarySettingDefaultPolicies: app.registry.get(
        projectLibrarySettingDefaultPoliciesValueSpec
      ),
      extensionSettings: app.registry.get(settingsValueSpec),
      projectPath,
    }
  )
}

/**
 * The base loader reroutes `/` to the home route.
 */
export const baseLoader =
  (_: { app: App }): LoaderFunction =>
  async ({ request }) => {
    const url = new URL(request.url)
    const routerSearch = getRouterSearchFromRequestUrl(
      request.url,
      Boolean(window.electron)
    )

    // Let another part of the system handle the "open with web/desktop"...
    if (!window.electron && url.searchParams.has('ask-open-desktop')) {
      return
    }

    return redirect(PATHS.HOME + routerSearch)
  }

/** Settle the shared feature grant before either experimental route accesses resources. */
async function canOpenProjectShell(app: App, signal: AbortSignal) {
  await waitForUserFeaturesSettled(app.userFeatures.actor, undefined, signal)
  signal.throwIfAborted()
  return hasProjectShellFeature(app.userFeatures)
}

/**
 * `/project/:id` identifies a cloud project by its API ID, never a disk path or
 * an internal cloud relationship ID. Cloud opening is reserved for a follow-up;
 * this route must not fall through to filesystem discovery in the meantime.
 */
export const projectLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async ({ request, params }) => {
    if (!(await canOpenProjectShell(app, request.signal)))
      return redirect(PATHS.HOME)
    if (!params.id)
      return Promise.reject(new Error('No cloud project ID provided'))
    return Promise.reject(
      new Error('Cloud projects are not yet supported by this route')
    )
  }

/**
 * Open the directory identified by `/local/:path`, without opening an editor.
 * Reading assembles the full tree and optional TOML metadata without creating files
 * or applying project settings. Files are rejected rather than promoted to their
 * parent directory. Failed or cancelled discovery leaves the selection intact.
 */
export const localLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async ({ request, params }) => {
    if (!(await canOpenProjectShell(app, request.signal)))
      return redirect(PATHS.HOME)
    const { path } = params
    if (!path)
      return Promise.reject(new Error('No local directory path provided'))

    const assertCurrent = () => request.signal.throwIfAborted()
    const fileOperations = app.registry.get(fileOperationsService)
    const projectSessions = app.registry.get(projectSessionService)
    // A grant can be revoked (and granted again) while discovery is awaiting IO.
    // Never publish through a captured service that the registry has disposed.
    const ownsSession = () =>
      hasProjectShellFeature(app.userFeatures) &&
      app.registry.optional(projectSessionService) === projectSessions

    const library = await getProjectLibraryOwnership(
      app.settings.get().app.libraries.current,
      path
    )
    assertCurrent()
    if (!ownsSession()) return redirect(PATHS.HOME)
    const project = await readProject(fileOperations, path, {
      signal: request.signal,
      library,
    })
    assertCurrent()
    if (!ownsSession()) return redirect(PATHS.HOME)
    // Consumers retain this session instead of resolving the global selection again.
    return projectSessions.openProject(project)
  }

export const fileLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (routerData) => {
    const assertCurrent = app.beginFileRouteLoad(routerData.request.signal)
    const {
      settings: { actor: settingsActor },
    } = app
    const { kclManager } = app.singletons
    const params = { ...routerData.params }
    // Old web bookmarks encode /browser/... as the file route's id. These
    // paths no longer identify projects, so return home before filesystem I/O.
    if (params.id?.startsWith('/browser')) {
      return redirect(PATHS.HOME)
    }

    if (params.id?.startsWith('local:')) {
      const url = new URL(routerData.request.url)
      url.pathname = url.pathname.replace(
        encodeURIComponent(params.id),
        encodeURIComponent(params.id.slice(6))
      )
      return redirect(url.pathname + url.search)
    }
    // A file already belonging to the open project needs no project/settings reload.
    const current = app.project
    const target = params.id
    const requestPath = new URL(routerData.request.url).pathname
    if (
      current &&
      !kclManager.modelingState?.matches('sketchSolveMode') &&
      target?.endsWith(FILE_EXT) &&
      fsZds
        .resolve(target)
        .startsWith(`${fsZds.resolve(current.path)}${fsZds.sep}`) &&
      !requestPath.includes('/onboarding') &&
      !requestPath.endsWith('/settings') &&
      (await app.fileOperations.exists(target))
    ) {
      assertCurrent()
      await current.openEditor(
        target,
        kclManager,
        undefined,
        true,
        assertCurrent,
        { deferModeling: true }
      )
      assertCurrent()
      return
    }
    const waitForCloudAuth = async () => {
      const auth = app.registry.optional(authService)
      if (auth)
        await waitFor(auth.actor, (state) => !state.matches('checkIfLoggedIn'))
      assertCurrent()
    }
    if (
      params.id?.startsWith('cloud:') ||
      (params.id && !params.id.includes('/') && !params.id.includes('\\'))
    ) {
      await waitForCloudAuth()
      const cloud = app.registry.get(cloudStorageService)
      const location = await resolveProjectLocation(params.id, cloud.exists)
      assertCurrent()
      if (location.type === 'cloud') {
        const path = fsZds.join(cloud.root, location.id)
        return redirect(
          `${PATHS.FILE}/${encodeURIComponent(path)}${new URL(routerData.request.url).search}`
        )
      }
      params.id = location.id
      assertCurrent()
    }

    const cloudStorage = app.registry.get(cloudStorageService)
    if (params.id?.startsWith(`${cloudStorage.root}${fsZds.sep}`)) {
      await waitForCloudAuth()
      const id = cloudStorage.idFor(params.id)
      if (current?.path !== fsZds.join(cloudStorage.root, id)) {
        await cloudStorage.refreshProject(
          id,
          () => !routerData.request.signal.aborted
        )
      } else {
        await cloudStorage.openProject(id)
      }
      assertCurrent()
    }

    const wasmInstance = await kclManager.wasmInstancePromise
    assertCurrent()

    // Resolve the project root before loading project settings. Loading project
    // settings from a selected file's parent folder creates project.toml in
    // nested folders and makes them look like project roots.
    const appSettings = await loadRouteSettings(app, wasmInstance)
    assertCurrent()
    const currentProjectPath = app.project?.projectIORefSignal.value.path
    const targetLibraryPath = params.id
      ? (
          await getProjectLibraryOwnership(
            appSettings.settings.app.libraries?.current ?? [],
            params.id
          )
        )?.libraryPath
      : undefined
    const projectPathData = params.id
      ? parseProjectRoute(appSettings.configuration, params.id, {
          activeProjectPath: currentProjectPath,
          candidateProjectDirectories: targetLibraryPath
            ? [targetLibraryPath]
            : [],
        })
      : undefined

    if (!projectPathData) {
      return Promise.reject(
        new Error('bug: projectPathData undefined, early return')
      )
    }

    await loadRouteSettings(app, wasmInstance, projectPathData.projectPath)
    assertCurrent()

    const { projectName, projectPath, currentFileName, currentFilePath } =
      projectPathData

    const urlObj = new URL(routerData.request.url)

    if (!urlObj.pathname.endsWith('/settings')) {
      const fallbackFile = (
        await getProjectInfo(
          app.registry.get(fileOperationsService),
          projectPath,
          wasmInstance
        )
      ).default_file
      let fileExists = true
      if (currentFilePath && fileExists) {
        try {
          await app.registry.get(fileOperationsService).stat(currentFilePath)
        } catch (e) {
          if (isPathNotFoundError(e)) {
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
        const onboardingChildRoute = params.id
          ? getOnboardingChildRoute(routerData.request.url, params.id)
          : ''
        return redirect(
          `${PATHS.FILE}/${encodeURIComponent(
            fallbackFile
          )}${onboardingChildRoute}${routerSearch}`
        )
      }
    }

    // Set the file system manager to the project path
    // So that WASM gets an updated path for operations
    projectFsManager.setOperations(app.fileOperations)
    projectFsManager.dir = projectPath

    const defaultProjectData = {
      name: projectName || 'unnamed',
      path: projectPath,
      children: [],
      kcl_file_count: 0,
      directory_count: 0,
      metadata: null,
      default_file: projectPath,
      readWriteAccess: true,
    }

    const maybeProjectInfo = await getProjectInfo(
      app.registry.get(fileOperationsService),
      projectPath,
      wasmInstance
    )
    assertCurrent()

    const project = maybeProjectInfo ?? defaultProjectData
    const cloud = app.registry.get(cloudStorageService)
    if (projectPath.startsWith(`${cloud.root}${fsZds.sep}`))
      project.cloudProjectId = cloud.idFor(projectPath)

    // Fire off the event to load the project settings
    // once we know it's idle.
    await waitFor(settingsActor, (state) => state.matches('idle'))
    assertCurrent()
    settingsActor.send({
      type: 'load.project',
      project,
    })
    await waitFor(settingsActor, (state) => state.matches('idle'))
    assertCurrent()

    const projectRef = await app.openProject(project, assertCurrent)
    // Test seeds must reach storage too: sketch refresh and autosave use it
    // as their baseline rather than treating an injected buffer as saved bytes.
    const testCode =
      window.electron?.process.env.NODE_ENV === 'test'
        ? kclManager.localStoragePersistCode()
        : undefined
    if (testCode !== undefined) {
      await app.fileOperations.writeFile(
        fsZds.resolve(project.path, currentFilePath || PROJECT_ENTRYPOINT),
        testCode
      )
      assertCurrent()
    }
    await projectRef.openEditor(
      currentFilePath || PROJECT_ENTRYPOINT,
      app.singletons.kclManager,
      undefined,
      true,
      assertCurrent
    )
    assertCurrent()

    void app.refreshProjects().catch(reportRejection)
  }

// Loads the settings and by extension the projects in the default directory
// and returns them to the Home route, along with any errors that occurred

export const homeLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (): Promise<HomeLoaderData | Response> => {
    return loadHomeProjects(app)
  }
