import {
  defineContract,
  defineService,
  provideService,
} from '@kittycad/registry'
import type { ConnectionManager } from '@src/network/connectionManager'

export type EngineCommandManagerLike = ConnectionManager

export const engineCommandManagerContract = defineContract({
  engineCommandManagerService: defineService<EngineCommandManagerLike>(
    'engineCommandManager.service'
  ),
})

export const { engineCommandManagerService } = engineCommandManagerContract

export const provideEngineCommandManagerService = (
  engineCommandManager: EngineCommandManagerLike
) => provideService(engineCommandManagerService, engineCommandManager)
