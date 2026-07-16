import {
  defineContract,
  defineService,
  defineValueSpec,
  mergeObjectsValueSpec,
} from '@kittycad/registry'
import type {
  ActionLibrary,
  AreaLibrary,
  LayoutContribution,
  LayoutService,
} from '@src/lib/layout/types'

export const layoutContract = defineContract({
  layoutService: defineService<LayoutService>('layout.service'),
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
