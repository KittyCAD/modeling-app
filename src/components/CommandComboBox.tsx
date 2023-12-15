import { Combobox } from '@headlessui/react'
import Fuse from 'fuse.js'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { Command } from 'lib/commandTypes'
import { useEffect, useState } from 'react'
import { CustomIcon } from './CustomIcon'

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

  const fuse = new Fuse(options, {
    keys: ['name', 'description'],
    threshold: 0.3,
  })

  useEffect(() => {
    const results = fuse.search(query).map((result) => result.item)
    setFilteredOptions(query.length > 0 ? results : options)
  }, [query])

  function handleSelection(command: Command) {
    commandBarSend({ type: 'Select command', data: { command } })
  }

  return (
    <Combobox defaultValue={defaultOption} onChange={handleSelection}>
      <div className="flex items-center gap-2 px-4 pb-2 border-solid border-0 border-b border-b-chalkboard-20 dark:border-b-chalkboard-80">
        <CustomIcon
          name="search"
          className="w-5 h-5 bg-energy-10/50 dark:bg-chalkboard-90 dark:text-energy-10"
        />
        <Combobox.Input
          onChange={(event) => setQuery(event.target.value)}
          className="w-full bg-transparent focus:outline-none selection:bg-energy-10/50 dark:selection:bg-energy-10/20 dark:focus:outline-none"
          onKeyDown={(event) => {
            if (
              (event.metaKey && event.key === 'k') ||
              (event.key === 'Backspace' && !event.currentTarget.value)
            ) {
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
            key={option.name}
            value={option}
            className="flex items-center gap-2 px-4 py-1 first:mt-2 last:mb-2 ui-active:bg-energy-10/50 dark:ui-active:bg-chalkboard-90"
          >
            {'icon' in option && option.icon && (
              <CustomIcon
                name={option.icon}
                className="w-5 h-5 dark:text-energy-10"
              />
            )}
            <p className="flex-grow">{option.name} </p>
          </Combobox.Option>
        ))}
      </Combobox.Options>
    </Combobox>
  )
}

export default CommandComboBox
