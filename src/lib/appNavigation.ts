import type { ResolvedProjectOpen } from '@src/lib/projectOpen'
import type {
  AppNavigationService,
  OpenProjectOutcome,
  OpenProjectRequest,
} from '@src/registry/contracts/appNavigation'

export interface AppNavigationDependencies {
  /**
   * The redirect alternative is transitional while route loaders remain.
   * Once startup dispatches application intents directly, resolution always
   * produces project state and URL canonicalization becomes a later effect.
   */
  resolveProjectOpen: (
    request: OpenProjectRequest,
    assertCurrent: () => void
  ) => Promise<{ kind: 'redirect'; to: string } | ResolvedProjectOpen>
  openResolvedProject: (
    resolution: ResolvedProjectOpen,
    assertCurrent: () => void
  ) => Promise<Extract<OpenProjectOutcome, { kind: 'opened' }>>
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

  const beginProjectOpen = (requestSignal?: AbortSignal) => {
    activeProjectOpen?.abort()

    const controller = new AbortController()
    activeProjectOpen = controller
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, controller.signal])
      : controller.signal

    return {
      assertCurrent: () => signal.throwIfAborted(),
      finish: () => {
        if (activeProjectOpen === controller) {
          activeProjectOpen = undefined
        }
      },
    }
  }

  const openProject: AppNavigationService['openProject'] = async (request) => {
    const projectOpen = beginProjectOpen(request.signal)
    try {
      projectOpen.assertCurrent()
      const resolution = await dependencies.resolveProjectOpen(
        request,
        projectOpen.assertCurrent
      )
      projectOpen.assertCurrent()

      if (resolution.kind === 'redirect') {
        return resolution
      }

      return dependencies.openResolvedProject(
        resolution,
        projectOpen.assertCurrent
      )
    } finally {
      projectOpen.finish()
    }
  }

  return {
    openProject,
    supersedeProjectOpen: (signal) => {
      activeProjectOpen?.abort()
      activeProjectOpen = undefined
      signal?.throwIfAborted()
    },
  }
}
