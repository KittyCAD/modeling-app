/**
 * Resolve the legacy `/file/*` input into application-level project state.
 *
 * `requestUrl` is present only during URL restoration. In that case a project
 * root or unusable file produces a canonical redirect. A warm application
 * command has no URL to repair, so the same inputs resolve to the project's
 * default file instead.
 *
 * The ordering here is load-bearing: the project root is resolved before
 * project settings are loaded because loading settings writes missing files.
 */

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import {
  getRouterSearchFromRequestUrl,
  getStringAfterLastSeparator,
  PATHS,
  parseProjectRoute,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import { getOnboardingChildRoute } from '@src/lib/routeLoaderNavigation'
import type { DeepPartial } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { OpenProjectRequest } from '@src/registry/contracts/appNavigation'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

export interface ResolvedProjectOpen {
  kind: 'resolved'
  project: Project
  projectName: string | null
  projectPath: string
  initialEditorPath: string
  file: {
    name: string
    path: string
  }
}

export interface ProjectOpenResolutionSettings {
  settings: {
    app: {
      libraries?: {
        current?: readonly ProjectLibrarySetting[]
      }
    }
  }
  configuration: DeepPartial<Configuration>
}

/** External observations needed to resolve one project-open request. */
export interface ProjectOpenResolverDependencies {
  wasmInstancePromise: Promise<ModuleType>
  loadSettings: (
    wasmInstance: ModuleType,
    projectPath?: string
  ) => Promise<ProjectOpenResolutionSettings>
  getCurrentProjectPath: () => string | undefined
  getProjectLibraryOwnership: (
    libraries: readonly ProjectLibrarySetting[],
    target: string
  ) => Promise<{ libraryPath: string } | undefined>
  getProjectInfo: (
    projectPath: string,
    wasmInstance: ModuleType
  ) => Promise<Project>
  stat: FileOperationsRegistryService['stat']
  isPathNotFoundError: (error: unknown) => boolean
  setProjectDirectory: (projectPath: string) => void
  isDesktop: () => boolean
}

export async function resolveProjectOpenRequest(
  dependencies: ProjectOpenResolverDependencies,
  { target, requestUrl }: OpenProjectRequest,
  assertCurrent: () => void
): Promise<{ kind: 'redirect'; to: string } | ResolvedProjectOpen> {
  const wasmInstance = await dependencies.wasmInstancePromise
  assertCurrent()

  const appSettings = await dependencies.loadSettings(wasmInstance)
  assertCurrent()
  const targetLibraryPath = target
    ? (
        await dependencies.getProjectLibraryOwnership(
          appSettings.settings.app.libraries?.current ?? [],
          target
        )
      )?.libraryPath
    : undefined
  assertCurrent()
  const projectPathData = target
    ? parseProjectRoute(appSettings.configuration, target, {
        activeProjectPath: dependencies.getCurrentProjectPath(),
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

  await dependencies.loadSettings(wasmInstance, projectPathData.projectPath)
  assertCurrent()

  const { projectName, projectPath } = projectPathData
  let { currentFileName, currentFilePath } = projectPathData
  const isSettingsUrl = requestUrl
    ? new URL(requestUrl).pathname.endsWith('/settings')
    : false

  if (!isSettingsUrl) {
    const fallbackFile = (
      await dependencies.getProjectInfo(projectPath, wasmInstance)
    ).default_file
    assertCurrent()
    let fileExists = true
    if (currentFilePath) {
      try {
        await dependencies.stat(currentFilePath)
        assertCurrent()
      } catch (error) {
        if (dependencies.isPathNotFoundError(error)) {
          fileExists = false
        }
      }
    }

    const wantsProjectDefault =
      Boolean(projectPath) && !currentFileName && fileExists && Boolean(target)
    const targetUnusable =
      !fileExists || !currentFileName || !currentFilePath || !projectName

    if (wantsProjectDefault) {
      if (requestUrl && target) {
        return {
          kind: 'redirect',
          to: requestUrl.replace(
            safeEncodeForRouterPaths(target),
            safeEncodeForRouterPaths(fallbackFile)
          ),
        }
      }
      currentFilePath = fallbackFile
      currentFileName = getStringAfterLastSeparator(fallbackFile)
    } else if (targetUnusable) {
      if (requestUrl) {
        const routerSearch = getRouterSearchFromRequestUrl(
          requestUrl,
          dependencies.isDesktop()
        )
        const onboardingChildRoute = target
          ? getOnboardingChildRoute(requestUrl, target)
          : ''
        return {
          kind: 'redirect',
          to: `${PATHS.FILE}/${encodeURIComponent(
            fallbackFile
          )}${onboardingChildRoute}${routerSearch}`,
        }
      }
      currentFilePath = fallbackFile
      currentFileName = getStringAfterLastSeparator(fallbackFile)
    }
  }

  dependencies.setProjectDirectory(projectPath)

  const defaultProject: Project = {
    name: projectName || 'unnamed',
    path: projectPath,
    children: [],
    kcl_file_count: 0,
    directory_count: 0,
    metadata: null,
    default_file: projectPath,
    readWriteAccess: true,
  }

  const project =
    (await dependencies.getProjectInfo(projectPath, wasmInstance)) ??
    defaultProject
  assertCurrent()

  return {
    kind: 'resolved',
    project,
    projectName,
    projectPath,
    initialEditorPath: currentFilePath || PROJECT_ENTRYPOINT,
    file: {
      name: currentFileName || '',
      path: currentFilePath || '',
    },
  }
}
