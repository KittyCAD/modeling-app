import type { Feature } from '@kittycad/lib'
import type {
  ActionLibrary,
  AreaLibrary,
  Layout,
  LayoutContribution,
  LayoutService,
} from '@src/lib/layout/types'
import { contract, Facet, service } from 'plankton'
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
export const layoutContract = contract({
  layoutService: service<LayoutService>('layout.service'),
  layoutAreaLibraryFacet: new Facet<Partial<AreaLibrary>, AreaLibrary>(
    'layout.areaLibrary',
    (inputs) => Object.assign({}, ...inputs)
  ),
  layoutActionLibraryFacet: new Facet<Partial<ActionLibrary>, ActionLibrary>(
    'layout.actionLibrary',
    (inputs) => Object.assign({}, ...inputs)
  ),
  layoutContributionsFacet: new Facet<
    LayoutContribution,
    readonly LayoutContribution[]
  >('layout.contributions', (inputs) => {
    const seen = new Set<string>()
    return inputs.filter((contribution) => {
      if (seen.has(contribution.id)) return false
      seen.add(contribution.id)
      return true
    })
  }),
  layoutUserFeatureTransformationsFacet: new Facet<
    UserFeatureLayoutTransformation,
    readonly UserFeatureLayoutTransformation[]
  >('layout.userFeatureTransformations', (inputs) => {
    const seen = new Set<string>()
    return inputs.filter((transformation) => {
      if (seen.has(transformation.id)) return false
      seen.add(transformation.id)
      return true
    })
  }),
})

export const {
  layoutService,
  layoutAreaLibraryFacet,
  layoutActionLibraryFacet,
  layoutContributionsFacet,
  layoutUserFeatureTransformationsFacet,
} = layoutContract
