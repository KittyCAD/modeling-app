import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import fsZds from '@src/lib/fs-zds'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'

export const createFileOperationsExtension = (backing: IZooDesignStudioFS) =>
  defineRegistryItemFactory(() => {
    const fileOperations = createFileOperationsRuntime(backing)

    return {
      model: fileOperations,
      item: defineRuntimeRegistryItem({
        id: 'file-operations-extension',
        providesServices: [
          provideService(fileOperationsService, fileOperations.operations),
        ],
        // The registry owns the mounted node; the Effect runtime owns and
        // finalizes every scoped resource used by that node.
        dispose: () => fileOperations.dispose(),
      }),
    }
  }, 'file-operations-extension')

export const fileOperationsExtension = createFileOperationsExtension(fsZds)

export default defineRegistryItem({
  id: 'file-operations',
  uses: [fileOperationsExtension],
})
