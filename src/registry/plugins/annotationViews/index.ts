import { defineRegistryItem, provide } from '@kittycad/registry'
import { featureTreeSectionsValueSpec } from '@src/registry/contracts/featureTree'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { createElement, lazy, Suspense } from 'react'

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

const annotationViewsFeatureTreeSectionItem = defineRegistryItem({
  id: 'annotation-views.feature-tree-section',
  provides: [
    provide(
      featureTreeSectionsValueSpec,
      {
        id: 'annotationViews',
        order: 110,
        Component: LazyAnnotationViewsFeatureTreeSection,
      },
      { key: 'annotation-views.feature-tree-section' }
    ),
  ],
})

const annotationViews = createZdsPlugin({
  id: 'annotationViews',
  title: 'Annotation views',
  description: 'Shows saved named views with annotation visibility controls.',
  items: [annotationViewsFeatureTreeSectionItem],
  defaultSetting: 'core',
})

export default annotationViews
