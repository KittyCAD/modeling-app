import { defineContract, defineService } from '@kittycad/registry'
import type { MachineManager } from '@src/lib/MachineManager'

export type MachineManagerRegistryService = {
  readonly manager: MachineManager
}

export const machineManagerContract = defineContract({
  machineManagerService:
    defineService<MachineManagerRegistryService>('machine-manager'),
})

export const { machineManagerService } = machineManagerContract
