import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { createFileSystemRuntime } from '@src/lib/fileSystem/runtime'
import fsZds from '@src/lib/fs-zds'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { fileSystemService } from '@src/registry/contracts/fileSystem'

export const createFileSystemExtension = (backing: IZooDesignStudioFS) =>
  defineRegistryItemFactory(() => {
    const fileSystem = createFileSystemRuntime(backing)

    return {
      model: fileSystem,
      item: defineRuntimeRegistryItem({
        id: 'file-system-extension',
        providesServices: [
          provideService(fileSystemService, fileSystem.service),
        ],
        // The registry owns the mounted node; the Effect runtime owns and
        // finalizes every scoped filesystem resource within that node.
        dispose: () => fileSystem.dispose(),
      }),
    }
  }, 'file-system-extension')

export const fileSystemExtension = createFileSystemExtension(fsZds)

export default defineRegistryItem({
  id: 'file-system',
  uses: [fileSystemExtension],
})
