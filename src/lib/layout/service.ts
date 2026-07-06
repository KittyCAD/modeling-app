import {
  type RegistryItemDefinition,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import type { Signal } from '@preact/signals-core'
import type {
  Layout,
  LayoutContribution,
  LayoutContributionResult,
  LayoutService,
} from '@src/lib/layout/types'
import { applyLayoutContribution } from '@src/lib/layout/utils'
import { layoutService as layoutServiceToken } from '@src/registry/contracts/layout'

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
    applyContribution(contribution) {
      return applyContributions([contribution])[0]
    },
    applyContributions,
  }
}

export function createLayoutServiceRegistryItem(
  layoutService: LayoutService
): RegistryItemDefinition {
  return defineRegistryItem({
    id: 'core.layout-service',
    providesServices: [provideService(layoutServiceToken, layoutService)],
  })
}
