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
  let projectOpenGeneration = 0

  const beginProjectOpen = (signal = new AbortController().signal) => {
    const generation = ++projectOpenGeneration
    return () => {
      if (signal.aborted || generation !== projectOpenGeneration) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new DOMException('Superseded project open', 'AbortError')
      }
    }
  }

  return {
    openProject: async (request) => {
      const assertCurrent = beginProjectOpen(request.signal)
      const resolution = await dependencies.resolveProjectOpen(
        request,
        assertCurrent
      )
      assertCurrent()

      if (resolution.kind === 'redirect') {
        return resolution
      }

      return dependencies.openResolvedProject(resolution, assertCurrent)
    },
    supersedeProjectOpen: (signal) => {
      beginProjectOpen(signal)()
    },
  }
}
