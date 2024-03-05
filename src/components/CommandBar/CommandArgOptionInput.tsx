import { Combobox } from '@headlessui/react'
import Fuse from 'fuse.js'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { CommandArgument, CommandArgumentOption } from 'lib/commandTypes'
import { useEffect, useMemo, useRef, useState } from 'react'

function CommandArgOptionInput({
  options,
  argName,
  stepBack,
  onSubmit,
  placeholder,
}: {
  options: (CommandArgument<unknown> & { inputType: 'options' })['options']
  argName: string
  stepBack: () => void
  onSubmit: (data: unknown) => void
  placeholder?: string
}) {
  const { commandBarSend, commandBarState } = useCommandsContext()
  const resolvedOptions = useMemo(
    () =>
      typeof options === 'function'
        ? options(commandBarState.context)
        : options,
    [argName, options, commandBarState.context]
  )
  // The initial current option is either an already-input value or the configured default
  const currentOption = useMemo(
    () =>
      resolvedOptions.find(
        (o) => o.value === commandBarState.context.argumentsToSubmit[argName]
      ) || resolvedOptions.find((o) => o.isCurrent),
    [commandBarState.context.argumentsToSubmit, argName, resolvedOptions]
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [selectedOption, setSelectedOption] = useState<
    CommandArgumentOption<unknown>
  >(currentOption || resolvedOptions[0])
  const initialQuery = useMemo(() => '', [options, argName])
  const [query, setQuery] = useState(initialQuery)
  const [filteredOptions, setFilteredOptions] =
    useState<typeof resolvedOptions>()

  // Create a new Fuse instance when the options change
  const fuse = useMemo(
    () =>
      new Fuse(resolvedOptions, {
        keys: ['name', 'description'],
        threshold: 0.3,
      }),
    [argName, resolvedOptions]
  )

  // Reset the query and selected option when the argName changes
  useEffect(() => {
    setQuery(initialQuery)
    setSelectedOption(currentOption || resolvedOptions[0])
  }, [argName])

  // Auto focus and select the input when the component mounts
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [inputRef])

  // Filter the options based on the query,
  // resetting the query when the options change
  useEffect(() => {
    const results = fuse.search(query).map((result) => result.item)
    setFilteredOptions(query.length > 0 ? results : resolvedOptions)
  }, [query, resolvedOptions, fuse])

  function handleSelectOption(option: CommandArgumentOption<unknown>) {
    // We deal with the whole option object internally
    setSelectedOption(option)

    // But we only submit the value
    onSubmit(option.value)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    // We submit the value of the selected option, not the whole object
    onSubmit(selectedOption.value)
  }

  return (
    <form id="arg-form" onSubmit={handleSubmit} ref={formRef}>
      <Combobox
        value={selectedOption}
        onChange={handleSelectOption}
        name="options"
      >
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
            value={query}
            placeholder={
              currentOption?.name ||
              placeholder ||
              argName ||
              'Select an option'
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
              {option.value === currentOption?.value && (
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
