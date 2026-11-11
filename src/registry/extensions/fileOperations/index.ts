import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import {
  createMountedFileOperations,
  type FileOperationsMount,
} from '@src/lib/fileSystem/mounts'
import { createProjectOperations } from '@src/lib/projectSession/projectOperations'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import fsZds from '@src/lib/fs-zds'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  fileOperationsService,
  projectOperationsService,
  fileOperationsMountsValueSpec,
} from '@src/registry/contracts/fileOperations'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

/** Coordinates file operations over contributed backings without owning their lifetimes. */
export function createFileOperationsServices(
  paths: IZooDesignStudioFS,
  wasm: () => Promise<ModuleType> = () =>
    Promise.reject(new Error('Missing WASM promise.')),
  mounts: () => readonly FileOperationsMount[] = () => []
) {
  const runtime = createFileOperationsRuntime(paths)
  const mounted = createMountedFileOperations(runtime.operations, paths, mounts)
  return {
    operations: mounted.operations,
    projects: createProjectOperations({
      operations: mounted.operations,
      batch: mounted.batch,
      wasm,
    }),
    dispose: runtime.dispose,
  }
}

export const createFileOperationsExtension = (backing: IZooDesignStudioFS) =>
  defineRegistryItemFactory((ctx) => {
    const services = createFileOperationsServices(
      backing,
      () =>
        ctx.valueSpecs.get(wasmPromiseValueSpec) ??
        Promise.reject(new Error('Missing WASM promise.')),
      () => ctx.valueSpecs.get(fileOperationsMountsValueSpec)
    )
    return {
      id: 'file-operations-extension',
      providesServices: [
        provideService(projectOperationsService, services.projects),
        provideService(fileOperationsService, services.operations),
      ],
      dispose: services.dispose,
    }
  }, 'file-operations-extension')

export const fileOperationsExtension = createFileOperationsExtension(fsZds)
export default defineRegistryItem({
  id: 'file-operations',
  uses: [fileOperationsExtension],
})
