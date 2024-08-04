import { isTauri } from './isTauri'
import { components } from './machine-api'
import { getMachineApiIp, listMachines } from './tauri'

export class MachineManager {
  private _isTauri: boolean = isTauri()
  private _machines: {
    [key: string]: components['schemas']['Machine']
  } = {}
  private _machineApiIp: string | null = null
  private _currentMachine: components['schemas']['Machine'] | null = null

  constructor() {
    if (!this._isTauri) {
      return
    }

    this.updateMachines()
  }

  start() {
    if (!this._isTauri) {
      return
    }

    // Start a background job to update the machines every ten seconds.
    setInterval(() => {
      this.updateMachineApiIp()
      this.updateMachines()
    }, 10000)
  }

  get machines(): {
    [key: string]: components['schemas']['Machine']
  } {
    return this._machines
  }

  machineCount(): number {
    return Object.keys(this._machines).length
  }

  get machineApiIp(): string | null {
    return this._machineApiIp
  }

  get currentMachine(): components['schemas']['Machine'] | null {
    return this._currentMachine
  }

  set currentMachine(machine: components['schemas']['Machine'] | null) {
    this._currentMachine = machine
  }

  private async updateMachines(): Promise<void> {
    if (!this._isTauri) {
      return
    }

    this._machines = await listMachines()
    console.log('Machines:', this._machines)
  }

  private async updateMachineApiIp(): Promise<void> {
    if (!this._isTauri) {
      return
    }

    this._machineApiIp = await getMachineApiIp()
  }
}

export const machineManager = new MachineManager()
machineManager.start()
