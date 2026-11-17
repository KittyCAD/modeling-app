import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { editorOnSaveValueSpec } from '@src/lib/save/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'

/** The default storage strategy: write the requested snapshot before dependent save steps. */
const extension = defineRegistryItemFactory(
  ({ services }) => ({
    provides: [
      provide(editorOnSaveValueSpec, {
        id: 'save.persistToFiles',
        matches: '*',
        order: -100,
        onSave: async ({ src, contents }) => {
          await services.get(fileOperationsService).writeFile(src, contents)
          return undefined
        },
      }),
    ],
  }),
  'save.persistToFiles'
)

export default withProjectShellFeature(extension, 'save.persistToFiles')
