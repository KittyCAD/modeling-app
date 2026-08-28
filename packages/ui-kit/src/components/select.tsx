import { useMemo } from 'preact/hooks'
import { Icon } from './icon'
import {
  type BaseProps,
  type ControlSize,
  cx,
  type MaybeSignal,
  uniqueId,
} from './shared'
import './select.css'

export interface SelectOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export interface SelectProps<T extends string> extends BaseProps {
  /** Always required; pass `hideLabel` if it should not be drawn. */
  label: string
  hideLabel?: boolean
  value: MaybeSignal<T>
  options: readonly SelectOption<T>[]
  size?: ControlSize
  disabled?: MaybeSignal<boolean>
  onValueChange?: (value: T) => void
}

/**
 * A fixed set of choices.
 *
 * A native `select` rather than a custom listbox. The platform already gets
 * keyboard, touch, and screen-reader behaviour right, and the only thing a
 * bespoke popup would buy here is the ability to get them wrong. The chevron is
 * ours; the menu is the operating system's.
 */
export function Select<T extends string>({
  label,
  hideLabel,
  value,
  options,
  size = 'medium',
  disabled,
  onValueChange,
  class: className,
  id,
  ...rest
}: SelectProps<T>) {
  const selectId = useMemo(() => id ?? uniqueId('select'), [id])

  return (
    <div {...rest} class={cx('zds-select', `zds-select--${size}`, className)}>
      <label
        class={cx(
          'zds-label',
          'zds-select__label',
          hideLabel && 'zds-visually-hidden'
        )}
        for={selectId}
      >
        {label}
      </label>
      <div class="zds-select__control">
        <select
          class="zds-select__input"
          id={selectId}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onValueChange?.((event.target as HTMLSelectElement).value as T)
          }}
        >
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size="small" class="zds-select__chevron" />
      </div>
    </div>
  )
}
