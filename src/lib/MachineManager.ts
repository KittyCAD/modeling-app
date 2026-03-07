import { computed, signal } from '@preact/signals-core'
import type { components } from '@src/lib/machine-api'
import { reportRejection } from '@src/lib/trap'

export type MachinesListing = Array<
  components['schemas']['MachineInfoResponse']
>

export interface IMachineManager {
  machines: MachinesListing
  machineApiIp: string | null
  currentMachine: components['schemas']['MachineInfoResponse'] | null
  noMachinesReason: () => string | undefined
}

interface MachineManagerCtor {
  getMachineApiIp: () => Promise<string | null>
  listMachines: (machineApiIp: string) => Promise<MachinesListing>
}

const noOpConstructorProps: MachineManagerCtor = {
  getMachineApiIp: async () => null,
  listMachines: async () => [],
}

/**
 * A manager class for machines discovered on the local network
 * which can have models sent to them.
 */
export class MachineManager implements IMachineManager {
  private callbacks: MachineManagerCtor
  #machines = signal<MachinesListing>([])
  get machines() {
    return this.#machines.value
  }
  readonly machinesSignal = this.#machines
  machineApiIp: string | null = null
  #isRunning = signal(false)
  #currentMachine = signal<components['schemas']['MachineInfoResponse'] | null>(
    null
  )
  pulseTimeoutDurationMS = 1_000
  #pulseTimeout = signal<ReturnType<typeof setTimeout> | undefined>(undefined)
  started = computed(() => this.#isRunning.value)

  constructor(callbacks = noOpConstructorProps) {
    this.callbacks = callbacks
  }

  updateLoop = () => {
    if (!this.started.value) {
      return
    }

    clearTimeout(this.#pulseTimeout.value)
    this.update()
      .then(() => {
        if (!this.started.value) {
          return
        }
        this.#pulseTimeout.value = setTimeout(
          this.updateLoop,
          this.pulseTimeoutDurationMS
        )
      })
      .catch(reportRejection)
  }

  /** Starts an interval to refresh the network machine listings */
  async start() {
    if (this.started.value) {
      return
    }
    this.#isRunning.value = true
    return this.update()
      .then(() => {
        if (!this.started.value) {
          return
        }

        this.updateLoop()
      })
      .catch(reportRejection)
  }

  stop() {
    this.#isRunning.value = false
    clearTimeout(this.#pulseTimeout.value)
    this.#pulseTimeout.value = undefined
    this.machineApiIp = null
    this.#machines.value = []
    this.#currentMachine.value = null
  }

  private async update() {
    this.machineApiIp = await this.callbacks.getMachineApiIp()
    if (this.machineApiIp !== null) {
      this.#machines.value = await this.callbacks.listMachines(
        this.machineApiIp
      )
      return
    }

    this.#machines.value = []
    this.#currentMachine.value = null
  }

  noMachinesReason(): string | undefined {
    if (this.machines.length > 0) {
      return undefined
    }

    if (this.machineApiIp === null) {
      return 'Machine API server was not discovered'
    }

    return 'Machine API server was discovered, but no machines are available'
  }

  get currentMachine() {
    return this.#currentMachine.value
  }
  get currentMachineSignal() {
    return this.#currentMachine
  }
  set currentMachine(newMachine:
    | components['schemas']['MachineInfoResponse']
    | null) {
    this.#currentMachine.value = newMachine
  }
}
