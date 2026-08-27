import { type BaseProps, type MaybeSignal, cx } from './shared'
import './spinner.css'

export interface SpinnerProps extends BaseProps {
  size?: 'small' | 'medium' | 'large'
  /** What is being waited on. Announced to assistive tech. */
  label: MaybeSignal<string>
}

/**
 * Indeterminate progress, drawn as a rotating arc rather than a full ring so it
 * reads as a machine indexing to position.
 */
export function Spinner({
  size = 'medium',
  label,
  class: className,
  ...rest
}: SpinnerProps) {
  return (
    <span
      {...rest}
      class={cx('zds-spinner', `zds-spinner--${size}`, className)}
      role="status"
      aria-label={label}
    />
  )
}
