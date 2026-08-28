import { defineRegistryItem, provide } from '@kittycad/registry'
import { sceneHudSectionsValueSpec } from '@src/contracts/sceneHud'
import { FeatureTree } from '@src/features/featureTree/FeatureTree'

/** The operation-tree view of the scene's executing KCL buffer. */
export default defineRegistryItem({
  id: 'featureTree',
  provides: [
    provide(sceneHudSectionsValueSpec, {
      id: 'scene.features',
      title: 'Features',
      icon: 'layers',
      order: 0,
      render: () => <FeatureTree />,
    }),
  ],
})
