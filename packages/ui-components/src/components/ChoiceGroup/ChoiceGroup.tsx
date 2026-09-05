import type { ReactNode } from 'react'

export type ChoiceGroupOption<Value = unknown> = {
  name: ReactNode
  value: Value
  disabled?: boolean
  title?: string
}

export type ChoiceGroupProps<Value = unknown> = {
  name: string
  options: ChoiceGroupOption<Value>[]
  value: Value | undefined
  onChange: (value: Value | undefined) => void
  isValueEqual?: (a: Value | undefined, b: Value | undefined) => boolean
  allowDeselect?: boolean
  ariaLabel?: string
  disabled?: boolean
}

function getChoiceKey(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function defaultIsValueEqual<Value>(
  a: Value | undefined,
  b: Value | undefined
): boolean {
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return a === b
}

export function ChoiceGroup<Value = unknown>({
  name,
  options,
  value,
  onChange,
  isValueEqual = defaultIsValueEqual,
  allowDeselect = false,
  ariaLabel,
  disabled = false,
}: ChoiceGroupProps<Value>) {
  return (
    <fieldset
      disabled={disabled}
      className="grid w-full grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] overflow-hidden rounded border border-chalkboard-20 bg-chalkboard-10 p-0 disabled:opacity-60 dark:border-chalkboard-80 dark:bg-chalkboard-90"
    >
      <legend className="sr-only">{ariaLabel || name}</legend>
      {options.map((option) => {
        const isSelected = isValueEqual(value, option.value)
        return (
          <button
            key={`${name}-${getChoiceKey(option.value)}`}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled || option.disabled}
            title={option.title}
            onClick={() => {
              if (isSelected && allowDeselect) {
                onChange(undefined)
                return
              }
              onChange(option.value)
            }}
            className={[
              'm-0 min-h-7 min-w-0 rounded-none border-0 border-chalkboard-20 border-r border-solid px-2 py-1 text-xs leading-tight last:border-r-0 dark:border-chalkboard-80',
              'focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-appForeground disabled:cursor-not-allowed disabled:opacity-50',
              isSelected
                ? '!bg-primary !text-chalkboard-10 hover:!bg-primary focus:!bg-primary'
                : 'bg-transparent text-chalkboard-90 hover:bg-chalkboard-20 dark:text-chalkboard-20 dark:hover:bg-chalkboard-80',
            ].join(' ')}
          >
            <span className="block truncate">{option.name}</span>
          </button>
        )
      })}
    </fieldset>
  )
}
