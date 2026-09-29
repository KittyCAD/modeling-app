import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { MachineManager } from '@src/lib/MachineManager'
import { machineManagerService } from '@src/registry/contracts/machineManager'

export const machineManagerExtension = defineRegistryItemFactory(() => {
  const machineManager =
    typeof window !== 'undefined' && window.electron
      ? new MachineManager({
          getMachineApiIp: window.electron.getMachineApiIp,
          listMachines: window.electron.listMachines,
        })
      : new MachineManager()

  return {
    id: 'machine-manager-extension',
    providesServices: [
      provideService(machineManagerService, { manager: machineManager }),
    ],
  }
}, 'machine-manager-extension')

export default defineRegistryItem({
  id: 'machine-manager',
  uses: [machineManagerExtension],
})
