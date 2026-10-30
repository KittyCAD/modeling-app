import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { selectedSketch3d } from '@src/lib/sketch3dMode'
import { describe, expect, it } from 'vitest'

describe('spatial sketch edit routing', () => {
  const code = '// π\ns = sketch3d() {}'
  const sketch: ApiObject = {
    id: 7,
    label: 's',
    comments: '',
    artifact_id: '00000000-0000-0000-0000-000000000007',
    kind: {
      type: 'Sketch3d',
      segments: [],
      constraints: [],
      degrees_of_freedom: 0,
    },
    source: {
      type: 'Simple',
      range: [10, new TextEncoder().encode(code).length, 0],
      node_path: null,
    },
  }
  const selection = (range: [number, number, number]): Selections => ({
    graphSelections: [{ codeRef: { range, pathToNode: [] } }],
    otherSelections: [],
  })

  it('routes a cursor inside a spatial block using UTF-16 editor positions', () => {
    expect(selectedSketch3d([sketch], code, selection([9, 9, 0]))).toBe(sketch)
    expect(
      selectedSketch3d([sketch], code, selection([0, 0, 0]))
    ).toBeUndefined()
    expect(
      selectedSketch3d([sketch], code, selection([9, 9, 1]))
    ).toBeUndefined()
  })

  it('routes a selected spatial artifact without requiring a supporting plane', () => {
    const selections = {
      graphSelections: [{ artifact: { type: 'sketchBlock', sketchId: 7 } }],
      otherSelections: [],
    } as unknown as Selections
    expect(selectedSketch3d([sketch], code, selections)).toBe(sketch)
    expect(selectedSketch3d(undefined, code, selections)).toBeUndefined()
  })
})
