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
  /**
   * What the button does, added to the tooltip after a longer dwell.
   *
   * For an icon-only button whose glyph carries the whole meaning: the name
   * appears at hover speed and the explanation follows for whoever stops to
   * read.
   */
  description?: string
  /**
   * Access to the underlying element.
   *
   * A callback rather than a ref object, so a caller can forward it straight
   * from a render prop. Needed by anything that has to focus or measure the
   * button — a menu returning focus to its trigger, for instance.
   */
  elementRef?: (element: HTMLButtonElement | null) => void
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
  description,
  elementRef,
  children,
  class: className,
  ...rest
}: ButtonProps) {
  const accessibleName = typeof label === 'string' ? label : undefined
  const tooltipRef = useTooltip<HTMLButtonElement>(
    accessibleName && (iconOnly || shortcut || description)
      ? { content: accessibleName, shortcut, description }
      : undefined
  )

  // One callback feeding both consumers: the tooltip needs a ref object, and the
  // caller may want the element too.
  const ref = (element: HTMLButtonElement | null) => {
    tooltipRef.current = element
    elementRef?.(element)
  }

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
