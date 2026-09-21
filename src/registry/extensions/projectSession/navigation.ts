/**
 * Resolve the legacy `/file/*` input into application-level project state.
 *
 * Cold startup carries already-parsed URL state separately from `target`, so
 * project identity has one source of truth. `canonicalTarget` records the
 * normalized application destination to project after the project opens.
 *
 * The ordering here is load-bearing: the project root is resolved before
 * project settings are loaded because loading settings writes missing files.
 */

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { getStringAfterLastSeparator, parseProjectRoute } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import type { DeepPartial } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import {
  defineAppNavigationIntentContribution,
  type AppNavigationIntentContribution,
} from '@src/registry/contracts/appNavigation'
import {
  openProjectIntent,
  type OpenProjectOutcome,
  type OpenProjectRequest,
} from '@src/registry/contracts/projectSession'

export interface ProjectNavigationDependencies {
  resolveProjectOpen: (
    request: OpenProjectRequest,
    throwIfSuperseded: () => void
  ) => Promise<ResolvedProjectOpen>
  openResolvedProject: (
    resolution: ResolvedProjectOpen,
    throwIfSuperseded: () => void
  ) => Promise<Extract<OpenProjectOutcome, { kind: 'opened' }>>
  projectOpened: (
    outcome: Extract<OpenProjectOutcome, { kind: 'opened' }>,
    resolution: ResolvedProjectOpen,
    request: OpenProjectRequest
  ) => void
  showHome: (
    openProject: (request: OpenProjectRequest) => Promise<OpenProjectOutcome>
  ) => Promise<void>
}

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
  canonicalTarget: string
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
  loadSettings: (projectPath?: string) => Promise<ProjectOpenResolutionSettings>
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
}

export async function resolveProjectOpenRequest(
  dependencies: ProjectOpenResolverDependencies,
  { target, startup }: OpenProjectRequest,
  throwIfSuperseded: () => void
): Promise<ResolvedProjectOpen> {
  const wasmInstance = await dependencies.wasmInstancePromise
  throwIfSuperseded()

  const appSettings = await dependencies.loadSettings()
  throwIfSuperseded()
  const targetLibraryPath = (
    await dependencies.getProjectLibraryOwnership(
      appSettings.settings.app.libraries?.current ?? [],
      target
    )
  )?.libraryPath
  throwIfSuperseded()
  const projectPathData = parseProjectRoute(appSettings.configuration, target, {
    activeProjectPath: dependencies.getCurrentProjectPath(),
    candidateProjectDirectories: targetLibraryPath ? [targetLibraryPath] : [],
  })

  await dependencies.loadSettings(projectPathData.projectPath)
  throwIfSuperseded()

  const { projectName, projectPath } = projectPathData
  let { currentFileName, currentFilePath } = projectPathData
  let canonicalTarget = target
  const isSettingsIntent = startup?.additionalIntents?.some(
    ({ intent }) => intent.id === 'settings.open'
  )

  if (!isSettingsIntent) {
    const fallbackFile = (
      await dependencies.getProjectInfo(projectPath, wasmInstance)
    ).default_file
    throwIfSuperseded()
    let fileExists = true
    if (currentFilePath) {
      try {
        await dependencies.stat(currentFilePath)
        throwIfSuperseded()
      } catch (error) {
        if (dependencies.isPathNotFoundError(error)) {
          fileExists = false
        }
      }
    }

    const wantsProjectDefault =
      Boolean(projectPath) && !currentFileName && fileExists
    const targetUnusable =
      !fileExists || !currentFileName || !currentFilePath || !projectName

    if (wantsProjectDefault) {
      canonicalTarget = fallbackFile
      currentFilePath = fallbackFile
      currentFileName = getStringAfterLastSeparator(fallbackFile)
    } else if (targetUnusable) {
      canonicalTarget = fallbackFile
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
  throwIfSuperseded()

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
    canonicalTarget,
  }
}

/**
 * Build projectSession's application-navigation contribution.
 *
 * The contribution owns transient project-open ordering while durable project
 * and editor state remains behind the projectSession service.
 */
export function createOpenProjectIntentContribution(
  dependencies: ProjectNavigationDependencies
): {
  contribution: AppNavigationIntentContribution
  supersedeProjectOpen: (signal?: AbortSignal) => void
} {
  let activeProjectOpen: AbortController | undefined

  const beginProjectOpen = (requestSignal?: AbortSignal) => {
    activeProjectOpen?.abort()

    const controller = new AbortController()
    activeProjectOpen = controller
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, controller.signal])
      : controller.signal

    return {
      throwIfSuperseded: () => signal.throwIfAborted(),
      finish: () => {
        if (activeProjectOpen === controller) {
          activeProjectOpen = undefined
        }
      },
    }
  }

  const openProject = async (
    request: OpenProjectRequest
  ): Promise<OpenProjectOutcome> => {
    const projectOpen = beginProjectOpen(request.signal)
    try {
      projectOpen.throwIfSuperseded()
      const resolution = await dependencies.resolveProjectOpen(
        request,
        projectOpen.throwIfSuperseded
      )
      projectOpen.throwIfSuperseded()

      const outcome = await dependencies.openResolvedProject(
        resolution,
        projectOpen.throwIfSuperseded
      )
      dependencies.projectOpened(outcome, resolution, request)
      return outcome
    } finally {
      projectOpen.finish()
    }
  }

  return {
    contribution: defineAppNavigationIntentContribution(
      openProjectIntent,
      openProject
    ),
    supersedeProjectOpen: (signal) => {
      activeProjectOpen?.abort()
      activeProjectOpen = undefined
      signal?.throwIfAborted()
    },
  }
}
