import { Popover } from '@headlessui/react'
import { useContext } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import { MachineManagerContext } from '@src/components/MachineManagerProvider'
import Tooltip from '@src/components/Tooltip'
import { isDesktop } from '@src/lib/isDesktop'
import type { components } from '@src/lib/machine-api'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'

export const NetworkMachineIndicator = ({
  className,
}: {
  className?: string
}) => {
  const {
    noMachinesReason,
    machines,
    machines: { length: machineCount },
  } = useContext(MachineManagerContext)
  const reason = noMachinesReason()

  return isDesktop() ? (
    <Popover className="relative">
      <Popover.Button
        className={`flex items-center p-0 border-none bg-transparent dark:bg-transparent relative ${className || ''}`}
        data-testid="network-machine-toggle"
      >
        <NetworkMachinesIcon machineCount={machineCount} />
        <Tooltip position="top-right" wrapperClassName="ui-open:hidden">
          Network machines ({machineCount}) {reason && `: ${reason}`}
        </Tooltip>
      </Popover.Button>
      <Popover.Panel
        className="absolute right-0 left-auto bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm"
        data-testid="network-popover"
      >
        <NetworkMachinesPopoverContent machines={machines} />
      </Popover.Panel>
    </Popover>
  ) : null
}

export const useNetworkMachineStatus = (): StatusBarItemType => {
  return {
    id: 'network-machines',
    component: NetworkMachineIndicator,
  }
}

function NetworkMachinesIcon({ machineCount }: { machineCount: number }) {
  return (
    <>
      <CustomIcon name="printer3d" className="w-5 h-5" />
      {machineCount > 0 && (
        <p aria-hidden className="flex items-center justify-center text-xs">
          {machineCount}
        </p>
      )}
    </>
  )
}

function NetworkMachinesPopoverContent({
  machines,
}: { machines: components['schemas']['MachineInfoResponse'][] }) {
  return (
    <div
      className="absolute left-2 bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm"
      data-testid="network-popover"
    >
      <div className="flex items-center justify-between p-2 rounded-t-sm bg-chalkboard-20 dark:bg-chalkboard-80">
        <h2 className="text-sm font-sans font-normal">Network machines</h2>
        <p
          data-testid="network"
          className="font-bold text-xs uppercase px-2 py-1 rounded-sm"
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
