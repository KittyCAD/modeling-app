import type {
  CSSProperties,
  HTMLProps,
  MouseEventHandler,
  ReactNode,
  RefObject,
} from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

export interface DraggableProps extends HTMLProps<HTMLDivElement> {
  containerRef?: RefObject<HTMLElement | null>
  Handle?: ReactNode
  side?: DraggableSide
  /** If true, pin the element into container bounds immediately on mount. */
  startInContainer?: boolean
}

export type DraggableSide = 'top' | 'right' | 'bottom' | 'left'

interface Offset {
  top: number
  left: number
  margin: {
    blockStart: number
    blockEnd: number
    inlineStart: number
    inlineEnd: number
  }
}

export function Draggable({
  containerRef,
  Handle,
  side: providedSide,
  startInContainer = false,
  style: providedStyle,
  children,
  ...props
}: DraggableProps) {
  const style = useMemo(
    () =>
      Object.assign({}, providedStyle, sideToCSSStyles(providedSide ?? 'top'), {
        boxSizing: 'border-box',
        cursor: Handle === undefined ? 'move' : undefined,
      }),
    [providedSide, providedStyle, Handle]
  )
  const targetRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef<Offset | null>(null)
  const dragCallback = useRef<((e: MouseEvent) => void) | undefined>(undefined)
  const dragRemoveCallback = useRef<((u: unknown) => void) | undefined>(
    undefined
  )

  const parseMargins = useCallback((computedStyles: CSSStyleDeclaration) => {
    const pxStyleToNumber = (property: keyof CSSStyleDeclaration) =>
      Number(
        typeof computedStyles[property] === 'string' &&
          computedStyles[property].replace('px', '')
      ) || 0
    return {
      blockStart: pxStyleToNumber('marginBlockStart'),
      blockEnd: pxStyleToNumber('marginBlockEnd'),
      inlineStart: pxStyleToNumber('marginInlineStart'),
      inlineEnd: pxStyleToNumber('marginInlineEnd'),
    }
  }, [])

  const pinIntoContainer = useCallback(() => {
    if (!startInContainer || !targetRef.current || !containerRef?.current) {
      return
    }

    const computedStyles = getComputedStyle(targetRef.current)
    if (computedStyles.position === 'fixed') {
      return
    }

    const targetRect = targetRef.current.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    const margin = parseMargins(computedStyles)

    const top = clamp(
      targetRect.top,
      containerRect.top - margin.blockStart,
      containerRect.bottom - targetRect.height - margin.blockEnd
    )
    const left = clamp(
      targetRect.left,
      containerRect.left - margin.inlineStart,
      containerRect.right - targetRect.width - margin.inlineEnd
    )

    targetRef.current.style.position = 'fixed'
    targetRef.current.style.top = `${top}px`
    targetRef.current.style.left = `${left}px`
    targetRef.current.style.width = `${targetRect.width}px`
    targetRef.current.style.height = `${targetRect.height}px`
  }, [containerRef, parseMargins, startInContainer])

  const onContainerResize = useCallback((entries: ResizeObserverEntry[]) => {
    if (!targetRef.current || !offsetRef.current || entries.length !== 1) {
      return
    }

    const computedStyles = getComputedStyle(targetRef.current)
    const position = computedStyles.position

    if (position !== 'fixed') {
      return
    }

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

    targetRef.current.style.setProperty('top', `${top}px`)
    targetRef.current.style.setProperty('left', `${left}px`)
  }, [])

  useEffect(() => {
    const observer = new ResizeObserver(onContainerResize)
    const container = containerRef?.current ?? window.document.documentElement
    observer.observe(container)

    return () => observer.unobserve(container)
  }, [containerRef, onContainerResize])

  useEffect(() => {
    if (!startInContainer) return

    if (containerRef?.current) {
      pinIntoContainer()
      return
    }

    let attempts = 0
    let rafId = 0
    const maxAttempts = 8

    const tryPin = () => {
      pinIntoContainer()
      if (!containerRef?.current && attempts < maxAttempts) {
        attempts += 1
        rafId = requestAnimationFrame(tryPin)
      }
    }

    rafId = requestAnimationFrame(tryPin)
    return () => cancelAnimationFrame(rafId)
  }, [containerRef, pinIntoContainer, startInContainer])

  const elementDrag = useCallback(
    (offset: Offset) => (e: MouseEvent) => {
      e.preventDefault()
      if (!targetRef.current) {
        return
      }

      const container = containerRef?.current ?? window.document.body
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

      targetRef.current.style.top = `${top}px`
      targetRef.current.style.left = `${left}px`
    },
    [containerRef]
  )

  const closeDragElement = useCallback(() => {
    document.removeEventListener('mouseup', closeDragElement)

    if (dragCallback.current) {
      document.removeEventListener('mousemove', dragCallback.current)
      dragCallback.current = undefined
    }

    if (dragRemoveCallback.current) {
      document.removeEventListener(
        'visibilitychange',
        dragRemoveCallback.current
      )
      document.removeEventListener('mouseleave', dragRemoveCallback.current)
      dragRemoveCallback.current = undefined
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
      const margin = parseMargins(computedStyles)

      targetRef.current.style.position = 'fixed'
      targetRef.current.style.top = `${top - margin.blockStart}px`
      targetRef.current.style.left = `${left - margin.inlineStart}px`
      targetRef.current.style.width = `${width}px`
      targetRef.current.style.height = `${height}px`

      document.addEventListener('mouseup', closeDragElement)
      offsetRef.current = {
        top: e.nativeEvent.offsetY,
        left: e.nativeEvent.offsetX,
        margin,
      }

      const onDrag = elementDrag(offsetRef.current)
      dragCallback.current = onDrag
      document.addEventListener('mousemove', onDrag)

      dragRemoveCallback.current = () => {
        document.removeEventListener('mousemove', onDrag)
        dragCallback.current = undefined
      }
      document.addEventListener('visibilitychange', dragRemoveCallback.current)
      document.addEventListener('mouseleave', dragRemoveCallback.current)
    },
    [closeDragElement, elementDrag, parseMargins]
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

function sideToCSSStyles(side: DraggableSide): CSSProperties {
  return {
    display: 'flex',
    flexDirection:
      side === 'top' || side === 'bottom'
        ? `column${side === 'bottom' ? '-reverse' : ''}`
        : `row${side === 'right' ? '-reverse' : ''}`,
    alignItems: 'stretch',
  }
}
