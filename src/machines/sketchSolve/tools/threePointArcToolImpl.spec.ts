import { describe, expect, it, vi } from 'vitest'

vi.mock('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib', () => ({
  calculate_circle_from_3_points: () => ({
    center_x: 1,
    center_y: 0,
    radius: 1,
  }),
}))

import {
  addDraftPointActor,
  finalizeArcActor,
} from '@src/machines/sketchSolve/tools/threePointArcToolImpl'
import {
  createArcApiObject,
  createMockKclManager,
  createMockRustContext,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

describe('threePointArcToolImpl', () => {
  describe('addDraftPointActor', () => {
    it('adds a coincident constraint when the draft point is snapped', async () => {
      const rustContext = createMockRustContext()
      const kclManager = createMockKclManager()
      ;(rustContext.addSegment as any).mockResolvedValue({
        kclSource: { text: 'point' },
        sceneGraphDelta: createSceneGraphDelta(
          [createPointApiObject({ id: 1, x: 10, y: 20 })],
          [1]
        ),
      })
      ;(rustContext.addConstraint as any).mockResolvedValue({
        kclSource: { text: 'snap' },
        sceneGraphDelta: createSceneGraphDelta([], [10]),
      })

      const result = await addDraftPointActor({
        input: {
          point: [10, 20],
          snapTarget: { type: 'origin' },
          rustContext,
          kclManager,
          sketchId: 7,
        },
      })

      expect(rustContext.addConstraint).toHaveBeenCalledWith(
        0,
        7,
        {
          type: 'Coincident',
          segments: [1, 'ORIGIN'],
        },
        expect.anything()
      )
      expect(result).toEqual({
        kclSource: { text: 'snap' },
        sceneGraphDelta: {
          ...createSceneGraphDelta([], [10]),
          new_objects: [1, 10],
        },
        pointId: 1,
        point: [10, 20],
      })
    })
  })

  describe('finalizeArcActor', () => {
    it('adds a coincident constraint for the snapped end point before cleanup', async () => {
      const rustContext = createMockRustContext()
      const kclManager = createMockKclManager()
      const center = createPointApiObject({ id: 4, x: 1, y: 0 })
      const arcStart = createPointApiObject({ id: 5, x: 0, y: 0 })
      const arcEnd = createPointApiObject({ id: 6, x: 2, y: 0 })
      const arc = createArcApiObject({ id: 7, center: 4, start: 5, end: 6 })
      ;(rustContext.editSegments as any).mockResolvedValue({
        kclSource: { text: 'edit' },
        sceneGraphDelta: createSceneGraphDelta(
          [center, arcStart, arcEnd, arc],
          [7]
        ),
      })
      ;(rustContext.addConstraint as any)
        .mockResolvedValueOnce({
          kclSource: { text: 'snap' },
          sceneGraphDelta: createSceneGraphDelta([], [10]),
        })
        .mockResolvedValueOnce({
          kclSource: { text: 'through' },
          sceneGraphDelta: createSceneGraphDelta([], [11]),
        })
      ;(rustContext.deleteObjects as any).mockResolvedValue({
        kclSource: { text: 'delete' },
        sceneGraphDelta: createSceneGraphDelta([], [12]),
      })

      const result = await finalizeArcActor({
        input: {
          arcId: 7,
          startPoint: [0, 0],
          startPointId: 1,
          throughPoint: [1, 1],
          throughPointId: 2,
          endPoint: [2, 0],
          endSnapTarget: { type: 'point', pointId: 99 },
          rustContext,
          kclManager,
          sketchId: 7,
        },
      })

      expect(rustContext.addConstraint).toHaveBeenNthCalledWith(
        1,
        0,
        7,
        {
          type: 'Coincident',
          segments: [5, 99],
        },
        expect.anything()
      )
      expect(rustContext.addConstraint).toHaveBeenNthCalledWith(
        2,
        0,
        7,
        {
          type: 'Coincident',
          segments: [2, 7],
        },
        expect.anything()
      )
      expect(result).toEqual({
        kclSource: { text: 'delete' },
        sceneGraphDelta: {
          ...createSceneGraphDelta([], [12]),
          new_objects: [7, 10, 11, 12],
        },
      })
    })
  })
})
