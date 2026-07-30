import { defineContract, defineService } from '@kittycad/registry'
import type { SystemIOActor } from '@src/machines/systemIO/utils'

export interface SystemIORegistryService {
  actor: SystemIOActor
}

export const systemIOContract = defineContract({
  systemIOService: defineService<SystemIORegistryService>('system-io'),
})

export const { systemIOService } = systemIOContract
