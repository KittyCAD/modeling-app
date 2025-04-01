import { Combobox } from '@headlessui/react'
import Fuse from 'fuse.js'
import { Command } from 'lib/commandTypes'
import { sortCommands } from 'lib/commandUtils'
import { getActorNextEvents } from 'lib/utils'
import { commandBarActor } from 'machines/commandBarMachine'
import { useEffect, useState } from 'react'

import { CustomIcon } from './CustomIcon'

function CommandComboBox({
  options,
  placeholder,
}: {
  options: Command[]
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [filteredOptions, setFilteredOptions] = useState<typeof options>()

  const defaultOption =
    options.find((o) => 'isCurrent' in o && o.isCurrent) || null
  // sort disabled commands to the bottom
  const sortedOptions = options
    .map((command) => ({
      command,
      disabled: optionIsDisabled(command),
    }))
    .sort(sortCommands)
    .map(({ command }) => command)

  const fuse = new Fuse(sortedOptions, {
    keys: ['displayName', 'name', 'description'],
    threshold: 0.3,
    ignoreLocation: true,
  })

  useEffect(() => {
    const results = fuse.search(query).map((result) => result.item)
    setFilteredOptions(query.length > 0 ? results : sortedOptions)
  }, [query])

  function handleSelection(command: Command) {
    commandBarActor.send({ type: 'Select command', data: { command } })
  }

  return (
    <Combobox defaultValue={defaultOption} onChange={handleSelection}>
      <div className="flex items-center gap-2 px-4 pb-2 border-solid border-0 border-b border-b-chalkboard-20 dark:border-b-chalkboard-80">
        <CustomIcon
          name="search"
          className="w-5 h-5 bg-primary/10 dark:bg-primary text-primary dark:text-inherit"
        />
        <Combobox.Input
          data-testid="cmd-bar-search"
          onChange={(event) => setQuery(event.target.value)}
          className="w-full bg-transparent focus:outline-none selection:bg-primary/20 dark:selection:bg-primary/40 dark:focus:outline-none"
          onKeyDown={(event) => {
            if (
              (event.metaKey && event.key === 'k') ||
              event.key === 'Escape'
            ) {
              event.preventDefault()
              commandBarActor.send({ type: 'Close' })
            }
          }}
          placeholder={
            (defaultOption && defaultOption.name) ||
            placeholder ||
            'Search commands'
          }
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          autoFocus
        />
      </div>
      {filteredOptions?.length ? (
        <Combobox.Options
          static
          className="overflow-y-auto max-h-96 cursor-pointer"
        >
          {filteredOptions?.map((option) => (
            <Combobox.Option
              key={option.groupId + option.name + (option.displayName || '')}
              value={option}
              className="flex items-center gap-4 px-4 py-1.5 first:mt-2 last:mb-2 ui-active:bg-primary/10 dark:ui-active:bg-chalkboard-90 ui-disabled:!text-chalkboard-50"
              disabled={optionIsDisabled(option)}
              data-testid={`cmd-bar-option`}
            >
              {'icon' in option && option.icon && (
                <CustomIcon name={option.icon} className="w-5 h-5" />
              )}
              <div className="flex-grow flex flex-col">
                <p className="my-0 leading-tight">
                  {option.displayName || option.name}{' '}
                </p>
                {option.description && (
                  <p className="my-0 text-xs text-chalkboard-60 dark:text-chalkboard-50">
                    {option.description}
                  </p>
                )}
              </div>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      ) : (
        <p className="px-4 pt-2 text-chalkboard-60 dark:text-chalkboard-50">
          No results found
        </p>
      )}
    </Combobox>
  )
}

export default CommandComboBox

function optionIsDisabled(option: Command): boolean {
  return (
    'machineActor' in option &&
    option.machineActor !== undefined &&
    !getActorNextEvents(option.machineActor.getSnapshot()).includes(option.name)
  )
}
