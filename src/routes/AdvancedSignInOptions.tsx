import { Combobox, Popover, RadioGroup, Transition } from '@headlessui/react'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { isDesktop } from '@src/lib/isDesktop'
import { Fragment, useState } from 'react'

interface Domain {
  name: string
}

function SupportedDomainsRadioGroup({
  selected,
  setSelected,
  domains,
}: {
  selected: string
  setSelected: (environment: string) => void
  domains: Domain[]
}) {
  return (
    <div className="w-full py-4">
      <div className="mx-auto w-full max-w-md">
        <RadioGroup value={selected} onChange={setSelected}>
          <div className="space-y-2">
            {domains.map((domain) => (
              <RadioGroup.Option
                key={domain.name}
                value={domain.name}
                className={({ checked }) =>
                  `${checked ? 'bg-primary' : 'text-chalkboard-70'}
                    relative flex cursor-pointer rounded py-1 focus:outline-none`
                }
              >
                {({ checked }) => (
                  <>
                    <div className="flex w-full items-center justify-between">
                      <div className="flex items-center">
                        <div className="text-sm">
                          <RadioGroup.Label
                            as="p"
                            className={`text-xs px-1 ${
                              checked
                                ? 'text-chalkboard-30'
                                : 'text-chalkboard-70 dark:text-chalkboard-30'
                            }`}
                          >
                            {domain.name}
                          </RadioGroup.Label>
                        </div>
                      </div>
                      {checked && (
                        <div className="shrink-0 text-white">
                          <CustomIcon
                            name="checkmark"
                            className="w-4 h-4 text-chalkboard-10 dark:text-chalkboard-40"
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </RadioGroup.Option>
            ))}
          </div>
        </RadioGroup>
      </div>
    </div>
  )
}

export const AdvancedSignInOptions = ({
  selectedEnvironment,
  setSelectedEnvironment,
}: {
  selectedEnvironment: string
  setSelectedEnvironment: (environment: string) => void
}) => {
  const domains: Domain[] = [
    {
      name: 'zoo.dev',
    },
    {
      name: 'zoogov.dev',
    },
    {
      name: 'dev.zoo.dev',
    },
  ]
  const [showCustomInput, setShowCustomInput] = useState(false)

  return isDesktop() ? (
    <div className="flex flex-row items-center">
      <span className="text-xs text-chalkboard-70 dark:text-chalkboard-30 w-64 h-8">
        Signing into <span className="font-bold">{selectedEnvironment}</span>{' '}
        environment
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
            className={`z-10 flex flex-col absolute top-full left-0 mt-1 p-2 w-52 bg-chalkboard-10 dark:bg-chalkboard-90
          border border-solid border-chalkboard-20 dark:border-chalkboard-90 rounded
          shadow-lg`}
          >
            {() => (
              <>
                <span className="text-xs text-chalkboard-70 dark:text-chalkboard-30">
                  Supported Domains
                </span>
                <SupportedDomainsRadioGroup
                  selected={selectedEnvironment}
                  setSelected={setSelectedEnvironment}
                  domains={domains}
                />
                <ActionButton
                  Element="button"
                  className={
                    'text-xs text-chalkboard-70 dark:text-chalkboard-30 border-none pl-0  pb-2'
                  }
                  onClick={() => setShowCustomInput((show) => !show)}
                >
                  Advanced options
                  <CustomIcon
                    name="caretDown"
                    className={`w-4 h-4 ${!showCustomInput ? '' : 'ui-open:rotate-180'} `}
                  />
                </ActionButton>
                {showCustomInput && (
                  <div className="flex flex-col items-start py-0.5">
                    <span className="text-xs text-chalkboard-70 dark:text-chalkboard-30">
                      Domain
                    </span>
                  </div>
                )}

                <Combobox
                  value={selectedEnvironment}
                  onChange={setSelectedEnvironment}
                >
                  {showCustomInput && (
                    <Combobox.Input
                      className="gap-1 rounded h-6 border px-2 flex items-center dark:hover:bg-chalkboard-80 text-xs text-chalkboard-70 dark:text-chalkboard-30 dark:bg-chalkboard-90"
                      placeholder="auto"
                      onChange={(event) =>
                        setSelectedEnvironment(event.target.value)
                      }
                    />
                  )}
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
