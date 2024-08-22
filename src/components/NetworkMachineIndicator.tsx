import { Popover } from '@headlessui/react'
import Tooltip from './Tooltip'
import { machineManager } from 'lib/machineManager'
import { isDesktop } from 'lib/isDesktop'
import { CustomIcon } from './CustomIcon'

export const NetworkMachineIndicator = ({
  className,
}: {
  className?: string
}) => {
  const machineCount = machineManager.machineCount()
  const reason = machineManager.noMachinesReason()

  return isDesktop() ? (
    <Popover className="relative">
      <Popover.Button
        className={
          'flex items-center p-0 border-none bg-transparent dark:bg-transparent relative ' +
          (className || '')
        }
        data-testid="network-machine-toggle"
      >
        <CustomIcon name="printer3d" className="w-5 h-5" />
        {machineCount > 0 && (
          <p aria-hidden className="flex items-center justify-center text-xs">
            {machineCount}
          </p>
        )}
        <Tooltip position="top-right" wrapperClassName="ui-open:hidden">
          Network machines ({machineCount}) {reason && `: ${reason}`}
        </Tooltip>
      </Popover.Button>
      <Popover.Panel
        className="absolute right-0 left-auto bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm"
        data-testid="network-popover"
      >
        <div className="flex items-center justify-between p-2 rounded-t-sm bg-chalkboard-20 dark:bg-chalkboard-80">
          <h2 className="text-sm font-sans font-normal">Network machines</h2>
          <p
            data-testid="network"
            className="font-bold text-xs uppercase px-2 py-1 rounded-sm"
          >
            {machineCount}
          </p>
        </div>
        {machineCount > 0 && (
          <ul className="divide-y divide-chalkboard-20 dark:divide-chalkboard-80">
            {Object.entries(machineManager.machines).map(
              ([hostname, machine]) => (
                <li key={hostname} className={'px-2 py-4 gap-1 last:mb-0 '}>
                  <p className="">{machine.model || machine.manufacturer}</p>
                  <p className="text-chalkboard-60 dark:text-chalkboard-50 text-xs">
                    Hostname {hostname}
                  </p>
                </li>
              )
            )}
          </ul>
        )}
      </Popover.Panel>
    </Popover>
  ) : null
}
