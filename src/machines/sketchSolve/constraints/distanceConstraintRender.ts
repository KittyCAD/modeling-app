import type { ConstraintLineStyle } from '@src/machines/sketchSolve/constraints/ConstraintResources'

export type DistanceConstraintRenderInput = {
  kind: {
    constraint: {
      type: 'Distance' | 'HorizontalDistance' | 'VerticalDistance'
      distance: {
        value: number
      }
    }
  }
}

export function getDistanceConstraintLineStyle(
  obj: DistanceConstraintRenderInput
): ConstraintLineStyle {
  return shouldRenderDistanceConstraintDashed(obj) ? 'dashed' : 'solid'
}

export function shouldRenderDistanceConstraintDashed(
  obj: DistanceConstraintRenderInput
) {
  return (
    obj.kind.constraint.distance.value === 0 &&
    (obj.kind.constraint.type === 'HorizontalDistance' ||
      obj.kind.constraint.type === 'VerticalDistance')
  )
}
