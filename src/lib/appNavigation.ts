import type {
  AppNavigationIntent,
  AppNavigationIntentContribution,
  AppNavigationService,
} from '@src/registry/contracts/appNavigation'
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
    showHome,
  }: {
    showHome?: AppNavigationService['showHome']
  } = {}
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
  }
}
