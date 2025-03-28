// We do use all the classes in this file currently, but we
// index into them with styles[position], which CSS Modules doesn't pick up.
// eslint-disable-next-line css-modules/no-unused-class
import styles from './Tooltip.module.css'

type TopOrBottom = 'top' | 'bottom'
type LeftOrRight = 'left' | 'right'
type Corner = `${TopOrBottom}-${LeftOrRight}`
type TooltipPosition = TopOrBottom | LeftOrRight | Corner

interface TooltipProps extends React.PropsWithChildren {
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
}: TooltipProps) {
  return (
    <div
      // @ts-ignore while awaiting merge of this PR for support of "inert" https://github.com/DefinitelyTyped/DefinitelyTyped/pull/60822
      {...{ inert: inert ? '' : undefined }}
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
    >
      <div className={`rounded ${styles.tooltip} ${contentClassName || ''}`}>
        {children}
      </div>
    </div>
  )
}
