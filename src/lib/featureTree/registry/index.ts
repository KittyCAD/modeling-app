import { defineRegistryItem } from '@kittycad/registry'
import { featureTreeExtension } from '@src/lib/featureTree/registry/extension'
import { featureTreeServiceExtension } from '@src/lib/featureTree/registry/service'

export default defineRegistryItem({
  id: 'feature-tree',
  uses: [featureTreeServiceExtension, featureTreeExtension],
})
