import { MachineManager } from '@src/lib/MachineManager'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { extension as defineExtension, provide, type Extension } from 'plankton'
export const machineManagerExtension = defineExtension({
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
}) satisfies Extension
export default [machineManagerExtension]
