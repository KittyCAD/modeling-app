import type { Signal } from '@preact/signals-core'
import type {
  EnsureLayoutContributionOptions,
  Layout,
  LayoutContribution,
  LayoutContributionResult,
  LayoutService,
} from '@src/lib/layout/types'
import { LayoutType } from '@src/lib/layout/types'
import {
  applyLayoutContribution,
  findLayoutParentNode,
  togglePaneLayoutNode,
} from '@src/lib/layout/utils'
import {
  defineRegistryItem,
  provideService,
  type RegistryItemDefinition,
} from '@kittycad/registry'
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

  function ensureContribution(
    contribution: LayoutContribution,
    options: EnsureLayoutContributionOptions = {}
  ): LayoutContributionResult {
    const rootLayout = structuredClone(layoutSignal.peek())
    const result = applyLayoutContribution({
      rootLayout,
      contribution:
        options.open && contribution.kind === 'area'
          ? { ...contribution, initiallyOpen: true }
          : contribution,
    })
    let opened = false

    if (options.open && contribution.kind === 'area') {
      const parent = findLayoutParentNode({
        rootLayout,
        targetNodeId: contribution.pane.id,
      })
      if (parent?.type === LayoutType.Panes) {
        const index = parent.children.findIndex(
          (child) => child.id === contribution.pane.id
        )
        const isOpen = index >= 0 && parent.activeIndices.includes(index)
        if (index >= 0 && !isOpen) {
          togglePaneLayoutNode({
            rootLayout,
            targetNodeId: contribution.pane.id,
            shouldExpand: true,
          })
          opened = true
        }
      }
    }

    if (result.applied || opened) {
      layoutSignal.value = rootLayout
    }

    if (opened && !result.applied) {
      return { applied: true, reason: 'opened' as const }
    }

    return result
  }

  return {
    applyContribution(contribution) {
      return applyContributions([contribution])[0]
    },
    ensureContribution,
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
