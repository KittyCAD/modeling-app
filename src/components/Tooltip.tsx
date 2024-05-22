// We do use all the classes in this file currently, but we
// index into them with styles[position], which CSS Modules doesn't pick up.
// eslint-disable-next-line css-modules/no-unused-class
import styles from './Tooltip.module.css'

const SIDES = ['top', 'bottom', 'left', 'right'] as const
type TopOrBottom = 'top' | 'bottom'
type LeftOrRight = 'left' | 'right'
type Corner = `${TopOrBottom}-${LeftOrRight}`
type TooltipPosition = TopOrBottom | LeftOrRight | Corner

interface TooltipProps extends React.PropsWithChildren {
  position?: TooltipPosition
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
      <div className={styles.caret}>
        {SIDES.includes(position as any) ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 8 12"
          >
            <path
              fill="currentColor"
              d="M3.0513 9.154c.304.9116 1.5935.9116 1.8974 0L8 0H0l3.0513 9.154Z"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 8 10"
          >
            <path
              fill="currentColor"
              d="m0 0 6.168 9.252C6.7168 10.0751 8 9.6865 8 8.6971V0H0Z"
            />
          </svg>
        )}
      </div>
    </div>
  )
}
