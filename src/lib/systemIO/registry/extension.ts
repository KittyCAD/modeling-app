import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { readProjectsFromProjectDirectory } from '@src/lib/projectLibraries/directoryScanner'
import { systemIOService } from '@src/lib/systemIO/registry/contract'
import { createSystemIOService } from '@src/lib/systemIO/service'
import { systemIOMachineImpl } from '@src/machines/systemIO/systemIOMachineImpl'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { createActor } from 'xstate'

export const systemIOExtension = defineRegistryItemFactory((ctx) => {
  const service = createSystemIOService({
    createActor: (input) => createActor(systemIOMachineImpl, { input }).start(),
    readProjectsFromProjectDirectory: (input) => {
      const wasmInstancePromise =
        ctx.valueSpecs.get(wasmPromiseValueSpec) ??
        Promise.reject(new Error('Missing WASM promise registry value.'))

      return readProjectsFromProjectDirectory({
        projectDirectoryPath: input.projectDirectoryPath,
        wasmInstancePromise,
        previousProjects: input.previousProjects
          ? [...input.previousProjects]
          : undefined,
        signal: input.signal,
        onProgress: input.onProgress,
      })
    },
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'system-io-extension',
      providesServices: [provideService(systemIOService, service)],
      dispose: () => {
        service.dispose()
      },
    }),
  }
}, 'system-io-extension')

export default defineRegistryItem({
  id: 'system-io',
  uses: [systemIOExtension],
})
