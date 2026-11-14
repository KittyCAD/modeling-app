import {
  createDraftCircle,
  commitCircle,
} from '@src/machines/sketchSolve/tools/circleToolImpl'
import {
  createCircleApiObject,
  createMockKclManager,
  createMockRustContext,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it, vi } from 'vitest'
describe('circleToolImpl', () => {
  describe('draft creation and commit', () => {
    it('creates a circle segment using the circle label', async () => {
      const rustContext = createMockRustContext()
      const spiedFn = vi.spyOn(rustContext, 'addSegment')
      const kclManager = createMockKclManager()
      const sceneGraphDelta = createSceneGraphDelta(
        [createCircleApiObject({ id: 3, start: 2 })],
        [3]
      )
      ;(rustContext.addSegment as any).mockResolvedValue({
        kclSource: { text: 'circle' },
        sceneGraphDelta,
      })

      const result = await createDraftCircle({
        input: {
          centerPoint: [10, 20],
          rustContext,
          kclManager,
          sketchId: 7,
        },
      })

      expect(spiedFn).toHaveBeenCalledWith(
        0,
        7,
        {
          type: 'Circle',
          center: {
            x: { type: 'Var', value: 10, units: 'Mm' },
            y: { type: 'Var', value: 20, units: 'Mm' },
          },
          start: {
            x: { type: 'Var', value: 10.1, units: 'Mm' },
            y: { type: 'Var', value: 20, units: 'Mm' },
          },
        },
        'circle',
        expect.any(Object),
        false
      )
      expect(result).toMatchObject({
        kclSource: { text: 'circle' },
        sceneGraphDelta,
      })
    })

    it('adds coincident constraints for snapped center and radius points', async () => {
      const rustContext = createMockRustContext()
      const kclManager = createMockKclManager()
      const addConstraintSpy = vi.spyOn(rustContext, 'addConstraint')
      const centerPoint = createPointApiObject({ id: 1, x: 10, y: 20 })
      const startPoint = createPointApiObject({ id: 2, x: 30, y: 40 })
      const circleObj = createCircleApiObject({ id: 3, center: 1, start: 2 })
      const addSegmentResult = {
        kclSource: { text: 'circle' },
        sceneGraphDelta: createSceneGraphDelta(
          [centerPoint, startPoint, circleObj],
          [1, 2, 3]
        ),
      }
      const centerSnapResult = {
        kclSource: { text: 'center-snap' },
        sceneGraphDelta: createSceneGraphDelta(
          [centerPoint, startPoint, circleObj],
          [10]
        ),
      }
      const startSnapResult = {
        kclSource: { text: 'start-snap' },
        sceneGraphDelta: createSceneGraphDelta(
          [centerPoint, startPoint, circleObj],
          [11]
        ),
      }
      ;(rustContext.addSegment as any).mockResolvedValue(addSegmentResult)
      ;(rustContext.addConstraint as any)
        .mockResolvedValueOnce(centerSnapResult)
        .mockResolvedValueOnce(startSnapResult)

      vi.spyOn(rustContext, 'editSegments').mockResolvedValue({
        kclSource: { text: 'resized' },
        sceneGraphDelta: createSceneGraphDelta([
          centerPoint,
          startPoint,
          circleObj,
        ]),
      })
      const draft = await createDraftCircle({
        input: {
          centerPoint: [10, 20],
          centerSnapTarget: { type: 'origin' },
          rustContext,
          kclManager,
          sketchId: 7,
        },
      })
      expect(draft).not.toHaveProperty('error')
      const result = await commitCircle({
        input: {
          centerPoint: [10, 20],
          startPoint: [30, 40],
          circleId: 3,
          startSnapTarget: { type: 'point', id: 99 },
          rustContext,
          kclManager,
          sketchId: 7,
        },
      })

      expect(addConstraintSpy).toHaveBeenNthCalledWith(
        1,
        0,
        7,
        {
          type: 'Coincident',
          segments: [1, 'ORIGIN'],
        },
        expect.anything()
      )
      expect(addConstraintSpy).toHaveBeenNthCalledWith(
        2,
        0,
        7,
        {
          type: 'Coincident',
          segments: [2, 99],
        },
        expect.anything(),
        true
      )
      expect(result).toEqual({
        kclSource: { text: 'start-snap' },
        sceneGraphDelta: {
          ...startSnapResult.sceneGraphDelta,
          new_objects: [11],
        },
        checkpointId: null,
      })
    })
  })
})
