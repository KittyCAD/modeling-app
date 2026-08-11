import { InfiniteGridRenderer } from '@src/clientSideScene/InfiniteGridRenderer'
import { Group, OrthographicCamera } from 'three'
import { describe, expect, it } from 'vitest'

describe('InfiniteGridRenderer', () => {
  it('anchors grid lines to its parent sketch origin', () => {
    const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)

    const sketchGroup = new Group()
    sketchGroup.position.set(0.25, 0, 0)
    const grid = new InfiniteGridRenderer()
    sketchGroup.add(grid)

    grid.update(camera, [1_000, 1_000], 100, 1, {
      majorGridSpacing: 1,
      minorGridsPerMajor: 4,
      majorColor: [0.3, 0.3, 0.3, 1],
      minorColor: [0.2, 0.2, 0.2, 1],
      fixedSizeGrid: true,
    })

    const lineOffset = grid.material.uniforms.lineOffsetNDC.value as [
      number,
      number,
    ]
    expect(lineOffset[0]).toBeCloseTo(-1.15)
    expect(lineOffset[1]).toBeCloseTo(-1)
  })
})
