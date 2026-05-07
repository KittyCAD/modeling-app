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

const AnnotationViewsFeatureTreeSection = lazy(() =>
  import('@src/components/layout/areas/AnnotationViewsFeatureTreeSection').then(
    (module) => ({
      default: module.AnnotationViewsFeatureTreeSection,
    })
  )
)

function LazyAnnotationViewsFeatureTreeSection() {
  return createElement(
    Suspense,
    { fallback: null },
    createElement(AnnotationViewsFeatureTreeSection)
  )
}

const annotationViewsFeatureTreeSectionItem = defineRegistryItemFactory(() => {
  const enabled = signal(false)

  userHasFeature(BODIES_PANE_FEATURE_FLAG, false)
    .then((hasFeature) => {
      enabled.value = hasFeature
    })
    .catch(reportRejection)

  return {
    item: defineRuntimeRegistryItem({
      id: 'annotation-views.feature-tree-section',
      provides: [
        provide(
          featureTreeSectionsValueSpec,
          computed(() =>
            enabled.value
              ? {
                  id: 'annotationViews',
                  order: 110,
                  Component: LazyAnnotationViewsFeatureTreeSection,
                }
              : undefined
          ),
          { key: 'annotation-views.feature-tree-section' }
        ),
      ],
    }),
  }
}, 'annotation-views.feature-tree-section')

const annotationViews = createZdsPlugin({
  id: 'annotationViews',
  title: 'Annotation views',
  description: 'Shows saved named views with annotation visibility controls.',
  items: [annotationViewsFeatureTreeSectionItem],
  defaultSetting: 'core',
})

export default annotationViews
