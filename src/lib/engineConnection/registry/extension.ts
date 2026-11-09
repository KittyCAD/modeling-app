import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  type EngineConnectionService,
  engineConnectionService,
} from '@src/lib/engineConnection/registry/contract'
import { settingsService } from '@src/registry/contracts/settings'
import { provide, type Subtree } from 'plankton'
export const engineConnectionExtension = {
  key: 'engine-connection-extension',
  create: (ctx) => {
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
} satisfies Subtree
export default [engineConnectionExtension]
