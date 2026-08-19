import { InfiniteGridRenderer } from '@src/clientSideScene/InfiniteGridRenderer'
import { Group, OrthographicCamera } from 'three'
import { describe, expect, it } from 'vitest'

describe('InfiniteGridRenderer', () => {
  it('anchors grid lines to its parent sketch origin', () => {
    const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)

    const sketchGroup = new Group()
    const grid = new InfiniteGridRenderer()
    sketchGroup.add(grid)
    const gridOptions = {
      majorGridSpacing: 1,
      minorGridsPerMajor: 4,
      majorColor: [0.3, 0.3, 0.3, 1] as [number, number, number, number],
      minorColor: [0.2, 0.2, 0.2, 1] as [number, number, number, number],
      fixedSizeGrid: true,
    }

    grid.update(camera, [1_000, 1_000], 100, 1, gridOptions)

    const initialLineOffset = grid.material.uniforms.lineOffsetNDC.value as [
      number,
      number,
    ]

    sketchGroup.position.set(0.25, 0, 0)
    grid.update(camera, [1_000, 1_000], 100, 1, gridOptions)

    const movedLineOffset = grid.material.uniforms.lineOffsetNDC.value as [
      number,
      number,
    ]
    expect(movedLineOffset[0]).not.toBeCloseTo(initialLineOffset[0])
    expect(movedLineOffset[1]).toBeCloseTo(initialLineOffset[1])
  })
})
