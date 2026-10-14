import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import {
  downloadCloudProjectView,
  formatCloudProjectUrl,
  isValidProjectFilePath,
  resolveCloudProjectSource,
} from '@src/lib/cloudProjectOpen'
import { getCloudProjectLibraryMaterializationDirectoryPath } from '@src/lib/cloudSync/paths'
import fsZds, {
  createReadOnlyProjectSnapshot,
  disposeReadOnlyProjectSnapshot,
  isReadOnlyProjectPath,
} from '@src/lib/fs-zds'
import { isPersonalCloudProjectLibrarySetting } from '@src/lib/projectLibraries'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import toast from 'react-hot-toast'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { getProjectInfo, isPathNotFoundError } from '@src/lib/desktop'
import {
  getParentAbsolutePath,
  getRouterSearchFromRequestUrl,
  PATHS,
  parseProjectRoute,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { getProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import { loadHomeProjects } from '@src/lib/routeLoaderUtils'
import {
  getOnboardingChildRoute,
  isRequestedFileLoaded,
} from '@src/lib/routeLoaderNavigation'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import type { HomeLoaderData } from '@src/lib/types'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import type { LoaderFunction } from 'react-router-dom'
import { redirect } from 'react-router-dom'
import { waitFor } from 'xstate'

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

export const fileLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (routerData) => {
    const assertCurrent = app.beginFileRouteLoad(routerData.request.signal)
    const { kclManager } = app.singletons
    const { params } = routerData

    if (params.id && isReadOnlyProjectPath(params.id)) {
      return Promise.reject(new Error('Open this project using its cloud URL.'))
    }

    // Old web bookmarks encode /browser/... as the file route's id. These
    // paths no longer identify projects, so return home before filesystem I/O.
    if (params.id?.startsWith('/browser')) {
      return redirect(PATHS.HOME)
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

    await openRouteProject(app, project, currentFilePath, assertCurrent)
  }

async function openRouteProject(
  app: App,
  project: Project,
  filePath: string | null,
  assertCurrent: () => void
) {
  const settingsActor = app.settings.actor
  const kclManager = app.singletons.kclManager
  projectFsManager.dir = project.path
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
  await projectRef.openEditor(
    filePath || PROJECT_ENTRYPOINT,
    app.singletons.kclManager,
    // If persistCode in localStorage is present, it'll persist that code
    // through *anything*. INTENDED FOR TESTS.
    window.electron?.process.env.NODE_ENV === 'test' &&
      project.cloudSource?.canEdit !== false
      ? kclManager.localStoragePersistCode()
      : undefined,
    true,
    assertCurrent
  )
  assertCurrent()

  const requestedFileName =
    app.systemIOActor.getSnapshot().context.requestedFileName
  if (
    isRequestedFileLoaded({
      requestedFileName,
      projectName: project.name,
      projectPath: project.path,
      currentFilePath: filePath,
    })
  ) {
    requestedFileName.onProjectLoaderComplete?.()
  }

  const requestedProjectDirectoryPath =
    projectRef.projectIORefSignal.value.libraryPath ??
    getParentAbsolutePath(project.path)
  const systemIOSnapshot = app.systemIOActor.getSnapshot()
  // Same-directory file navigation should not restart SystemIO's own
  // post-mutation folder refresh.
  const shouldSyncProjectDirectory =
    requestedProjectDirectoryPath !==
      systemIOSnapshot.context.projectDirectoryPath ||
    (systemIOSnapshot.matches(SystemIOMachineStates.idle) &&
      systemIOSnapshot.context.folders === undefined)
  if (shouldSyncProjectDirectory) {
    app.systemIOActor.send({
      type: SystemIOMachineEvents.setProjectDirectoryPath,
      data: {
        requestedProjectDirectoryPath,
      },
    })
  }
}

export const cloudProjectLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async ({ request, params }) => {
    const assertCurrent = app.beginFileRouteLoad(request.signal)
    const url = new URL(request.url)
    const auth = await waitFor(
      app.auth.actor,
      (state) => state.matches('loggedIn') || state.matches('loggedOut')
    )
    assertCurrent()
    if (!auth.matches('loggedIn')) {
      return redirect(
        `${PATHS.SIGN_IN}?returnTo=${encodeURIComponent(url.pathname + url.search)}`
      )
    }
    const id = params.id
    const requestedFile = url.searchParams.get('file') ?? ''
    if (!id || (requestedFile && !isValidProjectFilePath(requestedFile)))
      return Promise.reject(new Error('Invalid project file path.'))

    const wasm = await app.wasmPromise
    assertCurrent()
    const { settings } = await loadRouteSettings(app, wasm)
    assertCurrent()
    const config = { enabled: true, token: app.auth.token.value }
    const source = await resolveCloudProjectSource(config, id)
    assertCurrent()
    const files = app.registry.get(fileOperationsService)
    let viewPath: string | undefined
    try {
      let project: Project
      let entrypoint: string
      if (source.source.canEdit) {
        const library = settings.app.libraries?.current?.find(
          isPersonalCloudProjectLibrarySetting
        )
        if (!library)
          return Promise.reject(
            new Error('Enable the Personal Cloud library to edit this project.')
          )
        const cloud = await app.registry
          .get(cloudSyncService)
          .ensureProjectLocallySynced(
            id,
            await getCloudProjectLibraryMaterializationDirectoryPath(library)
          )
        assertCurrent()
        if (!cloud)
          return Promise.reject(
            new Error('Enable Cloud Sync to edit this project.')
          )
        project = await getProjectInfo(files, cloud.projectPath, wasm)
        assertCurrent()
        entrypoint =
          source.entrypoint && isValidProjectFilePath(source.entrypoint)
            ? fsZds.join(project.path, source.entrypoint)
            : project.default_file
      } else {
        const snapshot = await downloadCloudProjectView(
          config,
          source,
          assertCurrent
        )
        viewPath = await createReadOnlyProjectSnapshot(snapshot.files)
        assertCurrent()
        project = await getProjectInfo(files, viewPath, wasm)
        assertCurrent()
        entrypoint = fsZds.join(viewPath, snapshot.entrypoint)
      }
      project = {
        ...project,
        title: source.title,
        default_file: entrypoint,
        cloudSource: source.source,
      }
      let path = requestedFile
        ? fsZds.join(project.path, requestedFile)
        : entrypoint
      if (!path.endsWith('.kcl') || !(await files.exists(path))) {
        path = entrypoint
        if (requestedFile)
          toast('That file is unavailable. Opened the default KCL file.')
      }
      assertCurrent()
      await openRouteProject(app, project, path, assertCurrent)
      const relative = fsZds.relative(project.path, path).replaceAll('\\', '/')
      const canonical = new URL(
        formatCloudProjectUrl(
          id,
          path === entrypoint ? undefined : relative,
          url.search
        ),
        url.origin
      )
      // Keep overlays such as settings while normalizing the selected file.
      const canonicalUrl = url.pathname + canonical.search
      if (canonicalUrl !== url.pathname + url.search)
        return redirect(canonicalUrl)
    } finally {
      if (viewPath && app.project?.path !== viewPath)
        await disposeReadOnlyProjectSnapshot(viewPath)
    }
  }

// Loads the settings and by extension the projects in the default directory
// and returns them to the Home route, along with any errors that occurred

// Should also clear currently loaded projects in SystemIO. They may be stale.
export const homeLoader =
  ({ app }: { app: App }): LoaderFunction =>
  async (): Promise<HomeLoaderData | Response> => {
    return loadHomeProjects(app)
  }
