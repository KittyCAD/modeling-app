import { describe, it, expect, vi } from 'vitest'
import {
  createCircleActor,
  sendResultToParent,
} from '@src/machines/sketchSolve/tools/circleToolImpl'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createSceneGraphDelta,
  createPointApiObject,
  createCircleApiObject,
  createMockRustContext,
  createMockKclManager,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import type { DoneActorEvent } from 'xstate'

type CreatingCircleEvent = {
  type: 'xstate.done.actor.0.Circle tool.Creating circle'
  output: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }
}

describe('circleToolImpl', () => {
  describe('createCircleActor', () => {
    it('creates a circle segment using the circle label', async () => {
      const rustContext = createMockRustContext()
      const spiedFn = vi.spyOn(rustContext, 'addSegment')
      const kclManager = createMockKclManager()
      const sceneGraphDelta = createSceneGraphDelta([], [])
      ;(rustContext.addSegment as any).mockResolvedValue({
        kclSource: { text: 'circle' },
        sceneGraphDelta,
      })

      const result = await createCircleActor({
        input: {
          centerPoint: [10, 20],
          startPoint: [30, 40],
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
            x: { type: 'Var', value: 30, units: 'Mm' },
            y: { type: 'Var', value: 40, units: 'Mm' },
          },
        },
        'circle',
        expect.anything()
      )
      expect(result).toEqual({
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
        sceneGraphDelta: createSceneGraphDelta([], [10]),
      }
      const startSnapResult = {
        kclSource: { text: 'start-snap' },
        sceneGraphDelta: createSceneGraphDelta([], [11]),
      }
      ;(rustContext.addSegment as any).mockResolvedValue(addSegmentResult)
      ;(rustContext.addConstraint as any)
        .mockResolvedValueOnce(centerSnapResult)
        .mockResolvedValueOnce(startSnapResult)

      const result = await createCircleActor({
        input: {
          centerPoint: [10, 20],
          startPoint: [30, 40],
          centerSnapTarget: { type: 'origin' },
          startSnapTarget: { type: 'point', pointId: 99 },
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
        expect.anything()
      )
      expect(result).toEqual({
        kclSource: { text: 'start-snap' },
        sceneGraphDelta: {
          ...startSnapResult.sceneGraphDelta,
          new_objects: [1, 2, 3, 10, 11],
        },
      })
    })
  })

  describe('sendResultToParent', () => {
    it('extracts IDs from scene graph and persists created circles', () => {
      const centerPoint = createPointApiObject({ id: 1, x: 0, y: 0 })
      const startPoint = createPointApiObject({ id: 2, x: 10, y: 0 })
      const circleObj = createCircleApiObject({ id: 3, center: 1, start: 2 })

      const sceneGraphDelta = createSceneGraphDelta(
        [centerPoint, startPoint, circleObj],
        [1, 2, 3]
      )

      const mockSelf = {
        _parent: {
          send: vi.fn(),
        },
      }

      const event: CreatingCircleEvent = {
        type: 'xstate.done.actor.0.Circle tool.Creating circle',
        output: {
          kclSource: { text: 'test' } as SourceDelta,
          sceneGraphDelta,
        },
      }

      const result = sendResultToParent({
        event,
        self: mockSelf as any,
        context: {
          sceneGraphDelta: {} as SceneGraphDelta,
        } as any,
      } as any)

      expect(mockSelf._parent.send).toHaveBeenCalledWith({
        type: 'update sketch outcome',
        data: {
          sourceDelta: { text: 'test' },
          sceneGraphDelta,
        },
      })

      expect(result.centerPointId).toBe(1)
      expect(result.circleId).toBe(3)
      expect(result.sceneGraphDelta).toBe(sceneGraphDelta)
    })

    it('returns empty object if output has error', () => {
      const event = {
        output: {
          error: 'test error',
        },
      } as DoneActorEvent<{
        kclSource?: SourceDelta
        sceneGraphDelta?: SceneGraphDelta
        error?: string
      }>

      const result = sendResultToParent({
        event,
        self: {} as any,
        context: {} as any,
      } as any)

      expect(result).toEqual({})
    })
  })
})
