import type { ComponentChildren, JSX } from 'preact'
import type { IconName } from '../icons'
import { Icon } from './icon'
import {
  type BaseProps,
  type ControlSize,
  type MaybeSignal,
  cx,
} from './shared'
import { useTooltip } from './tooltip'
import './button.css'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  /** Chassis buttons sit in the top bar and status bar: square, quiet, dense. */
  | 'chassis'

export interface ButtonProps extends BaseProps {
  label?: MaybeSignal<string>
  variant?: ButtonVariant
  size?: ControlSize
  icon?: IconName
  iconEnd?: IconName
  disabled?: MaybeSignal<boolean>
  pressed?: MaybeSignal<boolean>
  type?: 'button' | 'submit' | 'reset'
  onClick?: JSX.MouseEventHandler<HTMLButtonElement>
  /**
   * Hides the visible label while keeping it as the accessible name and the
   * tooltip. The label is still required — an icon-only button with no name is
   * a dead end for anyone who does not recognise the glyph.
   */
  iconOnly?: boolean
  /** Keyboard hint shown in the tooltip, e.g. `⌘K`. */
  shortcut?: string
  children?: ComponentChildren
}

export function Button({
  label,
  variant = 'secondary',
  size = 'medium',
  icon,
  iconEnd,
  disabled,
  pressed,
  type = 'button',
  onClick,
  iconOnly = false,
  shortcut,
  children,
  class: className,
  ...rest
}: ButtonProps) {
  const accessibleName = typeof label === 'string' ? label : undefined
  const ref = useTooltip<HTMLButtonElement>(
    accessibleName && (iconOnly || shortcut)
      ? { content: accessibleName, shortcut }
      : undefined
  )

  return (
    <button
      {...rest}
      ref={ref}
      class={cx(
        'zds-button',
        `zds-button--${variant}`,
        `zds-button--${size}`,
        iconOnly && 'zds-button--icon-only',
        className
      )}
      type={type}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={iconOnly ? accessibleName : undefined}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={size} /> : null}
      {!iconOnly && label ? (
        <span class="zds-button__label">{label}</span>
      ) : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} size={size} /> : null}
    </button>
  )
}
