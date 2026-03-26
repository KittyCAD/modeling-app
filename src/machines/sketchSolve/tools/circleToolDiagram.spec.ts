import { describe, it, expect } from 'vitest'
import { createActor, waitFor, fromPromise } from 'xstate'
import {
  machine,
  showingRadiusPreview,
} from '@src/machines/sketchSolve/tools/circleToolDiagram'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createSceneGraphDelta,
  createPointApiObject,
  createCircleApiObject,
  createMockSceneInfra,
  createMockRustContext,
  createMockKclManager,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createTestMachine(mockActors?: {
  createCircle?: (
    input: unknown
  ) => Promise<
    | { kclSource: SourceDelta; sceneGraphDelta: SceneGraphDelta }
    | { error: string }
  >
}) {
  const sceneInfra = createMockSceneInfra()
  const rustContext = createMockRustContext()
  const kclManager = createMockKclManager()

  const testMachine = machine.provide({
    actors: {
      createCircle: fromPromise(
        mockActors?.createCircle ||
          (async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([], []),
          }))
      ),
    },
  })

  return {
    machine: testMachine,
    sceneInfra,
    rustContext,
    kclManager,
  }
}

describe('circleTool - XState', () => {
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
      expect(context.centerPointId).toBeUndefined()
      expect(context.centerPoint).toBeUndefined()
      expect(context.circleId).toBeUndefined()
      expect(context.sketchId).toBe(0)
      actor.stop()
    })

    it('should call setCallbacks on entry to ready for center click', async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(sceneInfra.setCallbacks).toHaveBeenCalled()
      actor.stop()
    })
  })

  describe('escape key handling', () => {
    it('should transition to unequipping when escape is pressed in ready for center click', async () => {
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

      actor.send({ type: 'escape' })

      await waitFor(actor, (state) => state.matches('unequipping'))
      actor.stop()
    })
  })

  describe('unequip handling', () => {
    it('should transition to unequipping when unequip event is sent', async () => {
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

      actor.send({ type: 'unequip' })

      await waitFor(actor, (state) => state.matches('unequipping'))
      actor.stop()
    })
  })

  describe('two-click workflow', () => {
    it('should store center point on first click and transition to Showing radius preview', () => {
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

      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })

      const snapshot = actor.getSnapshot()
      expect(snapshot.value).toBe('Showing radius preview')
      expect(snapshot.context.centerPoint).toEqual([10, 20])
      actor.stop()
    })

    it('should transition to Creating circle on second click', async () => {
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

      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
      await waitFor(actor, (state) => state.matches(showingRadiusPreview))

      actor.send({ type: 'add point', data: [30, 40], clickNumber: 2 })

      await waitFor(actor, (state) => state.matches('Creating circle'))
      actor.stop()
    })

    it('should return to ready for center click after creating the circle', async () => {
      const centerPoint = createPointApiObject({ id: 1, x: 10, y: 20 })
      const startPoint = createPointApiObject({ id: 2, x: 30, y: 40 })
      const circleObj = createCircleApiObject({ id: 3, start: 2 })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          createCircle: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [centerPoint, startPoint, circleObj],
              [1, 2, 3]
            ),
          }),
        })

      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
      await waitFor(actor, (state) => state.matches(showingRadiusPreview))

      actor.send({ type: 'add point', data: [30, 40], clickNumber: 2 })
      await waitFor(actor, (state) => state.matches('Creating circle'))
      await waitFor(actor, (state) => state.matches('ready for center click'))

      const context = actor.getSnapshot().context
      expect(context.centerPoint).toBeUndefined()
      expect(context.circleId).toBeUndefined()

      actor.stop()
    })
  })

  describe('escape during workflow', () => {
    it('should transition to unequipping when escape is pressed in Showing radius preview', async () => {
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

      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
      await waitFor(actor, (state) => state.matches(showingRadiusPreview))

      actor.send({ type: 'escape' })

      await waitFor(actor, (state) => state.matches('unequipping'))
      actor.stop()
    })
  })
})
