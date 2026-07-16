import type { Feature } from '@kittycad/lib'
import {
  defineContract,
  defineService,
  defineValueSpec,
  mergeObjectsValueSpec,
} from '@kittycad/registry'
import type {
  ActionLibrary,
  AreaLibrary,
  Layout,
  LayoutContribution,
  LayoutService,
} from '@src/lib/layout/types'

/**
 * An idempotent layout transformation controlled by a user feature.
 *
 * Transformations must handle both enabled and disabled states so that the
 * layout can follow feature changes after user features finish loading.
 */
export type UserFeatureLayoutTransformation = {
  id: string
  feature: Feature
  defaultValue?: boolean
  transform: (layout: Layout, enabled: boolean) => Layout
}

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
  layoutUserFeatureTransformationsValueSpec: defineValueSpec<
    UserFeatureLayoutTransformation,
    readonly UserFeatureLayoutTransformation[]
  >({
    name: 'layout.userFeatureTransformations',
    defaultValue: [],
    combine: (inputs) => {
      const seen = new Set<string>()
      return inputs.filter((transformation) => {
        if (seen.has(transformation.id)) {
          return false
        }
        seen.add(transformation.id)
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
  layoutUserFeatureTransformationsValueSpec,
} = layoutContract
