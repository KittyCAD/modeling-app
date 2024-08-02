import { isTauri } from './isTauri'
import { components } from './machine-api'
import { getMachineApiIp, listMachines } from './tauri'

export default class MachineManager {
  private _isTauri: boolean = isTauri()
  private _machines: {
    [key: string]: components['schemas']['Machine']
  } = {}
  private _machineApiIp: string | null = null

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
