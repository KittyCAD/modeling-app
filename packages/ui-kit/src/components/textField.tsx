import type { JSX, RefObject } from 'preact'
import { useMemo } from 'preact/hooks'
import type { IconName } from '../icons'
import { Icon } from './icon'
import {
  type BaseProps,
  type ControlSize,
  type MaybeSignal,
  cx,
  uniqueId,
} from './shared'
import './textField.css'

export interface TextFieldProps extends BaseProps {
  /** Always required; pass `hideLabel` if it should not be drawn. */
  label: string
  hideLabel?: boolean
  value?: MaybeSignal<string>
  placeholder?: string
  icon?: IconName
  size?: ControlSize
  type?: 'text' | 'search' | 'number' | 'password' | 'email'
  disabled?: MaybeSignal<boolean>
  autofocus?: boolean
  /** Direct access to the input, for callers that must focus or select it. */
  inputRef?: RefObject<HTMLInputElement>
  /** Fires on every keystroke, with the current value. */
  onValueInput?: (value: string) => void
  onKeyDown?: JSX.KeyboardEventHandler<HTMLInputElement>
  /**
   * Fires when focus leaves the input.
   *
   * For fields where clicking away is an answer — an inline rename commits or
   * abandons rather than sitting there once you have looked elsewhere.
   */
  onBlur?: JSX.FocusEventHandler<HTMLInputElement>
  /** Fires on Enter, with the current value. */
  onSubmit?: (value: string) => void
}

/**
 * Single-line text entry.
 *
 * The label is mandatory even when hidden. A bare input with only a
 * placeholder loses its accessible name the moment someone types into it, and
 * the placeholder vanishes exactly when it would be most useful.
 */
export function TextField({
  label,
  hideLabel,
  value,
  placeholder,
  icon,
  size = 'medium',
  type = 'text',
  disabled,
  autofocus,
  inputRef,
  onValueInput,
  onKeyDown,
  onBlur,
  onSubmit,
  class: className,
  id,
  ...rest
}: TextFieldProps) {
  const inputId = useMemo(() => id ?? uniqueId('field'), [id])

  return (
    <div {...rest} class={cx('zds-field', `zds-field--${size}`, className)}>
      <label
        class={cx(
          'zds-label',
          'zds-field__label',
          hideLabel && 'zds-visually-hidden'
        )}
        for={inputId}
      >
        {label}
      </label>
      <div class="zds-field__control">
        {icon ? (
          <Icon name={icon} size="small" class="zds-field__icon" />
        ) : null}
        <input
          ref={inputRef}
          class="zds-field__input"
          id={inputId}
          type={type}
          placeholder={placeholder}
          disabled={disabled}
          value={value}
          autocomplete="off"
          spellcheck={false}
          // biome-ignore lint/a11y/noAutofocus: opt-in per call site, used for
          // surfaces whose whole purpose is text entry (search, command bar).
          autofocus={autofocus}
          onInput={(event) => {
            onValueInput?.((event.target as HTMLInputElement).value)
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event)
            if (event.key === 'Enter' && onSubmit) {
              event.preventDefault()
              onSubmit((event.target as HTMLInputElement).value)
            }
          }}
          onBlur={onBlur}
        />
      </div>
    </div>
  )
}
