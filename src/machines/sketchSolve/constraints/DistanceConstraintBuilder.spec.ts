import { DISTANCE_CONSTRAINT_ARROW } from '@src/clientSideScene/sceneConstants'
import { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  type DistanceConstraintRenderInput,
  getDistanceConstraintLineStyle,
  shouldRenderDistanceConstraintDashed,
} from '@src/machines/sketchSolve/constraints/distanceConstraintRender'
import { BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { describe, expect, it } from 'vitest'

function createDistanceConstraint({
  type,
  value,
}: {
  type: DistanceConstraintRenderInput['kind']['constraint']['type']
  value: number
}): DistanceConstraintRenderInput {
  return {
    kind: {
      constraint: {
        type,
        distance: { value },
      },
    },
  }
}

describe('shouldRenderDistanceConstraintDashed', () => {
  it('renders zero horizontal and vertical distances as dashed', () => {
    expect(
      shouldRenderDistanceConstraintDashed(
        createDistanceConstraint({ type: 'HorizontalDistance', value: 0 })
      )
    ).toBe(true)
    expect(
      shouldRenderDistanceConstraintDashed(
        createDistanceConstraint({ type: 'VerticalDistance', value: 0 })
      )
    ).toBe(true)
  })

  it('keeps non-zero and generic distance constraints solid', () => {
    expect(
      shouldRenderDistanceConstraintDashed(
        createDistanceConstraint({ type: 'HorizontalDistance', value: 5 })
      )
    ).toBe(false)
    expect(
      shouldRenderDistanceConstraintDashed(
        createDistanceConstraint({ type: 'Distance', value: 0 })
      )
    ).toBe(false)
    expect(
      getDistanceConstraintLineStyle(
        createDistanceConstraint({ type: 'VerticalDistance', value: 5 })
      )
    ).toBe('solid')
  })
})

describe('ConstraintResources.updateConstraintGroup', () => {
  it('swaps constraint line materials between solid and dashed variants', () => {
    const resources = new ConstraintResources()
    const group = new Group()
    const line = new Line2()
    const arrow = new Mesh(new BufferGeometry(), new MeshBasicMaterial())
    arrow.userData.type = DISTANCE_CONSTRAINT_ARROW

    group.add(line)
    group.add(arrow)

    resources.updateConstraintGroup(group, 1, [], null, 'dashed')
    expect((line.material as any).dashed).toBe(true)
    expect((line.material as any).customProgramCacheKey?.()).toBe(
      'construction-dashed-line'
    )

    resources.updateConstraintGroup(group, 1, [], null, 'solid')
    expect((line.material as any).dashed).toBe(false)
  })
})
