// We do use all the classes in this file currently, but we
// index into them with styles[position], which CSS Modules doesn't pick up.
// eslint-disable-next-line css-modules/no-unused-class
import styles from './Tooltip.module.css'

type TopOrBottom = 'top' | 'bottom'
type LeftOrRight = 'left' | 'right'
type Corner = `${TopOrBottom}-${LeftOrRight}`
type TooltipPosition = TopOrBottom | LeftOrRight | Corner

export interface TooltipProps extends React.HTMLProps<HTMLDivElement> {
  position?: TooltipPosition
  wrapperClassName?: string
  contentClassName?: string
  wrapperStyle?: React.CSSProperties
  delay?: number
  hoverOnly?: boolean
  inert?: boolean
}

export default function Tooltip({
  children,
  position = 'top',
  wrapperClassName: className,
  contentClassName,
  wrapperStyle = {},
  delay = 0,
  hoverOnly = false,
  inert = true,
  ...rest
}: TooltipProps) {
  return (
    <div
      inert={inert}
      role="tooltip"
      className={`p-3 ${
        position !== 'left' && position !== 'right' ? 'px-0' : ''
      } ${styles.tooltipWrapper} ${hoverOnly ? '' : styles.withFocus} ${
        styles[position]
      } ${className}`}
      style={Object.assign(
        { '--_delay': delay + 'ms' } as React.CSSProperties,
        wrapperStyle
      )}
      {...rest}
    >
      <div className={`rounded ${styles.tooltip} ${contentClassName || ''}`}>
        {children}
      </div>
    </div>
  )
}
