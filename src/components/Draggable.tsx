import type {
  CSSProperties,
  HTMLProps,
  MouseEventHandler,
  ReactNode,
  RefObject,
} from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

interface DraggableProps extends HTMLProps<HTMLDivElement> {
  containerRef?: RefObject<HTMLElement | null>
  Handle?: ReactNode
  side?: Side
}

type Side = 'top' | 'right' | 'bottom' | 'left'
type Offset = {
  top: number
  left: number
  margin: {
    blockStart: number
    blockEnd: number
    inlineStart: number
    inlineEnd: number
  }
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
  const targetRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef<Offset>(null)
  const dragCallback = useRef<((e: MouseEvent) => void) | undefined>(undefined)
  const dragRemoveCallback = useRef<((u: unknown) => void) | undefined>(
    undefined
  )

  const onContainerResize = useCallback((entries: ResizeObserverEntry[]) => {
    debugger
    if (targetRef.current && offsetRef.current && entries.length === 1) {
      const computedStyles = getComputedStyle(targetRef.current)
      const position = computedStyles['position']

      if (position === 'fixed') {
        const targetRect = targetRef.current.getBoundingClientRect()
        const containerRect = entries[0].contentRect

        const top = clamp(
          targetRect.top,
          containerRect.top - offsetRef.current.margin.blockStart,
          containerRect.bottom -
            targetRect.height -
            offsetRef.current.margin.blockEnd
        )
        const left = clamp(
          targetRect.left,
          containerRect.left - offsetRef.current.margin.inlineStart,
          containerRect.right -
            targetRect.width -
            offsetRef.current.margin.inlineEnd
        )

        targetRef.current.style.setProperty('top', top.toString().concat('px'))
        targetRef.current.style.setProperty(
          'left',
          left.toString().concat('px')
        )
      }
    }
  }, [])

  useEffect(() => {
    const observer = new ResizeObserver(onContainerResize)

    const container = containerRef?.current ?? window.document.documentElement
    observer.observe(container)

    return () => observer.unobserve(container)
  }, [onContainerResize])

  const elementDrag = useCallback(
    (offset: Offset) => (e: MouseEvent) => {
      e.preventDefault()
      if (!targetRef.current) {
        return
      }
      const container = containerRef?.current ?? window.document.body

      // set the element's new position:
      const containerBox = container.getBoundingClientRect()
      const targetBox = targetRef.current.getBoundingClientRect()
      const targetTop = e.clientY - offset.top - offset.margin.blockStart
      const targetLeft = e.clientX - offset.left - offset.margin.inlineStart
      const top = clamp(
        targetTop,
        containerBox.top - offset.margin.blockStart,
        containerBox.bottom - targetBox.height - offset.margin.blockEnd
      )
      const left = clamp(
        targetLeft,
        containerBox.left - offset.margin.inlineStart,
        containerBox.right - targetBox.width - offset.margin.inlineEnd
      )
      targetRef.current.style.top = top + 'px'
      targetRef.current.style.left = left + 'px'
    },
    [containerRef]
  )

  const closeDragElement = useCallback(() => {
    // stop moving when mouse button is released:
    document.removeEventListener('mouseup', closeDragElement)
    if (dragCallback.current) {
      document.removeEventListener('mousemove', dragCallback.current)
    }
    if (dragRemoveCallback.current) {
      document.addEventListener('visibilitychange', dragRemoveCallback.current)
      document.addEventListener('mouseleave', dragRemoveCallback.current)
    }
  }, [])

  const dragMouseDown: MouseEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      e.preventDefault()

      if (!targetRef.current) {
        return
      }
      const { width, height, top, left } =
        targetRef.current.getBoundingClientRect()
      const computedStyles = getComputedStyle(targetRef.current)
      const pxStyleToNumber = (property: keyof CSSStyleDeclaration) =>
        Number(
          typeof computedStyles[property] === 'string' &&
            computedStyles[property].replace('px', '')
        ) ?? 0
      const margin = {
        blockStart: pxStyleToNumber('marginBlockStart'),
        blockEnd: pxStyleToNumber('marginBlockEnd'),
        inlineStart: pxStyleToNumber('marginInlineStart'),
        inlineEnd: pxStyleToNumber('marginInlineEnd'),
      }
      targetRef.current.style.position = 'fixed'
      targetRef.current.style.top = (top - margin.blockStart)
        .toString()
        .concat('px')
      targetRef.current.style.left = (left - margin.inlineStart)
        .toString()
        .concat('px')
      targetRef.current.style.width = width + 'px'
      targetRef.current.style.height = height + 'px'

      // get the mouse cursor position at startup:
      document.addEventListener('mouseup', closeDragElement)
      // call a function whenever the cursor moves:
      offsetRef.current = {
        top: e.nativeEvent.offsetY,
        left: e.nativeEvent.offsetX,
        margin,
      }
      const onDrag = elementDrag(offsetRef.current)
      // Save a ref to the callback so we can remove the event listener on mouseup
      dragCallback.current = onDrag
      document.addEventListener('mousemove', onDrag)
      dragRemoveCallback.current = () => {
        document.removeEventListener('mousemove', onDrag)
      }
      document.addEventListener('visibilitychange', dragRemoveCallback.current)
      document.addEventListener('mouseleave', dragRemoveCallback.current)
    },
    [closeDragElement, elementDrag]
  )

  return Handle ? (
    <div {...props} style={style} ref={targetRef}>
      <div // eslint-disable-line jsx-a11y/no-static-element-interactions
        onMouseDown={dragMouseDown}
        style={{ cursor: 'move', display: 'contents' }}
      >
        {Handle}
      </div>
      {children}
    </div>
  ) : (
    <div // eslint-disable-line jsx-a11y/no-static-element-interactions
      ref={targetRef}
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
