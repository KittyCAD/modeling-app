import { type IconName, iconPaths } from '../icons'
import { type BaseProps, cx } from './shared'
import './icon.css'

export interface IconProps extends BaseProps {
  name: IconName
  /** Defaults to `medium` (16px), the grid the set is drawn on. */
  size?: 'small' | 'medium' | 'large' | number
  /**
   * Icons are decorative by default and hidden from assistive tech. Pass a
   * label only when the icon is the sole carrier of meaning.
   */
  label?: string
}

function resolveSize(size: IconProps['size']): string {
  if (typeof size === 'number') return `${size}px`
  switch (size) {
    case 'small':
      return 'var(--zds-size-icon-sm)'
    case 'large':
      return 'var(--zds-size-icon-lg)'
    default:
      return 'var(--zds-size-icon-md)'
  }
}

export function Icon({
  name,
  size,
  label,
  class: className,
  ...rest
}: IconProps) {
  return (
    <svg
      {...rest}
      class={cx('zds-icon', className)}
      viewBox="0 0 16 16"
      style={{ '--zds-icon-size': resolveSize(size) }}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    >
      <path
        d={iconPaths[name]}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
