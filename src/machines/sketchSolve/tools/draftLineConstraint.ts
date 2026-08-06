import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  getAxisConstraintLineId,
  isConstraint,
  isLineSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'

export type DraftEntities = {
  segmentIds: Array<number>
  constraintIds: Array<number>
}

type OrientationConstraint = Extract<
  ApiConstraint,
  { type: 'Horizontal' | 'Vertical' }
>

/**
 * What to do when the user hits the horizontal/vertical constraint hotkey
 * while rubber-banding a draft line. `deleteConstraintIds` removes a
 * previously applied orientation constraint (swap, or toggle off when
 * `constraint` is null), and `constraint` is the new one to add.
 */
export type DraftLineConstraintPlan = {
  deleteConstraintIds: Array<number>
  constraint: OrientationConstraint | null
}

/**
 * Builds the plan for constraining the in-progress draft line, or returns
 * null when the request doesn't apply (not an orientation constraint tool,
 * or no draft line is being drawn) and normal tool switching should happen.
 */
export function buildDraftLineConstraintPlan(
  toolName: string,
  draftEntities: DraftEntities | undefined,
  objects: readonly ApiObject[]
): DraftLineConstraintPlan | null {
  const orientation =
    toolName === 'horizontalConstraintTool'
      ? ('Horizontal' as const)
      : toolName === 'verticalConstraintTool'
        ? ('Vertical' as const)
        : null
  if (orientation === null || draftEntities === undefined) {
    return null
  }

  const draftLineId = draftEntities.segmentIds.find((id) =>
    isLineSegment(objects[id])
  )
  if (draftLineId === undefined) {
    return null
  }

  // Find orientation constraints already applied to the draft line so
  // repeated hotkey presses toggle/swap instead of over-constraining.
  let sameOrientationId: number | undefined
  let otherOrientationId: number | undefined
  objects.forEach((obj, id) => {
    if (!isConstraint(obj)) {
      return
    }
    const constraint = obj.kind.constraint
    if (constraint.type !== 'Horizontal' && constraint.type !== 'Vertical') {
      return
    }
    if (getAxisConstraintLineId(constraint) !== draftLineId) {
      return
    }
    if (constraint.type === orientation) {
      sameOrientationId = id
    } else {
      otherOrientationId = id
    }
  })

  // Same constraint selected again -> remove it
  if (sameOrientationId !== undefined) {
    return { deleteConstraintIds: [sameOrientationId], constraint: null }
  }

  // Other constraint selected -> remove existing one and add this one
  return {
    deleteConstraintIds:
      otherOrientationId !== undefined ? [otherOrientationId] : [],
    constraint:
      orientation === 'Horizontal'
        ? { type: 'Horizontal', line: draftLineId }
        : { type: 'Vertical', line: draftLineId },
  }
}
