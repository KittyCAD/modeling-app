import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type {
  ConnectionAvailability,
  ConnectionManager,
} from '@src/lib/engineConnection/connectionManager'

export type EngineConnectionService = {
  readonly manager: ConnectionManager
  readonly connectionAvailability: ReadonlySignal<ConnectionAvailability>
}

export const engineConnectionContract = defineContract({
  engineConnectionService:
    defineService<EngineConnectionService>('engine-connection'),
})

export const { engineConnectionService } = engineConnectionContract
