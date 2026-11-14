import {
  createMountedFileOperations,
  type FileOperationsMount,
} from '@src/lib/fileSystem/mounts'
import { createFileOperationsScheduler } from '@src/lib/fileSystem/scheduler'
import fsZds from '@src/lib/fs-zds'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { createProjectOperations } from '@src/lib/projectSession/projectOperations'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  observations as fileOperationsObservations,
  fileOperationsService,
  projectOperationsService,
} from '@src/registry/contracts/fileOperations'
import { observations as wasmObservations } from '@src/registry/contracts/wasm'
import { factory as defineFactory, provide, type Factory } from 'plankton'

/** Coordinates file operations over contributed backings without owning their lifetimes. */
export function createFileOperationsServices(
  paths: IZooDesignStudioFS,
  wasm: () => Promise<ModuleType> = () =>
    Promise.reject(new Error('Missing WASM promise.')),
  mounts: () => readonly FileOperationsMount[] = () => []
) {
  const scheduler = createFileOperationsScheduler(paths)
  const mounted = createMountedFileOperations(
    scheduler.operations,
    paths,
    mounts
  )
  return {
    operations: mounted.operations,
    projects: createProjectOperations({
      operations: mounted.operations,
      batch: mounted.batch,
      wasm,
    }),
    dispose: scheduler.dispose,
  }
}
export const createFileOperationsExtension = (
  backing: IZooDesignStudioFS
): Factory =>
  defineFactory({
    dependencies: {
      wasm: wasmObservations,
      fileOperations: fileOperationsObservations,
    },
    key: 'file-operations-extension',
    create: ({ wasm: wasmInputs, fileOperations: fileOperationsInputs }) => {
      const services = createFileOperationsServices(
        backing,
        () =>
          wasmInputs.wasmPromiseFacet.value ??
          Promise.reject(new Error('Missing WASM promise.')),
        () => fileOperationsInputs.fileOperationsMountsFacet.value
      )
      return {
        items: [
          provide(projectOperationsService, services.projects),
          provide(fileOperationsService, services.operations),
        ],
        dispose: services.dispose,
      }
    },
  })
export const fileOperationsExtension = createFileOperationsExtension(fsZds)
export default [fileOperationsExtension]
