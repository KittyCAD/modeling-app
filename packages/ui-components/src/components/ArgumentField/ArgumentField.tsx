import type { ReactNode } from 'react'
import {
  SelectionList,
  type SelectionListItem,
} from '../SelectionList/SelectionList'

export type ArgumentFieldOption<Value = unknown> = {
  name: string
  isCurrent?: boolean
  disabled?: boolean
  value: Value
}

export type ArgumentFieldInputType =
  | 'options'
  | 'selection'
  | 'selectionMixed'
  | 'kcl'
  | 'string'
  | 'color'
  | 'tagDeclarator'
  | 'path'
  | 'text'
  | 'boolean'
  | 'number'
  | 'vector3d'
  | 'vector2d'

export type ArgumentFieldProps<Item extends SelectionListItem> = {
  name: string
  inputType: ArgumentFieldInputType
  label?: ReactNode
  description?: ReactNode
  isRequired: boolean
  options?: ArgumentFieldOption[]
  value: unknown
  selectionItems?: Item[]
  currentSelectionLabel?: ReactNode
  isSelecting?: boolean
  onChange: (value: unknown) => void
  onStartSelecting?: () => void
  onStopSelecting?: () => void
  onRemoveSelection?: (item: Item) => void
}

function isOptionValueEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return a === b
}

function FieldDescription({ description }: { description?: ReactNode }) {
  if (!description) {
    return null
  }
  return <>{description}</>
}

export function ArgumentField<Item extends SelectionListItem>({
  name,
  inputType,
  label = name,
  description,
  isRequired,
  options = [],
  value,
  selectionItems = [],
  currentSelectionLabel,
  isSelecting = false,
  onChange,
  onStartSelecting,
  onStopSelecting,
  onRemoveSelection,
}: ArgumentFieldProps<Item>) {
  if (inputType === 'options') {
    const selectedIndex = options.findIndex((option) =>
      isOptionValueEqual(option.value, value)
    )

    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium leading-tight">
          {label}
          {isRequired ? ' *' : ''}
        </span>
        <select
          value={selectedIndex >= 0 ? String(selectedIndex) : ''}
          onChange={(event) => {
            const rawIndex = event.target.value
            onChange(
              rawIndex === '' ? undefined : options[Number(rawIndex)]?.value
            )
          }}
          className="w-full rounded border border-chalkboard-30 bg-transparent px-2 py-1.5 text-xs leading-tight"
        >
          <option value="" disabled={isRequired}>
            {isRequired ? 'Select an option' : 'Optional'}
          </option>
          {options.map((option, index) => (
            <option
              key={`${name}-${String(option.name)}-${index}`}
              value={String(index)}
              disabled={option.disabled}
            >
              {option.name}
            </option>
          ))}
        </select>
        <FieldDescription description={description} />
      </label>
    )
  }

  if (inputType === 'boolean') {
    const boolValue = value === true ? 'true' : value === false ? 'false' : ''
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium leading-tight">
          {label}
          {isRequired ? ' *' : ''}
        </span>
        <select
          value={boolValue}
          onChange={(event) =>
            onChange(
              event.target.value === ''
                ? undefined
                : event.target.value === 'true'
            )
          }
          className="w-full rounded border border-chalkboard-30 bg-transparent px-2 py-1.5 text-xs leading-tight"
        >
          <option value="" disabled={isRequired}>
            {isRequired ? 'Select true or false' : 'Optional'}
          </option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
        <FieldDescription description={description} />
      </label>
    )
  }

  if (inputType === 'selection' || inputType === 'selectionMixed') {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium leading-tight">
          {label}
          {isRequired ? ' *' : ''}
        </span>
        <SelectionList
          items={selectionItems}
          onRemove={(item) => onRemoveSelection?.(item)}
        />
        {isSelecting && currentSelectionLabel && (
          <p className="my-0 text-[10px] leading-tight text-primary dark:text-primary">
            Selecting now: {currentSelectionLabel}
          </p>
        )}
        <div>
          <button
            type="button"
            tabIndex={0}
            onClick={() => {
              if (isSelecting) {
                onStopSelecting?.()
                return
              }
              onStartSelecting?.()
            }}
            className="px-2 py-1 text-xs"
          >
            {isSelecting ? 'Stop Selecting' : 'Select'}
          </button>
        </div>
        <FieldDescription description={description} />
      </div>
    )
  }

  if (inputType === 'text') {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium leading-tight">
          {label}
          {isRequired ? ' *' : ''}
        </span>
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-16 w-full rounded border border-chalkboard-30 bg-transparent px-2 py-1.5 text-xs leading-tight"
          placeholder={typeof label === 'string' ? label : name}
        />
        <FieldDescription description={description} />
      </label>
    )
  }

  if (
    inputType === 'kcl' ||
    inputType === 'vector2d' ||
    inputType === 'vector3d'
  ) {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium leading-tight">
          {label}
          {isRequired ? ' *' : ''}
        </span>
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded border border-chalkboard-30 bg-transparent px-2 py-1.5 text-xs leading-tight"
          placeholder={
            inputType === 'vector2d'
              ? '[x, y]'
              : inputType === 'vector3d'
                ? '[x, y, z]'
                : typeof label === 'string'
                  ? label
                  : name
          }
        />
        <FieldDescription description={description} />
      </label>
    )
  }

  if (inputType === 'color') {
    const colorValue =
      typeof value === 'string' && value.startsWith('#') ? value : '#ffffff'
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium leading-tight">
          {label}
          {isRequired ? ' *' : ''}
        </span>
        <input
          type="color"
          value={colorValue}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-full rounded border border-chalkboard-30 bg-transparent"
        />
        <FieldDescription description={description} />
      </label>
    )
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium leading-tight">
        {label}
        {isRequired ? ' *' : ''}
      </span>
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-chalkboard-30 bg-transparent px-2 py-1.5 text-xs leading-tight"
        placeholder={typeof label === 'string' ? label : name}
      />
      <FieldDescription description={description} />
    </label>
  )
}
