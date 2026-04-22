import { DISTANCE_CONSTRAINT_ARROW } from '@src/clientSideScene/sceneConstants'
import { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import { BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
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
