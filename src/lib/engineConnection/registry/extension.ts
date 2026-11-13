import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  type EngineConnectionService,
  engineConnectionService,
} from '@src/lib/engineConnection/registry/contract'
import { settingsService } from '@src/registry/contracts/settings'
import { extension as defineExtension, provide, type Extension } from 'plankton'
export const engineConnectionExtension = defineExtension({
  key: 'engine-connection-extension',
  create: (_dependencies, ctx) => {
    let service: EngineConnectionService | undefined

    const ensureService = () => {
      if (service) {
        return service
      }
      const settings = ctx.required(settingsService)
      const manager = new ConnectionManager({
        settingsActor: settings.actor,
      })
      service = { manager }
      return service
    }

    return {
      items: [
        provide(engineConnectionService, {
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
      },
    }
  },
}) satisfies Extension
export default [engineConnectionExtension]
