import { defineRegistryItem, provide } from '@kittycad/registry'
import { AreaType } from '@src/lib/layout/types'
import { layoutAreaLibraryValueSpec } from '@src/registry/contracts/layout'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { createElement, lazy, Suspense } from 'react'
import type { ComponentProps, FC } from 'react'

const FeatureTreePane = lazy(() =>
  import('@src/components/layout/areas/FeatureTreePane').then((module) => ({
    default: module.FeatureTreePane,
  }))
)

const LazyFeatureTreePane: FC<ComponentProps<typeof FeatureTreePane>> = (
  props
) =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(FeatureTreePane, props)
  )

const featureTreeAreaItem = defineRegistryItem({
  id: 'feature-tree.area',
  provides: [
    provide(layoutAreaLibraryValueSpec, {
      [AreaType.FeatureTree]: {
        hide: () => false,
        shortcut: 'Shift + T',
        Component: LazyFeatureTreePane,
      },
    }),
  ],
})

const featureTree = createZdsPlugin({
  id: 'featureTree',
  title: 'Feature Tree',
  description: 'Shows the model feature tree and provides extension sections.',
  items: [featureTreeAreaItem],
  defaultSetting: 'core',
})

export default featureTree
