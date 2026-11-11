import {
  createMountedFileOperations,
  type FileOperationsMount,
} from '@src/lib/fileSystem/mounts'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import fsZds from '@src/lib/fs-zds'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import {
  fileOperationsService,
  fileOperationsMountsValueSpec,
} from '@src/registry/contracts/fileOperations'

/** Coordinates contributed backings while their providers retain ownership of their runtimes. */
export function createFileOperationsServices(
  backing: IZooDesignStudioFS,
  mounts: () => readonly FileOperationsMount[] = () => []
) {
  const runtime = createFileOperationsRuntime(backing)
  const mounted = createMountedFileOperations(
    runtime.operations,
    backing,
    mounts
  )
  return {
    operations: mounted.operations,
    batch: mounted.batch,
    dispose: runtime.dispose,
  }
}

export const createFileOperationsExtension = (backing: IZooDesignStudioFS) =>
  defineRegistryItemFactory((ctx) => {
    const fileOperations = createFileOperationsServices(backing, () =>
      ctx.valueSpecs.get(fileOperationsMountsValueSpec)
    )

    return {
      id: 'file-operations-extension',
      providesServices: [
        provideService(fileOperationsService, fileOperations.operations),
      ],
      // The registry owns the mounted node; the Effect runtime owns and
      // finalizes every scoped resource used by that node.
      dispose: () => fileOperations.dispose(),
    }
  }, 'file-operations-extension')

export const fileOperationsExtension = createFileOperationsExtension(fsZds)

export default defineRegistryItem({
  id: 'file-operations',
  uses: [fileOperationsExtension],
})
