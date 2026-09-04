import type { ReactNode } from 'react'
import { ChoiceGroup } from '../ChoiceGroup/ChoiceGroup'
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
  selectionHeading?: ReactNode
  selectionEmptyLabel?: ReactNode
  selectionHint?: ReactNode
  currentSelectionLabel?: ReactNode
  isSelecting?: boolean
  disabled?: boolean
  controlStyle?: 'select' | 'segmented'
  compactSelection?: boolean
  hideLabel?: boolean
  orderedSelection?: boolean
  onChange: (value: unknown) => void
  onStartSelecting?: () => void
  onRemoveSelection?: (item: Item) => void
  onMoveSelection?: (item: Item, direction: 'up' | 'down') => void
  onClearSelection?: () => void
}

export function isOptionValueEqual(a: unknown, b: unknown): boolean {
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

function FieldLabel({
  label,
  isRequired,
}: {
  label: ReactNode
  isRequired: boolean
}) {
  return (
    <span className="text-xs font-medium leading-tight text-chalkboard-80 dark:text-chalkboard-20">
      {label}
      {isRequired && <span aria-hidden="true"> *</span>}
      {isRequired && <span className="sr-only"> (required)</span>}
    </span>
  )
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
  selectionHeading,
  selectionEmptyLabel,
  selectionHint,
  currentSelectionLabel,
  isSelecting = false,
  disabled = false,
  controlStyle = 'select',
  compactSelection = false,
  hideLabel = false,
  orderedSelection = false,
  onChange,
  onStartSelecting,
  onRemoveSelection,
  onMoveSelection,
  onClearSelection,
}: ArgumentFieldProps<Item>) {
  const fieldClassName = 'flex flex-col gap-1'
  const inputClassName =
    'min-h-7 w-full rounded-sm border border-chalkboard-30 bg-transparent px-2 py-1 text-xs leading-tight focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-appForeground disabled:cursor-not-allowed disabled:bg-chalkboard-10 disabled:text-chalkboard-60 dark:border-chalkboard-70 dark:disabled:bg-chalkboard-90 dark:disabled:text-chalkboard-50'

  if (inputType === 'options') {
    const selectedIndex = options.findIndex((option) =>
      isOptionValueEqual(option.value, value)
    )

    if (controlStyle === 'segmented') {
      return (
        <div className={fieldClassName}>
          <FieldLabel label={label} isRequired={isRequired} />
          <ChoiceGroup
            name={name}
            value={value}
            options={options}
            onChange={onChange}
            isValueEqual={isOptionValueEqual}
            allowDeselect={!isRequired}
            ariaLabel={typeof label === 'string' ? label : name}
            disabled={disabled}
          />
          <FieldDescription description={description} />
        </div>
      )
    }

    return (
      <label className={fieldClassName}>
        <FieldLabel label={label} isRequired={isRequired} />
        <select
          value={selectedIndex >= 0 ? String(selectedIndex) : ''}
          disabled={disabled}
          onChange={(event) => {
            const rawIndex = event.target.value
            onChange(
              rawIndex === '' ? undefined : options[Number(rawIndex)]?.value
            )
          }}
          className={inputClassName}
        >
          <option value="" disabled={isRequired}>
            {isRequired ? 'Select an option' : 'Optional'}
          </option>
          {options.map((option, index) => (
            <option
              key={`${name}-${String(option.name)}-${index}`}
              value={String(index)}
              disabled={disabled || option.disabled}
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
    if (controlStyle === 'segmented') {
      return (
        <div className={fieldClassName}>
          <FieldLabel label={label} isRequired={isRequired} />
          <ChoiceGroup
            name={name}
            value={value === true || value === false ? value : undefined}
            options={[
              { name: 'On', value: true },
              { name: 'Off', value: false },
            ]}
            onChange={onChange}
            allowDeselect={!isRequired}
            ariaLabel={typeof label === 'string' ? label : name}
            disabled={disabled}
          />
          <FieldDescription description={description} />
        </div>
      )
    }

    return (
      <label className={fieldClassName}>
        <FieldLabel label={label} isRequired={isRequired} />
        <select
          value={boolValue}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.target.value === ''
                ? undefined
                : event.target.value === 'true'
            )
          }
          className={inputClassName}
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
    const activateCollector = () => {
      if (!disabled && !isSelecting) {
        onStartSelecting?.()
      }
    }

    return (
      <div className="flex flex-col gap-1">
        {!hideLabel && <FieldLabel label={label} isRequired={isRequired} />}
        <div
          className={[
            'relative rounded-sm border transition-colors',
            compactSelection ? 'px-2 py-1' : 'p-2',
            disabled
              ? 'border-chalkboard-20 bg-chalkboard-10/30 dark:border-chalkboard-80 dark:bg-chalkboard-100/30'
              : isSelecting
                ? 'border-primary/70 bg-primary/[0.03] dark:border-primary/60 dark:bg-primary/[0.08]'
                : 'border-chalkboard-20 bg-chalkboard-10/40 hover:border-chalkboard-40 hover:bg-chalkboard-10 dark:border-chalkboard-70 dark:bg-chalkboard-100/40 dark:hover:border-chalkboard-50 dark:hover:bg-chalkboard-90/60',
          ].join(' ')}
        >
          <button
            type="button"
            aria-pressed={isSelecting}
            disabled={disabled}
            aria-label={
              typeof label === 'string' ? `Select ${label}` : `Select ${name}`
            }
            onClick={activateCollector}
            className="absolute inset-0 z-0 m-0 h-full w-full cursor-pointer rounded-sm border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-appForeground disabled:cursor-not-allowed"
          />
          <div className="pointer-events-none relative z-10">
            <SelectionList
              items={selectionItems}
              onRemove={
                disabled ? undefined : (item) => onRemoveSelection?.(item)
              }
              heading={selectionHeading}
              emptyLabel={selectionEmptyLabel}
              hint={selectionHint}
              isActive={isSelecting}
              onClear={disabled ? undefined : onClearSelection}
              compact={compactSelection}
              ordered={orderedSelection}
              onMove={
                disabled
                  ? undefined
                  : (item, direction) => onMoveSelection?.(item, direction)
              }
            />
            {!compactSelection && !disabled && !isSelecting && (
              <p className="mt-1.5 mb-0 border-chalkboard-20 border-t pt-1.5 text-[11px] leading-snug text-chalkboard-70 dark:border-chalkboard-70 dark:text-chalkboard-40">
                Click to {selectionItems.length > 0 ? 'change' : 'pick'} the
                selection in the scene
              </p>
            )}
            {isSelecting && (
              <p
                className="mt-1.5 mb-0 border-primary/20 border-t pt-1.5 text-[11px] leading-snug text-chalkboard-70 dark:border-primary/25 dark:text-chalkboard-30"
                aria-live="polite"
              >
                {currentSelectionLabel ? (
                  <>Selecting: {currentSelectionLabel}</>
                ) : (
                  'Selecting in the scene...'
                )}
              </p>
            )}
          </div>
        </div>
        <FieldDescription description={description} />
      </div>
    )
  }

  if (inputType === 'text') {
    return (
      <label className={fieldClassName}>
        <FieldLabel label={label} isRequired={isRequired} />
        <textarea
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClassName} min-h-16`}
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
      <label className={fieldClassName}>
        <FieldLabel label={label} isRequired={isRequired} />
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={inputClassName}
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
      <label className={fieldClassName}>
        <FieldLabel label={label} isRequired={isRequired} />
        <input
          type="color"
          value={colorValue}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-full rounded-sm border border-chalkboard-30 bg-transparent focus-visible:outline focus-visible:outline-1 focus-visible:outline-appForeground disabled:cursor-not-allowed dark:border-chalkboard-70"
        />
        <FieldDescription description={description} />
      </label>
    )
  }

  return (
    <label className={fieldClassName}>
      <FieldLabel label={label} isRequired={isRequired} />
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
        placeholder={typeof label === 'string' ? label : name}
      />
      <FieldDescription description={description} />
    </label>
  )
}
