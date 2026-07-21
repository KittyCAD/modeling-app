import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  type EngineCommandManagerRegistryService,
  engineCommandManagerService,
} from '@src/lib/engineConnection/registry/contract'
import { settingsService } from '@src/registry/contracts/settings'

export const engineCommandManagerExtension = defineRegistryItemFactory(
  (ctx) => {
    let service: EngineCommandManagerRegistryService | undefined

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
        id: 'engine-command-manager-extension',
        providesServices: [
          provideService(engineCommandManagerService, {
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
  },
  'engine-command-manager-extension'
)

export default defineRegistryItem({
  id: 'engine-command-manager',
  uses: [engineCommandManagerExtension],
})
