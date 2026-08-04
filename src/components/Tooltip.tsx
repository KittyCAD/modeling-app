// We do use all the classes in this file currently, but we
// index into them with styles[position], which CSS Modules doesn't pick up.

import { useEffect, useRef } from 'react'
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

function supportsNativeAnchorPositioning() {
  return (
    typeof CSS !== 'undefined' &&
    CSS.supports('position-anchor', 'auto') &&
    CSS.supports('top', 'anchor(bottom)')
  )
}

// Browser-native anchor positioning is still uneven, so keep a direct
// rectangle-based fallback for popover tooltips.
function positionTooltipFromTrigger(
  tooltip: HTMLElement,
  trigger: HTMLElement,
  position: TooltipPosition
) {
  const triggerBox = trigger.getBoundingClientRect()
  const tooltipBox = tooltip.getBoundingClientRect()

  let left = triggerBox.left
  let top = triggerBox.top

  switch (position) {
    case 'top':
      left = triggerBox.left + triggerBox.width / 2 - tooltipBox.width / 2
      top = triggerBox.top - tooltipBox.height
      break
    case 'top-left':
      left = triggerBox.left
      top = triggerBox.top - tooltipBox.height
      break
    case 'top-right':
      left = triggerBox.right - tooltipBox.width
      top = triggerBox.top - tooltipBox.height
      break
    case 'right':
      left = triggerBox.right
      top = triggerBox.top + triggerBox.height / 2 - tooltipBox.height / 2
      break
    case 'bottom':
      left = triggerBox.left + triggerBox.width / 2 - tooltipBox.width / 2
      top = triggerBox.bottom
      break
    case 'bottom-left':
      left = triggerBox.left
      top = triggerBox.bottom
      break
    case 'bottom-right':
      left = triggerBox.right - tooltipBox.width
      top = triggerBox.bottom
      break
    case 'left':
      left = triggerBox.left - tooltipBox.width
      top = triggerBox.top + triggerBox.height / 2 - tooltipBox.height / 2
      break
  }

  Object.assign(tooltip.style, {
    bottom: 'auto',
    inset: 'auto',
    left: `${left}px`,
    position: 'fixed',
    right: 'auto',
    top: `${top}px`,
    transform: 'none',
  })
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

    const updateFallbackPosition = () => {
      if (tooltip.current && !supportsNativeAnchorPositioning()) {
        positionTooltipFromTrigger(tooltip.current, parent, position)
      }
    }

    const show = () => {
      const currentTooltip = tooltip.current
      if (!currentTooltip) return

      currentTooltip.showPopover({ source: parent })
      updateFallbackPosition()

      if (!supportsNativeAnchorPositioning()) {
        window.addEventListener('resize', updateFallbackPosition)
        window.addEventListener('scroll', updateFallbackPosition, true)
      }
    }
    const hide = () => {
      window.removeEventListener('resize', updateFallbackPosition)
      window.removeEventListener('scroll', updateFallbackPosition, true)
      tooltip.current?.hidePopover()
    }

    parent.addEventListener('mouseenter', show)
    parent.addEventListener('mouseleave', hide)
    parent.addEventListener('focus', show)
    parent.addEventListener('blur', hide)

    return () => {
      parent.removeEventListener('mouseenter', show)
      parent.removeEventListener('mouseleave', hide)
      parent.removeEventListener('focus', show)
      parent.removeEventListener('blur', hide)
      window.removeEventListener('resize', updateFallbackPosition)
      window.removeEventListener('scroll', updateFallbackPosition, true)
    }
  }, [position])
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
