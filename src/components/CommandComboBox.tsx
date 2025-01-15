import { Combobox } from '@headlessui/react'
import Fuse from 'fuse.js'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { Command } from 'lib/commandTypes'
import { useEffect, useState } from 'react'
import { CustomIcon } from './CustomIcon'
import { getActorNextEvents } from 'lib/utils'

function CommandComboBox({
  options,
  placeholder,
}: {
  options: Command[]
  placeholder?: string
}) {
  const { commandBarSend } = useCommandsContext()
  const [query, setQuery] = useState('')
  const [filteredOptions, setFilteredOptions] = useState<typeof options>()

  const defaultOption =
    options.find((o) => 'isCurrent' in o && o.isCurrent) || null
  // sort disabled commands to the bottom
  const sortedOptions = options
    .map((option) => ({
      option,
      disabled: optionIsDisabled(option),
    }))
    .sort((a, b) => {
      // Disabled commands should be at the bottom
      if (a.disabled && !b.disabled) {
        return 1
      }
      if (b.disabled && !a.disabled) {
        return -1
      }
      // Settings commands should be next-to-last
      if (a.option.groupId === 'settings' && b.option.groupId !== 'settings') {
        return 1
      }
      if (b.option.groupId === 'settings' && a.option.groupId !== 'settings') {
        return -1
      }
      // Modeling commands should be first
      if (a.option.groupId === 'modeling' && b.option.groupId !== 'modeling') {
        return -1
      }
      if (b.option.groupId === 'modeling' && a.option.groupId !== 'modeling') {
        return 1
      }
      // Sort alphabetically
      return (a.option.displayName || a.option.name).localeCompare(
        b.option.displayName || b.option.name
      )
    })
    .map(({ option }) => option)

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
    commandBarSend({ type: 'Select command', data: { command } })
  }

  return (
    <Combobox defaultValue={defaultOption} onChange={handleSelection}>
      <div className="flex items-center gap-2 px-4 pb-2 border-solid border-0 border-b border-b-chalkboard-20 dark:border-b-chalkboard-80">
        <CustomIcon
          name="search"
          className="w-5 h-5 bg-primary/10 dark:bg-primary text-primary dark:text-inherit"
        />
        <Combobox.Input
          onChange={(event) => setQuery(event.target.value)}
          className="w-full bg-transparent focus:outline-none selection:bg-primary/20 dark:selection:bg-primary/40 dark:focus:outline-none"
          onKeyDown={(event) => {
            if (
              (event.metaKey && event.key === 'k') ||
              (event.key === 'Backspace' && !event.currentTarget.value)
            ) {
              event.preventDefault()
              commandBarSend({ type: 'Close' })
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
