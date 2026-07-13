import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { createSystemIOService } from '@src/lib/systemIO/service'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import {
  systemIOAppContextService,
  systemIOService,
} from '@src/lib/systemIO/registry/contract'

export const systemIOExtension = defineRegistryItemFactory((ctx) => {
  const appContext = ctx.services.signal(systemIOAppContextService)
  const settings = ctx.services.signal(settingsService)
  const wasmPromise = Promise.resolve().then(
    () =>
      ctx.valueSpecs.get(wasmPromiseValueSpec) ??
      Promise.reject(new Error('Missing WASM promise registry value.'))
  )

  const serviceImpl = createSystemIOService({
    wasmPromise,
    getProjectDirectoryPath: () =>
      settings.value?.get().app.projectDirectory.current,
    getDefaultProjectName: () =>
      settings.value?.get().projects.defaultProjectName.current,
    getOpenedProject: () => appContext.value?.getOpenedProject(),
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'system-io-extension',
      providesServices: [provideService(systemIOService, serviceImpl)],
    }),
  }
}, 'system-io-extension')
