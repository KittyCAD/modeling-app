import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  type EngineConnectionService,
  engineConnectionService,
} from '@src/lib/engineConnection/registry/contract'
import { observations as settingsObservations } from '@src/registry/contracts/settings'
import { extension as defineExtension, provide, type Extension } from 'plankton'
export const engineConnectionExtension = defineExtension({
  dependencies: { settings: settingsObservations },
  key: 'engine-connection-extension',
  create: ({ settings: settingsInputs }) => {
    let service: EngineConnectionService | undefined

    const ensureService = () => {
      if (service) {
        return service
      }
      const settings = settingsInputs.settingsService.required()
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
