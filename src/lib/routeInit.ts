/**
 * Route initialization, as plain functions.
 *
 * These began as extracted React Router loader bodies. They now return typed
 * application transitions when one startup destination resolves to another.
 * The startup coordinator follows those transitions directly and projects the
 * canonical URL only after the resulting application state is ready.
 */

import { projectSkeletonCreate } from '@src/lang/project'
import type { App } from '@src/lib/app'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { getInitialDefaultDir, getProjectInfo } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  DEFAULT_PROJECT_LIBRARY_TITLE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  getDefaultDirectoryProjectLibrarySetting,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import {
  loadHomeProjects,
  webHomeRouteEnabled,
} from '@src/lib/routeLoaderUtils'
import { loadRouteSettings } from '@src/lib/routeSettings'
import type { AppSettings } from '@src/lib/settings/settingsUtils'
import type { FileLoaderData, HomeLoaderData } from '@src/lib/types'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import type {
  AppDestination,
  AppUrlState,
} from '@src/registry/contracts/appUrl'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'

export const DEFAULT_WEB_PROJECT_NAME = 'demo-project'

/**
 * A startup step either establishes its state or selects the next typed
 * application destination. URL-owned state remains structured until the
 * resulting destination has been established.
 */
export type RouteInitResult<T> =
  | { kind: 'ready'; data: T }
  | {
      kind: 'transition'
      destination: AppDestination
      urlState: AppUrlState
    }

type CanonicalWebProjectLibrary = {
  library: ProjectLibrarySetting
  projectPath: string
  defaultFilePath: string
}

async function getCanonicalWebProjectLibrary(
  settings: AppSettings['settings']
): Promise<CanonicalWebProjectLibrary> {
  const fallbackLibraryPath =
    settings.app.projectDirectory.current.trim() ||
    (await getInitialDefaultDir())
  const configuredLibrary = getDefaultDirectoryProjectLibrarySetting(
    settings.app.libraries?.current
  )
  const libraryPath = configuredLibrary?.path.trim()
    ? configuredLibrary.path
    : fallbackLibraryPath
  const library = {
    title: configuredLibrary?.title || DEFAULT_PROJECT_LIBRARY_TITLE,
    path: libraryPath,
    type: configuredLibrary?.type || DIRECTORY_PROJECT_LIBRARY_TYPE,
  }

  return {
    library,
    projectPath: fsZds.resolve(library.path, DEFAULT_WEB_PROJECT_NAME),
    defaultFilePath: fsZds.resolve(
      library.path,
      DEFAULT_WEB_PROJECT_NAME,
      PROJECT_ENTRYPOINT
    ),
  }
}

async function maybeGetExistingDefaultFilePath(
  app: App,
  projectPath: string,
  wasmInstance: Awaited<App['wasmPromise']>
) {
  try {
    const project = await getProjectInfo(
      app.registry.get(fileOperationsService),
      projectPath,
      wasmInstance
    )
    return project.default_file
  } catch {
    return undefined
  }
}

async function fileExists(app: App, filePath: string) {
  return app.registry.get(fileOperationsService).exists(filePath)
}

/**
 * Initialization for `/`, which is a funnel: it never renders anything, it
 * decides where the app should actually be.
 *
 * Desktop goes home. Web goes home when the OPFS cloud flag is on, and
 * otherwise gets a default project created for it and opens that.
 */
export async function initIndexRoute(
  app: App,
  { urlState }: { urlState: AppUrlState }
): Promise<RouteInitResult<undefined>> {
  // Desktop starts at Home.
  if (window.electron) {
    return {
      kind: 'transition',
      destination: { type: 'home' },
      urlState: { search: urlState.search, hash: '' },
    }
  }

  // Let another part of the system handle the "open with web/desktop"...
  if (new URLSearchParams(urlState.search).has('ask-open-desktop')) {
    return { kind: 'ready', data: undefined }
  }

  if (await webHomeRouteEnabled(app)) {
    return {
      kind: 'transition',
      destination: { type: 'home' },
      urlState: { search: urlState.search, hash: '' },
    }
  }

  // Web without Home creates or opens its default project.
  const wasmInstance = await app.singletons.kclManager.wasmInstancePromise

  const { settings } = await loadRouteSettings(app, wasmInstance)
  const canonicalLibrary = await getCanonicalWebProjectLibrary(settings)
  let defaultFilePath =
    (await maybeGetExistingDefaultFilePath(
      app,
      canonicalLibrary.projectPath,
      wasmInstance
    )) ?? canonicalLibrary.defaultFilePath

  if (!(await fileExists(app, defaultFilePath))) {
    await projectSkeletonCreate(
      app.fileOperations,
      canonicalLibrary.defaultFilePath,
      settings.modeling.defaultUnit.current ?? DEFAULT_DEFAULT_LENGTH_UNIT,
      wasmInstance
    )
    defaultFilePath = canonicalLibrary.defaultFilePath
  }

  return {
    kind: 'transition',
    destination: { type: 'project', target: defaultFilePath },
    urlState: { search: urlState.search, hash: '' },
  }
}

/**
 * Initialization for `/file/:id`.
 *
 * Almost all of this is the `OpenProject` application intent: resolving the
 * legacy route id to a project and optional initial editor, deciding whether
 * the URL needs correction, and opening the project session. What stays here
 * is the one genuinely routing-shaped compatibility case.
 */
export async function initFileRoute(
  app: App,
  {
    id,
    startup,
    requestSignal = new AbortController().signal,
  }: {
    id: string
    startup: AppUrlState
    requestSignal?: AbortSignal
  }
): Promise<RouteInitResult<FileLoaderData>> {
  // Before multi-file web projects, the editor used
  // `/file/%2Fbrowser%2Fmain.kcl` for its virtual browser project. Send those
  // legacy entry URLs Home, where startup selects the current default project.
  // Remove when support for pre-OPFS URLs ends.
  if (id?.startsWith('/browser')) {
    // Transitional loader cancellation: this legacy branch returns before it
    // can call openProject, so the loader-era implementation must explicitly
    // invalidate an earlier file loader. Startup inversion removes this call.
    app.registry.get(appNavigationService).supersedeProjectOpen(requestSignal)
    // Continue at Home, which may select the default web project.
    return {
      kind: 'transition',
      destination: { type: 'home' },
      urlState: { search: '', hash: '' },
    }
  }

  const outcome = await app.registry.get(appNavigationService).openProject({
    target: id,
    startup,
    signal: requestSignal,
  })
  return { kind: 'ready', data: outcome.data }
}

/**
 * Initialization for `/home` and `/library/:libraryId`.
 *
 * Unflagged web has no home, so startup continues through the index policy to
 * its default project. Otherwise this clears the currently-open project — the
 * projects listed there may be stale.
 */
export async function initHomeRoute(
  app: App
): Promise<RouteInitResult<HomeLoaderData>> {
  // Unflagged web continues through the index startup policy.
  if (!window.electron && !(await webHomeRouteEnabled(app))) {
    return {
      kind: 'transition',
      destination: { type: 'index' },
      urlState: { search: '', hash: '' },
    }
  }

  return { kind: 'ready', data: loadHomeProjects(app) }
}
