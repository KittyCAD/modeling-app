import { Combobox } from '@headlessui/react'
import Fuse from 'fuse.js'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { CommandArgumentOption } from 'lib/commandTypes'
import { useEffect, useRef, useState } from 'react'

function CommandArgOptionInput({
  options,
  argName,
  stepBack,
  onSubmit,
  placeholder,
}: {
  options: CommandArgumentOption<unknown>[]
  argName: string
  stepBack: () => void
  onSubmit: (data: unknown) => void
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [argValue, setArgValue] = useState<(typeof options)[number]['value']>(
    options.find((o) => 'isCurrent' in o && o.isCurrent)?.value ||
      options[0].value
  )
  const { commandBarSend } = useCommandsContext()
  const [query, setQuery] = useState('')
  const [filteredOptions, setFilteredOptions] = useState<typeof options>()

  const fuse = new Fuse(options, {
    keys: ['name', 'description'],
    threshold: 0.3,
  })

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [inputRef])

  useEffect(() => {
    const results = fuse.search(query).map((result) => result.item)
    setFilteredOptions(query.length > 0 ? results : options)
  }, [query])

  function handleSelectOption(option: CommandArgumentOption<unknown>) {
    setArgValue(option)
    onSubmit(option.value)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSubmit(argValue)
  }

  return (
    <form id="arg-form" onSubmit={handleSubmit} ref={formRef}>
      <Combobox value={argValue} onChange={handleSelectOption} name="options">
        <div className="flex items-center mx-4 mt-4 mb-2">
          <label
            htmlFor="option-input"
            className="capitalize px-2 py-1 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80"
          >
            {argName}
          </label>
          <Combobox.Input
            id="option-input"
            ref={inputRef}
            onChange={(event) => setQuery(event.target.value)}
            className="flex-grow px-2 py-1 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 !bg-transparent focus:outline-none"
            onKeyDown={(event) => {
              if (event.metaKey && event.key === 'k')
                commandBarSend({ type: 'Close' })
              if (event.key === 'Backspace' && !event.currentTarget.value) {
                stepBack()
              }
            }}
            placeholder={
              (argValue as CommandArgumentOption<unknown>)?.name ||
              placeholder ||
              'Select an option for ' + argName
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
              <p className="flex-grow">{option.name} </p>
              {'isCurrent' in option && option.isCurrent && (
                <small className="text-chalkboard-70 dark:text-chalkboard-50">
                  current
                </small>
              )}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox>
    </form>
  )
}

export default CommandArgOptionInput
