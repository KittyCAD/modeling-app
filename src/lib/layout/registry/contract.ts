import {
  defineContract,
  defineService,
  defineValueSpec,
  mergeObjectsValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type {
  ActionLibrary,
  AreaLibrary,
  Layout,
  LayoutContribution,
  LayoutService,
} from '@src/lib/layout/types'

export type LayoutRegistryService = LayoutService & {
  signal: ReadonlySignal<Layout>
  get: () => Layout
  set: (layout: Layout) => void
  reset: () => void
  service: LayoutService
  saveEffectUnsubscribeFn: () => void
}

export const layoutContract = defineContract({
  layoutService: defineService<LayoutRegistryService>('layout.service'),
  layoutAreaLibraryValueSpec: mergeObjectsValueSpec<AreaLibrary>(
    'layout.areaLibrary',
    {}
  ),
  layoutActionLibraryValueSpec: mergeObjectsValueSpec<ActionLibrary>(
    'layout.actionLibrary',
    {}
  ),
  layoutContributionsValueSpec: defineValueSpec<
    LayoutContribution,
    readonly LayoutContribution[]
  >({
    name: 'layout.contributions',
    defaultValue: [],
    combine: (inputs) => {
      const seen = new Set<string>()
      return inputs.filter((contribution) => {
        if (seen.has(contribution.id)) {
          return false
        }
        seen.add(contribution.id)
        return true
      })
    },
  }),
})

export const {
  layoutService,
  layoutAreaLibraryValueSpec,
  layoutActionLibraryValueSpec,
  layoutContributionsValueSpec,
} = layoutContract
