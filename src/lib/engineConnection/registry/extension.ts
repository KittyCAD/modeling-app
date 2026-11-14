import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  type EngineConnectionService,
  engineConnectionService,
} from '@src/lib/engineConnection/registry/contract'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsExtension } from '@src/registry/extensions/settings'
import { factory as defineFactory, provide, type Factory } from 'plankton'
export const createEngineConnectionExtension = (
  settings: Factory<SettingsRegistryService> = settingsExtension
) =>
  defineFactory({
    dependencies: { settings },
    key: 'engine-connection-extension',
    create: ({ settings }) => {
      let service: EngineConnectionService | undefined

      const ensureService = () => {
        if (service) {
          return service
        }
        const manager = new ConnectionManager({
          settingsActor: settings.actor,
        })
        service = { manager }
        return service
      }

      const serviceImpl: EngineConnectionService = {
        get manager() {
          return ensureService().manager
        },
      }
      return {
        exports: serviceImpl,
        items: [provide(engineConnectionService, serviceImpl)],
        dispose: () => {
          service?.manager.tearDown({
            route: 'service-disposed',
            initiatedBy: 'client',
          })
        },
      }
    },
  }) satisfies Factory
export const engineConnectionExtension = createEngineConnectionExtension()
export default [engineConnectionExtension]
