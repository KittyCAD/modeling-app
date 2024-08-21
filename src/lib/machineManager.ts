import { isDesktop } from './isDesktop'
import { components } from './machine-api'

export type MachinesListing = {
  [key: string]: components['schemas']['Machine']
}

export class MachineManager {
  private _isDesktop: boolean = isDesktop()
  private _machines: MachinesListing = {}
  private _machineApiIp: string | null = null
  private _currentMachine: components['schemas']['Machine'] | null = null

  constructor() {
    if (!this._isDesktop) {
      return
    }

    this.updateMachines()
  }

  start() {
    if (!this._isDesktop) {
      return
    }

    // Start a background job to update the machines every ten seconds.
    // If MDNS is already watching, this timeout will wait until it's done to trigger the
    // finding again.
    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined
    const timeoutLoop = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(async () => {
        await this.updateMachineApiIp()
        await this.updateMachines()
        timeoutLoop()
      }, 10000)
    }
    timeoutLoop()
  }

  get machines(): MachinesListing {
    return this._machines
  }

  machineCount(): number {
    return Object.keys(this._machines).length
  }

  get machineApiIp(): string | null {
    return this._machineApiIp
  }

  // Get the reason message for why there are no machines.
  noMachinesReason(): string | undefined {
    if (this.machineCount() > 0) {
      return undefined
    }

    if (this.machineApiIp === null) {
      return 'Machine API server was not discovered'
    }

    return 'Machine API server was discovered, but no machines are available'
  }

  get currentMachine(): components['schemas']['Machine'] | null {
    return this._currentMachine
  }

  set currentMachine(machine: components['schemas']['Machine'] | null) {
    this._currentMachine = machine
  }

  private async updateMachines(): Promise<void> {
    if (!this._isDesktop) {
      return
    }

    this._machines = await window.electron.listMachines()
    console.log('Machines:', this._machines)
  }

  private async updateMachineApiIp(): Promise<void> {
    if (!this._isDesktop) {
      return
    }

    this._machineApiIp = await window.electron.getMachineApiIp()
  }
}

export const machineManager = new MachineManager()
machineManager.start()
