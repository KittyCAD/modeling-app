import { packTrimTriangles } from '@src/clientSideScene/webgpuTrim'
import { describe, expect, it } from 'vitest'

describe('packTrimTriangles', () => {
  it('packs each trim loop as the same triangle fan used by the engine shader', () => {
    const packed = packTrimTriangles([
      {
        trimLoops: [
          {
            positions: [0, 0, 1, 0, 1, 1, 0, 1],
          },
        ],
      },
    ])

    expect(Array.from(packed.values)).toEqual([
      0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0,
    ])
    expect(packed.ranges).toEqual([
      {
        triangleOffset: 0,
        triangleCount: 2,
      },
    ])
  })

  it('records primitive ranges in the shared triangle buffer', () => {
    const packed = packTrimTriangles([
      {
        trimLoops: [{ positions: [0, 0, 1, 0, 0, 1] }],
      },
      {
        trimLoops: [
          { positions: [0, 0, 1, 0, 1, 1, 0, 1] },
          { positions: [0.25, 0.25, 0.75, 0.25, 0.5, 0.75] },
        ],
      },
      {
        trimLoops: [],
      },
    ])

    expect(packed.ranges).toEqual([
      { triangleOffset: 0, triangleCount: 1 },
      { triangleOffset: 1, triangleCount: 3 },
      { triangleOffset: 4, triangleCount: 0 },
    ])
    expect(packed.values).toHaveLength(4 * 8)
  })
})
