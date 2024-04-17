// We do use all the classes in this file currently, but we
// index into them with styles[position], which CSS Modules doesn't pick up.
// eslint-disable-next-line css-modules/no-unused-class
import styles from './Tooltip.module.css'

interface TooltipProps extends React.PropsWithChildren {
  position?:
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'blockStart'
    | 'blockEnd'
    | 'inlineStart'
    | 'inlineEnd'
  className?: string
  delay?: number
  hoverOnly?: boolean
}

export default function Tooltip({
  children,
  position = 'top',
  className,
  delay = 200,
  hoverOnly = false,
}: TooltipProps) {
  return (
    <div
      // @ts-ignore while awaiting merge of this PR for support of "inert" https://github.com/DefinitelyTyped/DefinitelyTyped/pull/60822
      inert="true"
      role="tooltip"
      className={`${styles.tooltip} ${hoverOnly ? '' : styles.withFocus} ${
        styles[position]
      } ${className}`}
      style={{ '--_delay': delay + 'ms' } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
