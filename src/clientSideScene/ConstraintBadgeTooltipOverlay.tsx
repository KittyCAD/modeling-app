import { CANVAS_DRAG_THRESHOLD_PX } from '@src/clientSideScene/sceneConstants'
import { constraintIconPaths } from '@src/components/constraintIconPaths'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useRichTooltipContent } from '@src/hooks/useRichTooltipContent'
import {
  type ConstraintBadgeTooltipBounds,
  type ConstraintBadgeTooltipPoint,
  getConstraintBadgeTooltipPosition,
} from '@src/machines/sketchSolve/constraints/constraintBadgeTooltip'
import { invisibleConstraintMetadata } from '@src/machines/sketchSolve/constraints/constraintMetadata'
import {
  type InvisibleConstraint,
  isInvisibleConstraintObject,
} from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import { useSelector } from '@xstate/react'
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { SnapshotFrom } from 'xstate'

type PointerState = {
  point: ConstraintBadgeTooltipPoint
  bounds: ConstraintBadgeTooltipBounds
}

type HoveredInvisibleConstraint = {
  id: number
  type: InvisibleConstraint['type']
}

export function ConstraintBadgeTooltipOverlay({
  containerRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>
}) {
  const { state } = useModelingContext()
  const hoveredConstraint = useSelector(
    state.children.sketchSolveMachine,
    selectHoveredInvisibleConstraint,
    areHoveredConstraintsEqual
  )
  const constraintType = hoveredConstraint?.type ?? null
  const hoveredConstraintKey = hoveredConstraint
    ? `${hoveredConstraint.id}:${hoveredConstraint.type}`
    : null
  const [pointerState, setPointerState] = useState<PointerState | null>(null)
  const { showRichContent, handleMouseEnter, handleMouseLeave } =
    useRichTooltipContent()
  const [tooltipPosition, setTooltipPosition] =
    useState<ConstraintBadgeTooltipPoint | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const latestPointerStateRef = useRef<PointerState | null>(null)
  const constraintTypeRef = useRef(constraintType)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    let containerBounds = getElementBounds(container)
    let pointerDownPoint: ConstraintBadgeTooltipPoint | null = null
    let pointerWasDragged = false

    const clearPointer = () => {
      latestPointerStateRef.current = null
      setPointerState(null)
    }
    const updatePointer = (event: MouseEvent) => {
      if (event.buttons !== 0) {
        if (pointerDownPoint) {
          const deltaX = event.clientX - pointerDownPoint.x
          const deltaY = event.clientY - pointerDownPoint.y
          pointerWasDragged ||=
            deltaX * deltaX + deltaY * deltaY >=
            CANVAS_DRAG_THRESHOLD_PX * CANVAS_DRAG_THRESHOLD_PX
        }
        clearPointer()
        return
      }

      const nextPointerState = {
        point: { x: event.clientX, y: event.clientY },
        bounds: containerBounds,
      }
      latestPointerStateRef.current = nextPointerState
      if (constraintTypeRef.current) {
        setPointerState(nextPointerState)
      }
    }
    const handlePointerDown = (event: MouseEvent) => {
      pointerDownPoint = { x: event.clientX, y: event.clientY }
      pointerWasDragged = false
      clearPointer()
    }
    const handlePointerUp = (event: MouseEvent) => {
      const shouldRestorePointer =
        pointerDownPoint !== null && !pointerWasDragged
      pointerDownPoint = null
      pointerWasDragged = false
      if (shouldRestorePointer) {
        updatePointer(event)
      }
    }
    const handlePointerLeave = () => {
      pointerDownPoint = null
      pointerWasDragged = false
      clearPointer()
    }
    const updateBounds = () => {
      containerBounds = getElementBounds(container)
      const latestPointerState = latestPointerStateRef.current
      if (!latestPointerState) {
        return
      }

      const nextPointerState = {
        point: latestPointerState.point,
        bounds: containerBounds,
      }
      latestPointerStateRef.current = nextPointerState
      if (constraintTypeRef.current) {
        setPointerState(nextPointerState)
      }
    }
    const resizeObserver = new ResizeObserver(updateBounds)
    resizeObserver.observe(container)

    container.addEventListener('mousemove', updatePointer)
    container.addEventListener('mouseleave', handlePointerLeave)
    container.addEventListener('mousedown', handlePointerDown)
    container.addEventListener('mouseup', handlePointerUp)
    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('mousemove', updatePointer)
      container.removeEventListener('mouseleave', handlePointerLeave)
      container.removeEventListener('mousedown', handlePointerDown)
      container.removeEventListener('mouseup', handlePointerUp)
    }
  }, [containerRef])

  useLayoutEffect(() => {
    constraintTypeRef.current =
      hoveredConstraintKey === null ? null : constraintType
    setPointerState(
      hoveredConstraintKey === null ? null : latestPointerStateRef.current
    )
  }, [constraintType, hoveredConstraintKey])

  const activeTooltipKey = pointerState ? hoveredConstraintKey : null
  useLayoutEffect(() => {
    if (activeTooltipKey === null) {
      return
    }

    handleMouseEnter()
    return handleMouseLeave
  }, [activeTooltipKey, handleMouseEnter, handleMouseLeave])

  const tooltipVariant = showRichContent ? 'rich' : 'compact'

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    if (!tooltip || !pointerState || !constraintType) {
      setTooltipPosition(null)
      return
    }
    if (tooltip.dataset.variant !== tooltipVariant) {
      return
    }

    const tooltipRect = tooltip.getBoundingClientRect()
    const nextPosition = getConstraintBadgeTooltipPosition({
      pointer: pointerState.point,
      tooltipSize: {
        width: tooltipRect.width,
        height: tooltipRect.height,
      },
      bounds: pointerState.bounds,
    })
    setTooltipPosition((currentPosition) =>
      currentPosition?.x === nextPosition.x &&
      currentPosition.y === nextPosition.y
        ? currentPosition
        : nextPosition
    )
  }, [constraintType, pointerState, tooltipVariant])

  if (!constraintType || !pointerState) {
    return null
  }

  const content = invisibleConstraintMetadata[constraintType]
  const maxWidth = Math.max(
    0,
    pointerState.bounds.right - pointerState.bounds.left - 16
  )

  return (
    <div
      ref={tooltipRef}
      role="tooltip"
      data-testid="constraint-badge-tooltip"
      data-variant={tooltipVariant}
      className={`fixed pointer-events-none z-[9999] overflow-hidden rounded-sm border border-chalkboard-20/50 bg-chalkboard-10 text-chalkboard-110 shadow-lg dark:border-chalkboard-80/50 dark:bg-chalkboard-90 dark:text-chalkboard-10 ${
        showRichContent ? 'w-72' : 'w-max'
      }`}
      style={{
        left: tooltipPosition?.x ?? pointerState.point.x,
        top: tooltipPosition?.y ?? pointerState.point.y,
        maxWidth,
        visibility: tooltipPosition ? 'visible' : 'hidden',
      }}
    >
      {showRichContent ? (
        <>
          <div className="flex items-center gap-2 bg-chalkboard-20/50 px-3 py-2.5 dark:bg-chalkboard-80/50">
            <svg
              aria-hidden="true"
              className="h-5 w-5 flex-none"
              viewBox="0 0 20 20"
            >
              <path
                d={constraintIconPaths[constraintType]}
                fill="currentColor"
              />
            </svg>
            <span className="text-sm">{content.title}</span>
          </div>
          <p className="m-0 px-3 py-2 text-sm leading-5 font-sans">
            {content.description}
          </p>
        </>
      ) : (
        <div className="whitespace-nowrap px-3 py-2 text-sm">
          {content.title}
        </div>
      )}
    </div>
  )
}

function getElementBounds(element: HTMLElement): ConstraintBadgeTooltipBounds {
  const rect = element.getBoundingClientRect()
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  }
}

function selectHoveredInvisibleConstraint(
  snapshot: unknown
): HoveredInvisibleConstraint | null {
  if (!isSketchSolveSnapshot(snapshot)) {
    return null
  }

  const hoveredId = snapshot.context.hoveredId
  if (typeof hoveredId !== 'number') {
    return null
  }

  const objects =
    snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects ?? []
  const hoveredObject = objects[hoveredId]
  if (!isInvisibleConstraintObject(hoveredObject, objects)) {
    return null
  }

  return {
    id: hoveredId,
    type: hoveredObject.kind.constraint.type,
  }
}

function areHoveredConstraintsEqual(
  previous: HoveredInvisibleConstraint | null,
  next: HoveredInvisibleConstraint | null
) {
  return previous?.id === next?.id && previous?.type === next?.type
}

function isSketchSolveSnapshot(
  snapshot: unknown
): snapshot is SnapshotFrom<typeof sketchSolveMachine> {
  return !!(
    snapshot &&
    typeof snapshot === 'object' &&
    'context' in snapshot &&
    snapshot.context &&
    typeof snapshot.context === 'object' &&
    'hoveredId' in snapshot.context &&
    'sketchId' in snapshot.context
  )
}
