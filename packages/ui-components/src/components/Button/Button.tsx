import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import './Button.css'
import {
  getButtonClassName,
  type ButtonEmphasis,
  type ButtonTone,
} from './buttonClassName'

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  tone?: ButtonTone
  emphasis?: ButtonEmphasis
  fullWidth?: boolean
  leadingVisual?: ReactNode
  trailingVisual?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className,
      tone = 'primary',
      emphasis = 'solid',
      fullWidth = false,
      leadingVisual,
      trailingVisual,
      type,
      ...props
    },
    ref
  ) {
    const resolvedType = type ?? 'button'

    return (
      <button
        {...props}
        ref={ref}
        type={resolvedType}
        className={getButtonClassName({
          tone,
          emphasis,
          fullWidth,
          className,
        })}
        data-tone={tone}
        data-emphasis={emphasis}
        data-full-width={fullWidth ? 'true' : undefined}
      >
        {leadingVisual ? (
          <span className="zds-button__visual" aria-hidden="true">
            {leadingVisual}
          </span>
        ) : null}
        <span className="zds-button__label">{children}</span>
        {trailingVisual ? (
          <span className="zds-button__visual" aria-hidden="true">
            {trailingVisual}
          </span>
        ) : null}
      </button>
    )
  }
)
