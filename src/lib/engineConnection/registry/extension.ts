import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  type EngineConnectionService,
  engineConnectionService,
} from '@src/lib/engineConnection/registry/contract'
import { settingsService } from '@src/registry/contracts/settings'

export const engineConnectionExtension = defineRegistryItemFactory((ctx) => {
  let service: EngineConnectionService | undefined

  const ensureService = () => {
    if (service) {
      return service
    }

    const settings = ctx.services.get(settingsService)
    const manager = new ConnectionManager({
      settingsActor: settings.actor,
    })
    service = { manager }
    return service
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'engine-connection-extension',
      providesServices: [
        provideService(engineConnectionService, {
          get manager() {
            return ensureService().manager
          },
        }),
      ],
      dispose: () => {
        service?.manager.tearDown()
      },
    }),
  }
}, 'engine-connection-extension')

export default defineRegistryItem({
  id: 'engine-connection',
  uses: [engineConnectionExtension],
})
