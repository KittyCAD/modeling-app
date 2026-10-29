import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  type EngineConnectionService,
  engineConnectionService,
} from '@src/lib/engineConnection/registry/contract'
import { EngineConnectionManagerEvents } from '@src/lib/engineConnection/utils'
import { settingsService } from '@src/registry/contracts/settings'

export const engineConnectionExtension = defineRegistryItemFactory((ctx) => {
  let service: EngineConnectionService | undefined
  let unsubscribeAvailability: (() => void) | undefined

  const ensureService = () => {
    if (service) {
      return service
    }

    const settings = ctx.services.get(settingsService)
    const manager = new ConnectionManager({
      settingsActor: settings.actor,
    })
    // The registry owns the reactive adapter for this manager's lifetime.
    const connectionAvailability = signal(manager.availability)
    const syncAvailability = () => {
      connectionAvailability.value = manager.availability
    }
    manager.addEventListener(
      EngineConnectionManagerEvents.AvailabilityChanged,
      syncAvailability
    )
    unsubscribeAvailability = () => {
      manager.removeEventListener(
        EngineConnectionManagerEvents.AvailabilityChanged,
        syncAvailability
      )
    }
    service = { manager, connectionAvailability }
    return service
  }

  return {
    id: 'engine-connection-extension',
    providesServices: [
      provideService(engineConnectionService, {
        get connectionAvailability() {
          return ensureService().connectionAvailability
        },
        get manager() {
          return ensureService().manager
        },
      }),
    ],
    dispose: () => {
      service?.manager.tearDown({
        route: 'service-disposed',
        initiatedBy: 'client',
      })
      unsubscribeAvailability?.()
    },
  }
}, 'engine-connection-extension')

export default defineRegistryItem({
  id: 'engine-connection',
  uses: [engineConnectionExtension],
})
