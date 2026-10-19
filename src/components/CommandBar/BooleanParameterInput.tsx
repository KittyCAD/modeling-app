import { Combobox } from '@headlessui/react'
import { useState } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import type { BooleanInputValue } from '@src/lib/booleanInput'
import type { CommandArgumentOption } from '@src/lib/commandTypes'
import { noAutofillInputProps } from '@src/lib/autofill'

type Option = CommandArgumentOption<BooleanInputValue>

export function BooleanParameterInput({
  id,
  value,
  options,
  autoFocus,
  onChange,
}: {
  id: string
  value: unknown
  options: Option[]
  autoFocus?: boolean
  onChange: (value: BooleanInputValue) => void
}) {
  const [query, setQuery] = useState('')
  const choices = options.filter((option) =>
    option.name.toLowerCase().includes(query.toLowerCase())
  )
  return (
    <Combobox
      by="name"
      value={options.find((option) => option.value === value)}
      onChange={(option: Option) => {
        setQuery('')
        onChange(option.value)
      }}
    >
      <div className="flex items-center rounded-sm border border-chalkboard-30 dark:border-chalkboard-70">
        <Combobox.Input
          {...noAutofillInputProps}
          id={id}
          autoFocus={autoFocus}
          className="min-w-0 flex-1 border-0 bg-transparent px-2 py-1 text-xs"
          displayValue={(option: Option | undefined) => option?.name ?? ''}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Combobox.Button
          aria-label="Choose boolean value"
          className="m-0 border-0 bg-transparent p-1"
        >
          <CustomIcon name="caretDown" className="h-4 w-4" />
        </Combobox.Button>
      </div>
      <Combobox.Options className="max-h-40 overflow-y-auto rounded-sm border border-chalkboard-30 dark:border-chalkboard-70">
        {choices.map((option) => (
          <Combobox.Option
            key={option.name}
            value={option}
            className="cursor-pointer px-2 py-1 ui-active:bg-primary/10"
          >
            {option.name}
          </Combobox.Option>
        ))}
        {choices.length === 0 && (
          <li className="px-2 py-1">No matching values</li>
        )}
      </Combobox.Options>
    </Combobox>
  )
}
