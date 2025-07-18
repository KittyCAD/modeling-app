import { Popover, Transition, Combobox } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { Fragment } from 'react'
import { isDesktop } from '@src/lib/isDesktop'

export const AdvancedSignInOptions = ({
  pool,
  setPool,
  selectedEnvironment,
  setSelectedEnvironment,
}: {
  pool: string
  setPool: React.Dispatch<React.SetStateAction<string>>
  selectedEnvironment: string
  setSelectedEnvironment: (environment: string) => void
}) => {
  return isDesktop() ? (
    <div className="flex flex-row items-center">
      <span className="text-xs text-chalkboard-70 dark:text-chalkboard-30 w-64 h-8">
        Signing into <span className="font-bold">{selectedEnvironment}</span>{' '}
        environment
        {pool !== '' && (
          <span>
            , to the <span className="font-bold">{pool}</span> pool
          </span>
        )}
      </span>
      <Popover className="relative ml-8">
        <Popover.Button
          className="gap-1 rounded h-9 mr-auto max-h-min min-w-max border py-1 px-2 flex items-center dark:hover:bg-chalkboard-90"
          data-testid="project-sidebar-toggle"
        >
          <div className="flex flex-col items-start py-0.5">
            <span
              className="hidden text-xs whitespace-nowrap lg:block"
              data-testid="app-header-file-name"
            >
              Choose environment
            </span>
          </div>
          <CustomIcon
            name="caretDown"
            className="w-4 h-4 text-chalkboard-70 dark:text-chalkboard-40 ui-open:rotate-180"
          />
        </Popover.Button>

        <Transition
          enter="duration-100 ease-out"
          enterFrom="opacity-0 -translate-y-2"
          enterTo="opacity-100 translate-y-0"
          as={Fragment}
        >
          <Popover.Panel
            className={`z-10 absolute top-full left-0 mt-1 p-2 w-52 bg-chalkboard-10 dark:bg-chalkboard-90
          border border-solid border-chalkboard-20 dark:border-chalkboard-90 rounded
          shadow-lg`}
          >
            {({ close }) => (
              <>
                <div className="flex flex-col items-start py-0.5">
                  <span className="text-xs text-chalkboard-70 dark:text-chalkboard-30">
                    Domain
                  </span>
                </div>
                <Combobox
                  value={selectedEnvironment}
                  onChange={setSelectedEnvironment}
                >
                  <Combobox.Input
                    className="
                               gap-1 rounded h-9 mr-auto max-h-min min-w-max border py-1 flex items-center dark:hover:bg-chalkboard-90 text-xs text-chalkboard-70 dark:text-chalkboard-30"
                    placeholder="auto"
                    onChange={(event) =>
                      setSelectedEnvironment(event.target.value)
                    }
                  />
                </Combobox>
                <div className="flex flex-col items-start py-0.5">
                  <span className="text-xs text-chalkboard-70 dark:text-chalkboard-30">
                    Connection pool
                  </span>
                </div>
                <Combobox value={pool} onChange={setPool}>
                  <Combobox.Input
                    className="
            gap-1 rounded h-9 mr-auto max-h-min min-w-max border py-1 flex items-center dark:hover:bg-chalkboard-90 text-xs text-chalkboard-70 dark:text-chalkboard-30"
                    placeholder="auto"
                    onChange={(event) => setPool(event.target.value)}
                  />
                </Combobox>
              </>
            )}
          </Popover.Panel>
        </Transition>
      </Popover>
    </div>
  ) : (
    <></>
  )
}
