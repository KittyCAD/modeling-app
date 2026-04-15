import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor, fromPromise } from 'xstate'
import { machine } from '@src/machines/sketchSolve/tools/rectTool'
import type { RectDraftIds } from '@src/machines/sketchSolve/tools/rectUtils'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createSceneGraphDelta,
  createMockSceneInfra,
  createMockRustContext,
  createMockKclManager,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  clearToolSnappingState,
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'

vi.mock('@src/machines/sketchSolve/tools/toolSnappingUtils', () => ({
  clearToolSnappingState: vi.fn(),
  getBestSnappingCandidate: vi.fn(() => null),
  sendHoveredSnappingCandidate: vi.fn(),
  updateToolSnappingPreview: vi.fn(),
}))

function createTestMachine(mockActors?: {
  modAndSolveFirstClick?: (input: unknown) => Promise<
    | {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        draft: RectDraftIds
      }
    | { error: string }
  >
}) {
  const sceneInfra = createMockSceneInfra()
  const setCallbacksMock = vi.fn()
  sceneInfra.setCallbacks = setCallbacksMock
  const rustContext = createMockRustContext()
  const kclManager = createMockKclManager()

  const testMachine = machine.provide({
    actors: {
      modAndSolveFirstClick: fromPromise(
        mockActors?.modAndSolveFirstClick ||
          (async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([], []),
            draft: {
              lineIds: [1, 2, 3, 4],
              segmentIds: [1, 2, 3, 4],
              constraintIds: [10],
              originPointId: 1,
            },
          }))
      ),
    },
  })

  return {
    machine: testMachine,
    sceneInfra,
    setCallbacksMock,
    rustContext,
    kclManager,
  }
}

describe('rectTool - XState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBestSnappingCandidate).mockReturnValue(null)
  })

  describe('when initialized', () => {
    it('should have default context values', () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      const context = actor.getSnapshot().context
      expect(context.origin).toEqual([0, 0])
      expect(context.rectOriginMode).toBe('corner')
      expect(context.sketchId).toBe(0)
      actor.stop()
    })

    it('should use center origin mode when toolVariant is center', () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
          toolVariant: 'center',
        },
      }).start()

      const context = actor.getSnapshot().context
      expect(context.rectOriginMode).toBe('center')
      actor.stop()
    })

    it('should call setCallbacks on entry to awaiting first point', () => {
      const { machine, sceneInfra, setCallbacksMock, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      expect(setCallbacksMock).toHaveBeenCalled()
      actor.stop()
    })
  })

  describe('adding points', () => {
    it('should use snapped coordinates for the first click', async () => {
      vi.mocked(getBestSnappingCandidate).mockReturnValue({
        position: [10, 20],
        target: { type: 'origin' },
        distance: 0,
      })

      const { machine, sceneInfra, setCallbacksMock, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      const callbacks = setCallbacksMock.mock.calls.at(-1)?.[0]
      callbacks?.onClick?.({
        mouseEvent: { which: 1 },
        intersectionPoint: { twoD: { x: 1, y: 2 } },
      })

      await waitFor(actor, (state) => state.matches('awaiting second point'))
      expect(actor.getSnapshot().context.origin).toEqual([10, 20])

      actor.stop()
    })

    it('should pass the first click snap target into rectangle creation', async () => {
      const modAndSolveFirstClick = vi.fn(async () => ({
        kclSource: { text: 'test' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([], []),
        draft: {
          lineIds: [1, 2, 3, 4] as [number, number, number, number],
          segmentIds: [1, 2, 3, 4],
          constraintIds: [10],
          originPointId: 1,
        },
      }))
      vi.mocked(getBestSnappingCandidate).mockReturnValue({
        position: [10, 20],
        target: { type: 'origin' },
        distance: 0,
      })

      const { machine, sceneInfra, setCallbacksMock, rustContext, kclManager } =
        createTestMachine({
          modAndSolveFirstClick,
        })
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      const callbacks = setCallbacksMock.mock.calls.at(-1)?.[0]
      callbacks?.onClick?.({
        mouseEvent: { which: 1 },
        intersectionPoint: { twoD: { x: 1, y: 2 } },
      })

      await waitFor(actor, (state) => state.matches('awaiting second point'))
      expect(modAndSolveFirstClick).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            snapTarget: { type: 'origin' },
          }),
        })
      )

      actor.stop()
    })

    it('should transition to awaiting second point after first click', async () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })

      await waitFor(actor, (state) => state.matches('awaiting second point'))
      expect(actor.getSnapshot().context.draft).toBeDefined()
      actor.stop()
    })

    it('should transition to awaiting third point in angled mode after setting second point', async () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
          toolVariant: 'angled',
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })
      await waitFor(actor, (state) => state.matches('awaiting second point'))

      actor.send({ type: 'set second point', data: [3, 4] })
      await waitFor(actor, (state) => state.matches('awaiting third point'))
      expect(actor.getSnapshot().context.secondPoint).toEqual([3, 4])

      actor.stop()
    })

    it('should use snapped coordinates for the angled second click', async () => {
      vi.mocked(getBestSnappingCandidate).mockReturnValue({
        position: [30, 40],
        target: { type: 'origin' },
        distance: 0,
      })

      const { machine, sceneInfra, setCallbacksMock, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
          toolVariant: 'angled',
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })
      await waitFor(actor, (state) => state.matches('awaiting second point'))

      const callbacks = setCallbacksMock.mock.calls.at(-1)?.[0]
      callbacks?.onClick?.({
        mouseEvent: { which: 1 },
        intersectionPoint: { twoD: { x: 3, y: 4 } },
      })

      await waitFor(actor, (state) => state.matches('awaiting third point'))
      expect(actor.getSnapshot().context.secondPoint).toEqual([30, 40])

      actor.stop()
    })

    it('should remain in awaiting second point in angled mode when second point equals first point', async () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
          toolVariant: 'angled',
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })
      await waitFor(actor, (state) => state.matches('awaiting second point'))

      actor.send({ type: 'set second point', data: [1, 2] })

      const snapshot = actor.getSnapshot()
      expect(snapshot.matches('awaiting second point')).toBe(true)
      expect(snapshot.context.secondPoint).toBeUndefined()

      actor.stop()
    })

    it('should remain in awaiting third point in angled mode when third click equals second point', async () => {
      const { machine, sceneInfra, setCallbacksMock, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
          toolVariant: 'angled',
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })
      await waitFor(actor, (state) => state.matches('awaiting second point'))

      actor.send({ type: 'set second point', data: [3, 4] })
      await waitFor(actor, (state) => state.matches('awaiting third point'))

      const lastSetCallbacksCall =
        setCallbacksMock.mock.calls[setCallbacksMock.mock.calls.length - 1]
      const callbacks = lastSetCallbacksCall?.[0]
      callbacks?.onClick?.({
        mouseEvent: { which: 1 },
        intersectionPoint: { twoD: { x: 3, y: 4 } },
      })

      const snapshot = actor.getSnapshot()
      expect(snapshot.matches('awaiting third point')).toBe(true)
      expect(snapshot.context.secondPoint).toEqual([3, 4])

      actor.stop()
    })
  })

  describe('escape handling', () => {
    it('should return to awaiting first point on escape after first click', async () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })
      await waitFor(actor, (state) => state.matches('awaiting second point'))

      actor.send({ type: 'escape' })
      await waitFor(actor, (state) => state.matches('awaiting first point'))

      const context = actor.getSnapshot().context
      expect(context.origin).toEqual([0, 0])
      expect(context.draft).toBeUndefined()
      actor.stop()
    })
  })

  describe('finalize handling', () => {
    it('should clear draft and return to awaiting first point', async () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })
      await waitFor(actor, (state) => state.matches('awaiting second point'))

      actor.send({ type: 'finalize' })
      await waitFor(actor, (state) => state.matches('awaiting first point'))

      const context = actor.getSnapshot().context
      expect(context.origin).toEqual([0, 0])
      expect(context.draft).toBeUndefined()
      actor.stop()
    })

    it('should clear draft and second point when finalizing angled mode from third point state', async () => {
      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
          toolVariant: 'angled',
        },
      }).start()

      actor.send({ type: 'add point', data: [1, 2] })
      await waitFor(actor, (state) => state.matches('awaiting second point'))

      actor.send({ type: 'set second point', data: [3, 4] })
      await waitFor(actor, (state) => state.matches('awaiting third point'))

      actor.send({ type: 'finalize' })
      await waitFor(actor, (state) => state.matches('awaiting first point'))

      const context = actor.getSnapshot().context
      expect(context.origin).toEqual([0, 0])
      expect(context.secondPoint).toBeUndefined()
      expect(context.draft).toBeUndefined()
      actor.stop()
    })
  })

  describe('snapping preview', () => {
    it('updates snapping preview on pointer move in the first-point state', () => {
      const snappingCandidate = {
        position: [5, 6] as [number, number],
        target: { type: 'origin' as const },
        distance: 0,
      }
      vi.mocked(getBestSnappingCandidate).mockReturnValue(snappingCandidate)

      const { machine, sceneInfra, setCallbacksMock, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      const callbacks = setCallbacksMock.mock.calls.at(-1)?.[0]
      callbacks?.onMove?.({
        mouseEvent: { shiftKey: false },
        intersectionPoint: { twoD: { x: 1, y: 2 } },
      })

      expect(sendHoveredSnappingCandidate).toHaveBeenCalledWith(
        expect.anything(),
        snappingCandidate
      )
      expect(updateToolSnappingPreview).toHaveBeenCalledWith({
        sceneInfra,
        target: snappingCandidate,
      })

      actor.stop()
    })

    it('clears snapping preview when pointer leaves the sketch plane', () => {
      const { machine, sceneInfra, setCallbacksMock, rustContext, kclManager } =
        createTestMachine()
      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      const callbacks = setCallbacksMock.mock.calls.at(-1)?.[0]
      callbacks?.onMove?.(undefined)

      expect(clearToolSnappingState).toHaveBeenCalledWith({
        self: expect.anything(),
        sceneInfra,
      })

      actor.stop()
    })
  })
})
