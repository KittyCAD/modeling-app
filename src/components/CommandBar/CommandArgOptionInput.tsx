import { Combobox } from '@headlessui/react'
import { useSelector } from '@xstate/react'
import Fuse from 'fuse.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnyStateMachine, StateFrom } from 'xstate'

import { useApp } from '@src/lib/boot'
import type {
  CommandArgument,
  CommandArgumentOption,
} from '@src/lib/commandTypes'

const contextSelector = (snapshot: StateFrom<AnyStateMachine> | undefined) =>
  snapshot?.context

function OptionLabel({ option }: { option: CommandArgumentOption<unknown> }) {
  if (!option.label) {
    return <>{option.name}</>
  }

  if (typeof option.label === 'function') {
    const Label = option.label
    return <Label option={option} />
  }

  return <>{option.label}</>
}

function optionValueKey(value: unknown) {
  if (value === null || value === undefined) {
    return String(value)
  }
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return String(value)
  }
  if (
    typeof value === 'object' &&
    'start' in value &&
    'end' in value &&
    'valueText' in value
  ) {
    const rangedValue = value as {
      start: unknown
      end: unknown
      valueText: unknown
    }
    return `${rangedValue.start}:${rangedValue.end}:${rangedValue.valueText}`
  }
  if (
    typeof value === 'object' &&
    'name' in value &&
    typeof value.name === 'string'
  ) {
    return value.name
  }
  return ''
}

function optionKey(option: CommandArgumentOption<unknown> | null) {
  if (!option) {
    return ''
  }
  return `${option.name}:${optionValueKey(option.value)}`
}

function CommandArgOptionInput({
  arg,
  argName,
  stepBack,
  onSubmit,
  placeholder,
}: {
  arg: CommandArgument<unknown> & { inputType: 'options' }
  argName: string
  stepBack: () => void
  onSubmit: (data: unknown) => void
  placeholder?: string
}) {
  const actorContext = useSelector(arg.machineActor, contextSelector)
  const { commands } = useApp()
  const commandBarState = commands.useState()
  const resolvedOptions = useMemo(
    () =>
      typeof arg.options === 'function'
        ? arg.options(commandBarState.context, actorContext)
        : arg.options,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [argName, arg, commandBarState.context, actorContext]
  )
  // The initial current option is either an already-input value or the configured default
  const currentOption = useMemo(
    () =>
      resolvedOptions.find(
        (o) => o.value === commandBarState.context.argumentsToSubmit[argName]
      ) || resolvedOptions.find((o) => o.isCurrent),
    [commandBarState.context.argumentsToSubmit, argName, resolvedOptions]
  )
  const optionByKey = useMemo(
    () => new Map(resolvedOptions.map((option) => [optionKey(option), option])),
    [resolvedOptions]
  )
  const currentOptionKey = currentOption ? optionKey(currentOption) : ''
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const shouldSubmitOnChange = useRef(false)
  const [selectedOption, setSelectedOption] = useState<
    CommandArgumentOption<unknown> | undefined
  >(currentOption || resolvedOptions[0])
  const selectedOptionKey = selectedOption ? optionKey(selectedOption) : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  const initialQuery = useMemo(() => '', [arg.options, argName])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [argName, resolvedOptions]
  )

  // Reset the query and selected option when the argName changes
  useEffect(() => {
    setQuery(initialQuery)
    setSelectedOption(currentOption || resolvedOptions[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [argName])

  // Auto focus and select the input when the component mounts
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [inputRef])
  useEffect(() => {
    // work around to make sure the user doesn't have to press the down arrow key to focus the first option
    // instead this makes it move from the first hit
    const downArrowEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      keyCode: 40,
      which: 40,
      bubbles: true,
    })
    inputRef?.current?.dispatchEvent(downArrowEvent)
  }, [])

  // Filter the options based on the query,
  // resetting the query when the options change
  useEffect(() => {
    const results = fuse.search(query).map((result) => result.item)
    setFilteredOptions(query.length > 0 ? results : resolvedOptions)
  }, [query, resolvedOptions, fuse])

  function handleSelectOption(key: string) {
    const option = optionByKey.get(key)
    if (!option) {
      return
    }

    // We deal with the whole option object internally
    setSelectedOption(option)

    // But we only submit the value itself
    if (shouldSubmitOnChange.current) {
      shouldSubmitOnChange.current = false
      onSubmit(option.value)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedOption) {
      return
    }

    // We submit the value of the selected option, not the whole object
    onSubmit(selectedOption.value)
  }

  return (
    <form
      id="arg-form"
      onSubmit={handleSubmit}
      ref={formRef}
      onKeyDownCapture={(e) => {
        if (e.key === 'Enter') {
          shouldSubmitOnChange.current = true
        } else {
          shouldSubmitOnChange.current = false
        }
      }}
    >
      <Combobox
        value={selectedOptionKey}
        onChange={handleSelectOption}
        name="options"
      >
        <div className="flex items-center mx-4 mt-4 mb-2">
          <label
            htmlFor="option-input"
            className="capitalize px-2 py-1 rounded-l bg-chalkboard-100 dark:bg-chalkboard-80 text-chalkboard-10 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80"
            data-testid="cmd-bar-arg-name"
          >
            {argName}
          </label>
          <Combobox.Input
            id="option-input"
            data-testid="cmd-bar-arg-value"
            ref={inputRef}
            onChange={(event) =>
              !event.target.disabled && setQuery(event.target.value)
            }
            className="flex-grow px-2 py-1 border-b border-b-chalkboard-100 dark:border-b-chalkboard-80 !bg-transparent focus:outline-none"
            onKeyDown={(event) => {
              if (event.metaKey && event.key === 'k')
                commands.send({ type: 'Close' })
              if (event.key === 'Backspace' && event.metaKey) {
                stepBack()
              }

              if (event.key === 'Enter') {
                shouldSubmitOnChange.current = true
              } else {
                shouldSubmitOnChange.current = false
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
        {filteredOptions?.length ? (
          <Combobox.Options
            static
            className="overflow-y-auto max-h-96 cursor-pointer"
            onMouseDown={() => {
              shouldSubmitOnChange.current = true
            }}
          >
            {filteredOptions?.map((option, index) => (
              <Combobox.Option
                key={`${option.name}-${index}`}
                value={optionKey(option)}
                disabled={option.disabled}
                className="flex items-center gap-2 px-4 py-1 first:mt-2 last:mb-2 ui-active:bg-primary/10 dark:ui-active:bg-chalkboard-90"
              >
                <p
                  className={`flex-grow min-w-0 ${
                    (option.disabled &&
                      'text-chalkboard-70 dark:text-chalkboard-50 cursor-not-allowed') ||
                    ''
                  }`}
                >
                  <OptionLabel option={option} />
                </p>
                {optionKey(option) === currentOptionKey && (
                  <small className="text-chalkboard-70 dark:text-chalkboard-50">
                    current
                  </small>
                )}
              </Combobox.Option>
            ))}
          </Combobox.Options>
        ) : (
          <p className="px-4 pt-2 text-chalkboard-60 dark:text-chalkboard-50">
            No results found
          </p>
        )}
      </Combobox>
    </form>
  )
}

export default CommandArgOptionInput
