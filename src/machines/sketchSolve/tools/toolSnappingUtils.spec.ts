import { describe, expect, it } from 'vitest'

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { getBestSnappingCandidate } from '@src/machines/sketchSolve/tools/toolSnappingUtils'
import {
  createLineApiObject,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createSketchApiObject({ id }: { id: number }): ApiObject {
  return {
    id,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      constraints: [3],
      plane: 8,
      segments: [0, 1, 2],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  } satisfies ApiObject
}

describe('toolSnappingUtils', () => {
  it('skips the excluded point owner segment and falls through to another segment target', () => {
    const draftStart = createPointApiObject({ id: 1, x: 20, y: 50, owner: 3 })
    const draftEnd = createPointApiObject({ id: 2, x: 30, y: 50, owner: 3 })
    const draftLine = createLineApiObject({ id: 3, start: 1, end: 2 })
    const otherStart = createPointApiObject({ id: 4, x: 32, y: 30, owner: 6 })
    const otherEnd = createPointApiObject({ id: 5, x: 32, y: 70, owner: 6 })
    const otherLine = createLineApiObject({ id: 6, start: 4, end: 5 })
    const sceneGraphDelta = createSceneGraphDelta([
      createSketchApiObject({ id: 0 }),
      draftStart,
      draftEnd,
      draftLine,
      otherStart,
      otherEnd,
      otherLine,
    ])

    const candidate = getBestSnappingCandidate({
      self: {
        _parent: {
          getSnapshot: () => ({
            context: {
              sketchExecOutcome: {
                sceneGraphDelta,
              },
            },
          }),
        },
      },
      sceneInfra: createMockSceneInfra(),
      sketchId: 0,
      mousePosition: [30, 55],
      mouseEvent: new MouseEvent('mousemove'),
      excludedPointIds: [2],
    })

    expect(candidate?.target).toEqual({ type: 'line', lineId: 6 })
    expect(candidate?.position).toEqual([32, 55])
  })
})
