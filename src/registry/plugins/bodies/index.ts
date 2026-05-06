import { computed, signal } from '@preact/signals-core'
import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { userHasFeature } from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'
import { featureTreeSectionsValueSpec } from '@src/registry/contracts/featureTree'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { createElement, lazy, Suspense } from 'react'

const BODIES_PANE_FEATURE_FLAG = 'bodies_pane'

const BodiesFeatureTreeSection = lazy(() =>
  import('@src/components/layout/areas/BodiesPane').then((module) => ({
    default: module.BodiesFeatureTreeSection,
  }))
)

function LazyBodiesFeatureTreeSection() {
  return createElement(
    Suspense,
    { fallback: null },
    createElement(BodiesFeatureTreeSection)
  )
}

const bodiesFeatureTreeSectionItem = defineRegistryItemFactory(() => {
  const enabled = signal(false)

  userHasFeature(BODIES_PANE_FEATURE_FLAG, false)
    .then((hasFeature) => {
      enabled.value = hasFeature
    })
    .catch(reportRejection)

  return {
    item: defineRuntimeRegistryItem({
      id: 'bodies.feature-tree-section',
      provides: [
        provide(
          featureTreeSectionsValueSpec,
          computed(() =>
            enabled.value
              ? {
                  id: 'bodies',
                  order: 100,
                  Component: LazyBodiesFeatureTreeSection,
                }
              : undefined
          ),
          { key: 'bodies.feature-tree-section' }
        ),
      ],
    }),
  }
}, 'bodies.feature-tree-section')

const bodies = createZdsPlugin({
  id: 'bodies',
  title: 'Bodies pane',
  description: 'Shows generated solid bodies inside the Feature Tree.',
  items: [bodiesFeatureTreeSectionItem],
  defaultSetting: 'core',
})

export default bodies
