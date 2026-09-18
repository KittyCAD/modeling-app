import type { ResolvedProjectOpen } from '@src/lib/projectOpen'
import type {
  AppNavigationService,
  OpenProjectOutcome,
  OpenProjectRequest,
} from '@src/registry/contracts/appNavigation'

export interface AppNavigationDependencies {
  resolveProjectOpen: (
    request: OpenProjectRequest,
    assertCurrent: () => void
  ) => Promise<{ kind: 'redirect'; to: string } | ResolvedProjectOpen>
  openResolvedProject: (
    resolution: ResolvedProjectOpen,
    assertCurrent: () => void
  ) => Promise<Extract<OpenProjectOutcome, { kind: 'opened' }>>
  projectOpened: (
    outcome: Extract<OpenProjectOutcome, { kind: 'opened' }>,
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

  const service: AppNavigationService = {
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

      const outcome = await dependencies.openResolvedProject(
        resolution,
        assertCurrent
      )
      dependencies.projectOpened(outcome, request)
      return outcome
    },
    showHome: () => dependencies.showHome(service.openProject),
    supersedeProjectOpen: (signal) => {
      beginProjectOpen(signal)()
    },
  }

  return service
}
