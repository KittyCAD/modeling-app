import { defineContract, defineService } from '@kittycad/registry'
import type { MachineManager } from '@src/lib/MachineManager'

export const machineManagerContract = defineContract({
  machineManagerService: defineService<MachineManager>('machine-manager'),
})

export const { machineManagerService } = machineManagerContract
