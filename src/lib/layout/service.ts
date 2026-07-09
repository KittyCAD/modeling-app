import type { Signal } from '@preact/signals-core'
import type {
  Layout,
  LayoutContribution,
  LayoutContributionResult,
  LayoutService,
} from '@src/lib/layout/types'
import { applyLayoutContribution } from '@src/lib/layout/utils'

export function createLayoutService(
  layoutSignal: Signal<Layout>
): LayoutService {
  function applyContributions(contributions: readonly LayoutContribution[]) {
    const rootLayout = structuredClone(layoutSignal.peek())
    const results: LayoutContributionResult[] = []

    for (const contribution of contributions) {
      results.push(applyLayoutContribution({ rootLayout, contribution }))
    }

    if (results.some((result) => result.applied)) {
      layoutSignal.value = rootLayout
    }

    return results
  }

  return {
    current: layoutSignal,
    applyContribution(contribution) {
      return applyContributions([contribution])[0]
    },
    applyContributions,
  }
}
