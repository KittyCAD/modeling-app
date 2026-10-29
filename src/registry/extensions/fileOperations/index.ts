import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import fsZds from '@src/lib/fs-zds'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { createProjectOperations } from '@src/lib/fileSystem/projectOperations'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import {
  fileOperationsService,
  projectOperationsService,
} from '@src/registry/contracts/fileOperations'

export const createFileOperationsExtension = (backing: IZooDesignStudioFS) =>
  defineRegistryItemFactory((ctx) => {
    const fileOperations = createFileOperationsRuntime(backing)

    const projects = createProjectOperations({
      operations: fileOperations.operations,
      wasm: () =>
        ctx.valueSpecs.get(wasmPromiseValueSpec) ??
        Promise.reject(new Error('Missing WASM promise.')),
    })

    return {
      id: 'file-operations-extension',
      providesServices: [
        provideService(projectOperationsService, projects),
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
