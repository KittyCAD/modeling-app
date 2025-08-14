import { useContext } from 'react'
import { MachineManagerContext } from '@src/components/MachineManagerProvider'
import type { components } from '@src/lib/machine-api'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'

export const useNetworkMachineStatus = (): StatusBarItemType => {
  const {
    noMachinesReason,
    machines,
    machines: { length: machineCount },
  } = useContext(MachineManagerContext)
  const reason = noMachinesReason()
  return {
    id: 'network-machines',
    'data-testid': `network-machine-toggle`,
    label: `${machineCount}`,
    hideLabel: machineCount === 0,
    toolTip: {
      children: `Network machines (${machineCount}) ${reason ? `: ${reason}` : ''}`,
    },
    element: 'popover',
    icon: 'printer3d',
    popoverContent: <NetworkMachinesPopoverContent machines={machines} />,
  }
}

function NetworkMachinesPopoverContent({
  machines,
}: { machines: components['schemas']['MachineInfoResponse'][] }) {
  return (
    <div
      className="absolute left-2 bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded-sm shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm"
      data-testid="network-popover"
    >
      <div className="flex items-center justify-between p-2 rounded-t-sm bg-chalkboard-20 dark:bg-chalkboard-80">
        <h2 className="text-sm font-sans font-normal">Network machines</h2>
        <p
          data-testid="network"
          className="font-bold text-xs uppercase px-2 py-1 rounded-xs"
        >
          {machines.length}
        </p>
      </div>
      {machines.length > 0 && (
        <ul className="divide-y divide-chalkboard-20 dark:divide-chalkboard-80">
          {machines.map(
            (machine: components['schemas']['MachineInfoResponse']) => {
              return (
                <li key={machine.id} className={'px-2 py-4 gap-1 last:mb-0 '}>
                  <p className="">{machine.id.toUpperCase()}</p>
                  <p className="text-chalkboard-60 dark:text-chalkboard-50 text-xs">
                    {machine.make_model.model}
                  </p>
                  {machine.extra &&
                    machine.extra.type === 'bambu' &&
                    machine.extra.nozzle_diameter && (
                      <p className="text-chalkboard-60 dark:text-chalkboard-50 text-xs">
                        Nozzle Diameter: {machine.extra.nozzle_diameter}
                      </p>
                    )}
                  <p className="text-chalkboard-60 dark:text-chalkboard-50 text-xs">
                    {`Status: ${machine.state.state
                      .charAt(0)
                      .toUpperCase()}${machine.state.state.slice(1)}`}
                    {machine.state.state === 'failed' && machine.state.message
                      ? ` (${machine.state.message})`
                      : ''}
                    {machine.state.state === 'running' && machine.progress
                      ? ` (${Math.round(machine.progress)}%)`
                      : ''}
                  </p>
                </li>
              )
            }
          )}
        </ul>
      )}
    </div>
  )
}
