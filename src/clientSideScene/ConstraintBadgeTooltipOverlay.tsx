import { constraintIconPaths } from '@src/components/constraintIconPaths'
import { useModelingContext } from '@src/hooks/useModelingContext'
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

export function ConstraintBadgeTooltipOverlay({
  containerRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>
}) {
  const { state } = useModelingContext()
  const constraintType = useSelector(
    state.children.sketchSolveMachine,
    selectHoveredInvisibleConstraintType
  )
  const [pointerState, setPointerState] = useState<PointerState | null>(null)
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

    const clearPointer = () => {
      latestPointerStateRef.current = null
      setPointerState(null)
    }
    const updatePointer = (event: MouseEvent) => {
      if (event.buttons !== 0) {
        clearPointer()
        return
      }

      const containerRect = container.getBoundingClientRect()
      const nextPointerState = {
        point: { x: event.clientX, y: event.clientY },
        bounds: {
          left: containerRect.left,
          top: containerRect.top,
          right: containerRect.right,
          bottom: containerRect.bottom,
        },
      }
      latestPointerStateRef.current = nextPointerState
      if (constraintTypeRef.current) {
        setPointerState(nextPointerState)
      }
    }

    container.addEventListener('mousemove', updatePointer)
    container.addEventListener('mouseleave', clearPointer)
    container.addEventListener('mousedown', clearPointer)
    container.addEventListener('mouseup', updatePointer)
    return () => {
      container.removeEventListener('mousemove', updatePointer)
      container.removeEventListener('mouseleave', clearPointer)
      container.removeEventListener('mousedown', clearPointer)
      container.removeEventListener('mouseup', updatePointer)
    }
  }, [containerRef])

  useLayoutEffect(() => {
    constraintTypeRef.current = constraintType
    setPointerState(constraintType ? latestPointerStateRef.current : null)
  }, [constraintType])

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    if (!tooltip || !pointerState || !constraintType) {
      setTooltipPosition(null)
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
  }, [constraintType, pointerState])

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
      className="fixed pointer-events-none z-[9999] w-72 overflow-hidden rounded-sm border border-chalkboard-20/50 bg-chalkboard-10 text-chalkboard-110 shadow-lg dark:border-chalkboard-80/50 dark:bg-chalkboard-90 dark:text-chalkboard-10"
      style={{
        left: tooltipPosition?.x ?? pointerState.point.x,
        top: tooltipPosition?.y ?? pointerState.point.y,
        maxWidth,
        visibility: tooltipPosition ? 'visible' : 'hidden',
      }}
    >
      <div className="flex items-center gap-2 bg-chalkboard-20/50 px-3 py-2.5 dark:bg-chalkboard-80/50">
        <svg
          aria-hidden="true"
          className="h-5 w-5 flex-none"
          viewBox="0 0 20 20"
        >
          <path d={constraintIconPaths[constraintType]} fill="currentColor" />
        </svg>
        <span className="text-sm">{content.title}</span>
      </div>
      <p className="m-0 px-3 py-2 text-sm leading-5 font-sans">
        {content.description}
      </p>
    </div>
  )
}

function selectHoveredInvisibleConstraintType(
  snapshot: unknown
): InvisibleConstraint['type'] | null {
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
  return isInvisibleConstraintObject(hoveredObject, objects)
    ? hoveredObject.kind.constraint.type
    : null
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
