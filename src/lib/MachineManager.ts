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
  #callbacks: MachineManagerCtor
  #machines = signal<MachinesListing>([])
  readonly machines = this.#machines.value
  readonly machinesSignal = this.#machines
  machineApiIp: string | null = null
  #currentMachine = signal<components['schemas']['MachineInfoResponse'] | null>(
    null
  )
  pulseTimeoutDurationMS = 1_000
  #pulseTimeout = signal<ReturnType<typeof setInterval> | undefined>(undefined)
  started = computed(() => this.#pulseTimeout.value !== undefined)

  constructor(callbacks = noOpConstructorProps) {
    this.#callbacks = callbacks
  }

  /** Starts an interval to refresh the network machine listings */
  async start() {
    this.update()
      .then(() => {
        this.#pulseTimeout.value = setInterval(
          () => void this.update(),
          this.pulseTimeoutDurationMS
        )
      })
      .catch(reportRejection)
  }

  stop() {
    clearInterval(this.#pulseTimeout.value)
  }

  private async update() {
    this.machineApiIp = await this.#callbacks.getMachineApiIp()
    if (this.machineApiIp !== null) {
      this.#machines.value = await this.#callbacks.listMachines(
        this.machineApiIp
      )
    }
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
