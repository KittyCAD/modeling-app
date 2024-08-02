import { isTauri } from './isTauri'
import { components } from './machine-api'
import { listMachines } from './tauri'

export default class MachineManager {
  private _isTauri: boolean = isTauri()
  private _machines: components['schemas']['Machine'][] = []

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
      this.updateMachines()
    }, 10000)
  }

  get machines(): components['schemas']['Machine'][] {
    return this._machines
  }

  private async updateMachines(): Promise<void> {
    if (!this._isTauri) {
      return
    }

    this._machines = await listMachines()
    console.log('Machines:', this._machines)
  }
}
