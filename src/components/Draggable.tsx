import type {
  CSSProperties,
  HTMLProps,
  MouseEventHandler,
  ReactNode,
  RefObject,
} from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'

interface DraggableProps extends HTMLProps<HTMLDivElement> {
  containerRef?: RefObject<HTMLElement | null>
  Handle?: ReactNode
  side?: Side
}

type Side = 'top' | 'right' | 'bottom' | 'left'
type Offset = {
  top: number
  left: number
}

function Draggable({
  containerRef,
  Handle,
  side: providedSide,
  style: providedStyle,
  children,
  ...props
}: DraggableProps) {
  const style = useMemo(
    () =>
      Object.assign(
        structuredClone(providedStyle) ?? ({} as CSSProperties),
        sideToCSSStyles(providedSide || 'top'),
        { boxSizing: 'border-box', cursor: Handle === undefined && 'move' }
      ),
    [providedSide, providedStyle, Handle]
  )
  const dragRef = useRef<HTMLDivElement>(null)
  const dragCallback = useRef<(e: MouseEvent) => void | undefined>(undefined)

  const elementDrag = useCallback(
    (offset: Offset) => (e: MouseEvent) => {
      e.preventDefault()
      if (!dragRef.current) {
        return
      }
      const container = containerRef?.current ?? window.document.body

      // set the element's new position:
      const containerBox = container.getBoundingClientRect()
      const targetBox = dragRef.current.getBoundingClientRect()
      const targetTop = e.clientY - offset.top
      const targetLeft = e.clientX - offset.left
      const top = clamp(
        targetTop,
        containerBox.top,
        containerBox.bottom - targetBox.height
      )
      const left = clamp(
        targetLeft,
        containerBox.left,
        containerBox.right - targetBox.width
      )
      dragRef.current.style.top = top + 'px'
      dragRef.current.style.left = left + 'px'
    },
    [dragRef.current, containerRef?.current]
  )

  const closeDragElement = useCallback(() => {
    // stop moving when mouse button is released:
    document.removeEventListener('mouseup', closeDragElement)
    if (dragCallback.current) {
      document.removeEventListener('mousemove', dragCallback.current)
    }
  }, [dragCallback.current])

  const dragMouseDown: MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      e.preventDefault()

      if (!dragRef.current) {
        return
      }
      const { width, height, top, left } =
        dragRef.current.getBoundingClientRect()
      const computedStyles = getComputedStyle(dragRef.current)
      const pxStyleToNumber = (property: keyof CSSStyleDeclaration) =>
        Number(
          typeof computedStyles[property] === 'string' &&
            computedStyles[property].replace('px', '')
        ) ?? 0
      const marginBlockStart = pxStyleToNumber('marginBlockStart')
      const marginInlineStart = pxStyleToNumber('marginInlineStart')
      dragRef.current.style.position = 'fixed'
      dragRef.current.style.top = top - marginBlockStart + 'px'
      dragRef.current.style.left = left - marginInlineStart + 'px'
      dragRef.current.style.width = width + 'px'
      dragRef.current.style.height = height + 'px'

      // get the mouse cursor position at startup:
      document.addEventListener('mouseup', closeDragElement)
      // call a function whenever the cursor moves:
      const onDrag = elementDrag({
        top: e.nativeEvent.offsetY,
        left: e.nativeEvent.offsetX,
      })
      // Save a ref to the callback so we can remove the event listener on mouseup
      dragCallback.current = onDrag
      document.addEventListener('mousemove', onDrag)
    },
    [dragCallback.current, dragRef.current, closeDragElement, elementDrag]
  )

  return Handle ? (
    <div {...props} style={style} ref={dragRef}>
      <div
        onMouseDown={dragMouseDown}
        style={{ cursor: 'move', display: 'contents' }}
      >
        {Handle}
      </div>
      {children}
    </div>
  ) : (
    <div
      ref={dragRef}
      children={children}
      {...props}
      onMouseDown={dragMouseDown}
      style={style}
    />
  )
}

function clamp(target: number, min: number, max: number) {
  return Math.min(max, Math.max(min, target))
}

export default Draggable

function sideToCSSStyles(side: Side): CSSProperties {
  return {
    display: 'flex',
    flexDirection:
      side === 'top' || side === 'bottom'
        ? `column${side === 'bottom' ? '-reverse' : ''}`
        : `row${side === 'right' ? '-reverse' : ''}`,
    alignItems: 'stretch',
  }
}
