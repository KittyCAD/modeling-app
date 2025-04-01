import { isDesktop } from 'lib/isDesktop'
import { components } from 'lib/machine-api'
import { engineCommandManager } from 'lib/singletons'
import { reportRejection } from 'lib/trap'
import { toSync } from 'lib/utils'
import { commandBarActor } from 'machines/commandBarMachine'
import { createContext, useEffect, useState } from 'react'

export type MachinesListing = Array<
  components['schemas']['MachineInfoResponse']
>

export interface MachineManager {
  machines: MachinesListing
  machineApiIp: string | null
  currentMachine: components['schemas']['MachineInfoResponse'] | null
  noMachinesReason: () => string | undefined
  setCurrentMachine: (
    m: components['schemas']['MachineInfoResponse'] | null
  ) => void
}

export const MachineManagerContext = createContext<MachineManager>({
  machines: [],
  machineApiIp: null,
  currentMachine: null,
  setCurrentMachine: (
    _: components['schemas']['MachineInfoResponse'] | null
  ) => {},
  noMachinesReason: () => undefined,
})

export const MachineManagerProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [machines, setMachines] = useState<MachinesListing>([])
  const [machineApiIp, setMachineApiIp] = useState<string | null>(null)
  const [currentMachine, setCurrentMachine] = useState<
    components['schemas']['MachineInfoResponse'] | null
  >(null)

  // Get the reason message for why there are no machines.
  const noMachinesReason = (): string | undefined => {
    if (machines.length > 0) {
      return undefined
    }

    if (machineApiIp === null) {
      return 'Machine API server was not discovered'
    }

    return 'Machine API server was discovered, but no machines are available'
  }

  useEffect(() => {
    if (!isDesktop()) return

    const update = async () => {
      const _machineApiIp = await window.electron.getMachineApiIp()
      if (_machineApiIp === null) return

      setMachineApiIp(_machineApiIp)

      const _machines = await window.electron.listMachines(_machineApiIp)
      setMachines(_machines)
    }

    // Start a background job to update the machines every ten seconds.
    // If MDNS is already watching, this timeout will wait until it's done to trigger the
    // finding again.
    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined
    const timeoutLoop = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(
        toSync(async () => {
          await update()
          timeoutLoop()
        }, reportRejection),
        1000
      )
    }
    timeoutLoop()
    update().catch(reportRejection)
  }, [])

  // Update engineCommandManager's copy of this data.
  useEffect(() => {
    const machineManagerNext = {
      machines,
      machineApiIp,
      currentMachine,
      noMachinesReason,
      setCurrentMachine,
    }

    engineCommandManager.machineManager = machineManagerNext

    commandBarActor.send({
      type: 'Set machine manager',
      data: machineManagerNext,
    })
  }, [machines, machineApiIp, currentMachine])

  return (
    <MachineManagerContext.Provider
      value={{
        machines,
        machineApiIp,
        currentMachine,
        setCurrentMachine,
        noMachinesReason,
      }}
    >
      {' '}
      {children}{' '}
    </MachineManagerContext.Provider>
  )
}
