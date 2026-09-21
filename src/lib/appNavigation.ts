import type { ResolvedProjectOpen } from '@src/lib/projectOpen'
import type {
  AppNavigationIntent,
  AppNavigationIntentContribution,
  AppNavigationService,
  OpenProjectOutcome,
  OpenProjectRequest,
} from '@src/registry/contracts/appNavigation'
import {
  defineAppNavigationIntentContribution,
  openProjectIntent,
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
  showHome: (
    openProject: (request: OpenProjectRequest) => Promise<OpenProjectOutcome>
  ) => Promise<void>
}

/**
 * Build the application-intent coordinator around narrow project operations.
 *
 * The coordinator owns only transient intent ordering. Project resolution and
 * project-session effects are separate operations so neither tests nor future
 * callers need to impersonate the entire App runtime.
 */
export function createOpenProjectIntentContribution(
  dependencies: AppNavigationDependencies
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

/**
 * Build appNavigation from the contributions available before startup.
 *
 * The copied map deliberately does not react to later registry changes. A
 * contribution that changes cold-start URL semantics takes effect on the next
 * application launch.
 */
export function createAppNavigationService(
  contributions: readonly AppNavigationIntentContribution[],
  {
    supersedeProjectOpen,
    showHome,
  }: {
    supersedeProjectOpen: AppNavigationService['supersedeProjectOpen']
    showHome?: AppNavigationService['showHome']
  }
): AppNavigationService {
  const contributionsById = new Map<string, AppNavigationIntentContribution>()
  const duplicateIntentIds = new Set<string>()
  for (const contribution of contributions) {
    if (contributionsById.has(contribution.intentId)) {
      duplicateIntentIds.add(contribution.intentId)
    }
    contributionsById.set(contribution.intentId, contribution)
  }

  const dispatch = async <Input, Output>(
    intent: AppNavigationIntent<Input, Output>,
    input: Input
  ): Promise<Output> => {
    if (duplicateIntentIds.has(intent.id)) {
      return Promise.reject(
        new Error(
          `Multiple application navigation intents handle ${intent.id}.`
        )
      )
    }
    const contribution = contributionsById.get(intent.id)
    if (!contribution) {
      return Promise.reject(
        new Error(`No application navigation intent handles ${intent.id}.`)
      )
    }
    return contribution.dispatch(input) as Promise<Output>
  }

  return {
    dispatch,
    showHome: showHome ?? (async () => undefined),
    supersedeProjectOpen,
  }
}
