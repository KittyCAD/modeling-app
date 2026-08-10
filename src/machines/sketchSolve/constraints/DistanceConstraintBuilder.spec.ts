import { DISTANCE_CONSTRAINT_ARROW } from '@src/clientSideScene/sceneConstants'
import { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import { getLineGuideSegment } from '@src/machines/sketchSolve/constraints/DistanceConstraintBuilder'
import { BufferGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { describe, expect, it } from 'vitest'

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

describe('getLineGuideSegment', () => {
  const line = {
    start: new Vector3(0, 0, 0),
    end: new Vector3(10, 0, 0),
  }

  it('does not extend a line that reaches the distance endpoint', () => {
    expect(getLineGuideSegment(line, new Vector3(5, 0, 0))).toBeUndefined()
  })

  it('extends from the start when the distance endpoint precedes the line', () => {
    expect(getLineGuideSegment(line, new Vector3(-5, 0, 0))).toEqual([
      line.start,
      new Vector3(-5, 0, 0),
    ])
  })

  it('extends from the end when the distance endpoint follows the line', () => {
    expect(getLineGuideSegment(line, new Vector3(15, 0, 0))).toEqual([
      line.end,
      new Vector3(15, 0, 0),
    ])
  })
})
