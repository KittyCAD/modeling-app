import { factory, contribute } from 'plankton'
import { observations as fileObservations } from '@src/registry/contracts/fileOperations'
import { editorOnSaveFacet } from '@src/lib/save/registry/contract'
import { withProjectShellFeature } from '@src/lib/projectSession/next/feature'

/** The default storage strategy: write the requested snapshot before dependent save steps. */
const extension = factory({
  key: 'save.persistToFiles',
  dependencies: { files: fileObservations },
  create: ({ files }) => ({
    items: [
      contribute(editorOnSaveFacet, () => ({
        id: 'save.persistToFiles',
        matches: '*' as const,
        order: -100,
        onSave: async ({ src, contents }) => {
          await files.fileOperationsService.required().writeFile(src, contents)
          return undefined
        },
      })),
    ],
  }),
})

export default withProjectShellFeature(extension, 'save.persistToFiles')
