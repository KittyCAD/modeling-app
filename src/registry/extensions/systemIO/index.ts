import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { systemIOMachineImpl } from '@src/machines/systemIO/systemIOMachineImpl'
import type { SystemIOActor, SystemIOHost } from '@src/machines/systemIO/utils'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { projectSession } from '@src/registry/contracts/projectSession'
import { systemIOService } from '@src/registry/contracts/systemIO'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { createActor } from 'xstate'

/** Own the filesystem workflow actor without requiring a constructed App. */
export default defineRegistryItemFactory((ctx) => {
  let actor: SystemIOActor | undefined
  // Factories run during registry graph assembly. Wait until the service's actor
  // is requested so reading the WASM value does not reenter graph assembly.
  const ensureActor = (): SystemIOActor => {
    if (actor) return actor
    const wasmInstancePromise =
      ctx.valueSpecs.get(wasmPromiseValueSpec) ??
      Promise.reject(new Error('Missing WASM promise registry value.'))
    const host: SystemIOHost = {
      get fileOperations() {
        return ctx.services.get(fileOperationsService)
      },
      get project() {
        return ctx.services.get(projectSession).getProject()
      },
      wasmPromise: wasmInstancePromise,
      get systemIOActor() {
        return createdActor
      },
    }
    const createdActor = createActor(systemIOMachineImpl, {
      input: { wasmInstancePromise, host },
    })
    actor = createdActor
    createdActor.start()
    return createdActor
  }
  return {
    id: 'system-io',
    providesServices: [
      provideService(systemIOService, {
        get actor() {
          return ensureActor()
        },
      }),
    ],
    dispose: () => actor?.stop(),
  }
}, 'system-io')
