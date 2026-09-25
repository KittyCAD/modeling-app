import type { ResolvedProjectOpen } from '@src/lib/projectOpen'
import { signal } from '@preact/signals-core'
import type {
  AppNavigationIntent,
  AppNavigationIntentContribution,
  AppNavigationService,
  OpenProjectOutcome,
  OpenProjectRequest,
  ShowHomeRequest,
} from '@src/registry/contracts/appNavigation'
import {
  defineAppNavigationIntentContribution,
  openProjectIntent,
  showHomeIntent,
} from '@src/registry/contracts/appNavigation'
import type { ParsedAppNavigationIntent } from '@src/registry/contracts/appUrl'

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
  showHome: (request: ShowHomeRequest) => Promise<void>
}

/** Build the Home handler while keeping project-open cancellation private. */
export function createShowHomeIntentContribution(
  dependencies: AppNavigationDependencies,
  cancelProjectOpen: () => void
): AppNavigationIntentContribution {
  return defineAppNavigationIntentContribution(
    showHomeIntent,
    async (request) => {
      cancelProjectOpen()
      await dependencies.showHome(request)
    }
  )
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
  cancelProjectOpen: () => void
} {
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

  const openProject = async (
    request: OpenProjectRequest
  ): Promise<OpenProjectOutcome> => {
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

  return {
    contribution: defineAppNavigationIntentContribution(
      openProjectIntent,
      openProject
    ),
    cancelProjectOpen: cancelActiveProjectOpen,
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
  contributions: readonly AppNavigationIntentContribution[]
): AppNavigationService {
  const activeAdditionalIntent = signal<ParsedAppNavigationIntent | undefined>(
    undefined
  )
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
    const output = (await contribution.dispatch(input)) as Output
    if (intent.placement === 'additional') {
      activeAdditionalIntent.value = { intent, input }
    } else {
      activeAdditionalIntent.value = undefined
    }
    return output
  }

  return {
    activeAdditionalIntent,
    dispatch,
    dismissAdditionalIntent: () => {
      activeAdditionalIntent.value = undefined
    },
  }
}
