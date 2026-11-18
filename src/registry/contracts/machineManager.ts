import type { MachineManager } from '@src/lib/MachineManager'
import { contract, service } from 'plankton'
export type MachineManagerRegistryService = {
  readonly manager: MachineManager
}
export const machineManagerContract = contract({
  machineManagerService:
    service<MachineManagerRegistryService>('machine-manager'),
})

export const { machineManagerService } = machineManagerContract
