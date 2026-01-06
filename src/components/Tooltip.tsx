// We do use all the classes in this file currently, but we
// index into them with styles[position], which CSS Modules doesn't pick up.
// eslint-disable-next-line css-modules/no-unused-class
import { useRef, useEffect } from 'react'
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
  const tooltip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (tooltip.current === null) {
      return
    }
    const parent = tooltip.current.parentElement
    if (!parent) {
      return
    }

    // @ts-ignore-next-line -- React is not up to date about the options that can be passed
    const show = () => tooltip.current?.showPopover({ source: parent })
    const hide = () => tooltip.current?.hidePopover()

    parent.addEventListener('mouseenter', show)
    parent.addEventListener('mouseleave', hide)
    parent.addEventListener('focus', show)
    parent.addEventListener('blur', hide)

    return () => {
      parent.removeEventListener('mouseenter', show)
      parent.removeEventListener('mouseleave', hide)
      parent.removeEventListener('focus', show)
      parent.removeEventListener('blur', hide)
    }
  }, [])
  return (
    <div
      popover="hint"
      ref={tooltip}
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
