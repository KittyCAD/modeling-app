import { createCloudStorage } from '@src/lib/fileSystem/cloud/storage'
import { authService } from '@src/registry/contracts/auth'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { createMountedFileOperations } from '@src/lib/fileSystem/mounts'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import fsZds from '@src/lib/fs-zds'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { createProjectOperations } from '@src/lib/fileSystem/projectOperations'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import {
  cloudStorageService,
  fileOperationsService,
  projectOperationsService,
} from '@src/registry/contracts/fileOperations'

export const createFileOperationsExtension = (backing: IZooDesignStudioFS) =>
  defineRegistryItemFactory((ctx) => {
    const fileOperations = createFileOperationsRuntime(backing)

    const mounted = createMountedFileOperations(
      fileOperations.operations,
      backing
    )
    const cloud = createCloudStorage(backing, () => ({
      enabled: true,
      token: ctx.services.optional(authService)?.token.peek(),
    }))
    mounted.mount({ root: cloud.root, operations: cloud.operations })
    const projects = createProjectOperations({
      operations: mounted.operations,
      batch: (root, run) =>
        root === cloud.root || root.startsWith(`${cloud.root}${backing.sep}`)
          ? cloud.batch(root, run)
          : run(mounted.operations),
      wasm: () =>
        ctx.valueSpecs.get(wasmPromiseValueSpec) ??
        Promise.reject(new Error('Missing WASM promise.')),
    })

    return {
      id: 'file-operations-extension',
      providesServices: [
        provideService(projectOperationsService, projects),
        provideService(cloudStorageService, cloud),
        provideService(fileOperationsService, mounted.operations),
      ],
      // The registry owns the mounted node; the Effect runtime owns and
      // finalizes every scoped resource used by that node.
      dispose: async () => {
        await cloud.dispose()
        await fileOperations.dispose()
      },
    }
  }, 'file-operations-extension')

export const fileOperationsExtension = createFileOperationsExtension(fsZds)

export default defineRegistryItem({
  id: 'file-operations',
  uses: [fileOperationsExtension],
})
