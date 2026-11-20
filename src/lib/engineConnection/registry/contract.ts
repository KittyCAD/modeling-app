import { inputs, observeService } from '@src/registry/inputs'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { contract, service } from 'plankton'
export type EngineConnectionService = {
  readonly manager: ConnectionManager
}
export const engineConnectionContract = contract({
  engineConnectionService:
    service<EngineConnectionService>('engine-connection'),
})

export const { engineConnectionService } = engineConnectionContract

export const observations = inputs({
  engineConnectionService: observeService(engineConnectionService),
})
