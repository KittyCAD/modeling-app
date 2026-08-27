import { type BaseProps, type MaybeSignal, cx } from './shared'
import './statusDot.css'

export type StatusTone = 'ok' | 'warn' | 'fault' | 'idle' | 'busy'

export interface StatusDotProps extends BaseProps {
  tone: MaybeSignal<StatusTone>
  /** Required: the dot alone is not an accessible name. */
  label: MaybeSignal<string>
}

/**
 * A single-glyph state readout.
 *
 * The app's whole live-state vocabulary is five tones. Keeping the set that
 * small is what lets someone glance at the status bar and know, without
 * reading, whether anything needs them.
 */
export function StatusDot({
  tone,
  label,
  class: className,
  ...rest
}: StatusDotProps) {
  return (
    <span
      {...rest}
      class={cx('zds-status-dot', className)}
      data-tone={tone}
      role="img"
      aria-label={label}
    />
  )
}
