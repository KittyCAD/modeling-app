import { signal } from '@preact/signals-core'
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
  ) => void | Promise<void>
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
  const intentRevision = signal(0)

  const cancelActiveProjectOpen = () => {
    activeProjectOpen?.abort()
    activeProjectOpen = undefined
  }

  const beginProjectOpen = (signal?: AbortSignal) => {
    cancelActiveProjectOpen()
    intentRevision.value += 1

    const controller = new AbortController()
    activeProjectOpen = controller
    const abort = () => controller.abort()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })

    return {
      throwIfSuperseded: () => controller.signal.throwIfAborted(),
      finish: () => {
        signal?.removeEventListener('abort', abort)
        if (activeProjectOpen === controller) {
          activeProjectOpen = undefined
        }
      },
    }
  }

  const openProject: AppNavigationService['openProject'] = async (request) => {
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
      projectOpen.throwIfSuperseded()
      await dependencies.projectOpened(outcome, resolution, request)
      projectOpen.throwIfSuperseded()
      return outcome
    } finally {
      projectOpen.finish()
    }
  }

  const service: AppNavigationService = {
    intentRevision,
    openProject,
    showHome: async () => {
      cancelActiveProjectOpen()
      intentRevision.value += 1
      await dependencies.showHome(service.openProject)
    },
  }

  return service
}
