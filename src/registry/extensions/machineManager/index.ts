import { MachineManager } from '@src/lib/MachineManager'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { provide, type Subtree } from 'plankton'
export const machineManagerExtension = {
  key: 'machine-manager-extension',
  create: () => {
    const machineManager =
      typeof window !== 'undefined' && window.electron
        ? new MachineManager({
            getMachineApiIp: window.electron.getMachineApiIp,
            listMachines: window.electron.listMachines,
          })
        : new MachineManager()

    return {
      items: [provide(machineManagerService, { manager: machineManager })],
    }
  },
} satisfies Subtree
export default [machineManagerExtension]
