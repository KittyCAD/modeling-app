import { createFileWorkflows } from '@src/lib/fileSystem/workflows/service'
import { projectSession } from '@src/registry/contracts/projectSession'
import { createCloudStorage } from '@src/registry/extensions/fileOperations/cloud'
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
  fileWorkflowsService,
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
      accountId:
        ctx.services.optional(authService)?.user.peek()?.id ||
        ctx.services.optional(authService)?.token.peek(),
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

    const wasmPromise = Promise.resolve().then(
      () =>
        ctx.valueSpecs.get(wasmPromiseValueSpec) ??
        Promise.reject(new Error('Missing WASM promise.'))
    )
    // A registry can mount storage without mounting modeling/WASM capabilities.
    void wasmPromise.catch(() => undefined)
    const workflows = createFileWorkflows({
      batch: (root, run) =>
        cloud.batch(root, (operations) => {
          const scoped = createMountedFileOperations(
            fileOperations.operations,
            backing
          )
          scoped.mount({ root: cloud.root, operations })
          return run(scoped.operations)
        }),
      get fileOperations() {
        return mounted.operations
      },
      get project() {
        return ctx.services.get(projectSession).getProject()
      },
      wasmPromise,
    })
    return {
      id: 'file-operations-extension',
      providesServices: [
        provideService(fileWorkflowsService, workflows),
        provideService(projectOperationsService, projects),
        provideService(cloudStorageService, cloud),
        provideService(fileOperationsService, mounted.operations),
      ],
      // The registry owns the mounted node; the Effect runtime owns and
      // finalizes every scoped resource used by that node.
      dispose: async () => {
        await workflows.dispose()
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
