import { MachineManager } from '@src/lib/MachineManager'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { factory as defineFactory, provide, type Factory } from 'plankton'
export const machineManagerExtension = defineFactory({
  key: 'machine-manager-extension',
  create: () => {
    const machineManager =
      typeof window !== 'undefined' && window.electron
        ? new MachineManager({
            getMachineApiIp: window.electron.getMachineApiIp,
            listMachines: window.electron.listMachines,
          })
        : new MachineManager()

    const service = { manager: machineManager }
    return {
      exports: service,
      items: [provide(machineManagerService, service)],
    }
  },
}) satisfies Factory
export default [machineManagerExtension]
