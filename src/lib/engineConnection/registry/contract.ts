import { defineContract, defineService } from '@kittycad/registry'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'

export type EngineCommandManagerRegistryService = {
  readonly manager: ConnectionManager
}

export const engineCommandManagerContract = defineContract({
  engineCommandManagerService:
    defineService<EngineCommandManagerRegistryService>(
      'engine-command-manager'
    ),
})

export const { engineCommandManagerService } = engineCommandManagerContract
