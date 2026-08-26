import { defineContract, defineService } from '@kittycad/registry'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'

export type EngineConnectionService = {
  readonly manager: ConnectionManager
}

export const engineConnectionContract = defineContract({
  engineConnectionService:
    defineService<EngineConnectionService>('engine-connection'),
})

export const { engineConnectionService } = engineConnectionContract
