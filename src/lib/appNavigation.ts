import type { ResolvedProjectOpen } from '@src/lib/projectOpen'
import type {
  AppNavigationService,
  OpenProjectOutcome,
  OpenProjectRequest,
} from '@src/registry/contracts/appNavigation'

export interface AppNavigationDependencies {
  resolveProjectOpen: (
    request: OpenProjectRequest,
    throwIfSuperseded: () => void
  ) => Promise<ResolvedProjectOpen>
  openResolvedProject: (
    resolution: ResolvedProjectOpen,
    throwIfSuperseded: () => void
  ) => Promise<OpenProjectOutcome>
  projectOpened: (
    outcome: OpenProjectOutcome,
    resolution: ResolvedProjectOpen,
    request: OpenProjectRequest
  ) => void
  showHome: (openProject: AppNavigationService['openProject']) => Promise<void>
}

/**
 * Build the application-intent coordinator around narrow project operations.
 *
 * The coordinator owns only transient intent ordering. Project resolution and
 * project-session effects are separate operations so neither tests nor future
 * callers need to impersonate the entire App runtime.
 */
export function createAppNavigationService(
  dependencies: AppNavigationDependencies
): AppNavigationService {
  let activeProjectOpen: AbortController | undefined

  const cancelActiveProjectOpen = () => {
    activeProjectOpen?.abort()
    activeProjectOpen = undefined
  }

  const beginProjectOpen = () => {
    cancelActiveProjectOpen()

    const controller = new AbortController()
    activeProjectOpen = controller

    return {
      throwIfSuperseded: () => controller.signal.throwIfAborted(),
      finish: () => {
        if (activeProjectOpen === controller) {
          activeProjectOpen = undefined
        }
      },
    }
  }

  const openProject: AppNavigationService['openProject'] = async (request) => {
    const projectOpen = beginProjectOpen()
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

  const service: AppNavigationService = {
    openProject,
    showHome: async () => {
      cancelActiveProjectOpen()
      await dependencies.showHome(service.openProject)
    },
  }

  return service
}
