import { describe, it, expect } from 'vitest'
import { createActor, waitFor, fromPromise } from 'xstate'
import {
  machine,
  showingRadiusPreview,
  animatingArc,
} from '@src/machines/sketchSolve/tools/centerArcToolDiagram'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createSceneGraphDelta,
  createPointApiObject,
  createArcApiObject,
  createMockSceneInfra,
  createMockRustContext,
  createMockKclManager,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

// Helper to create test machine with mocked actors
// Note: The async actors MUST be mocked as they call real Rust/WASM code and make network requests
function createTestMachine(mockActors?: {
  createArc?: (
    input: unknown
  ) => Promise<
    | { kclSource: SourceDelta; sceneGraphDelta: SceneGraphDelta }
    | { error: string }
  >
  finalizeArc?: (
    input: unknown
  ) => Promise<
    | { kclSource: SourceDelta; sceneGraphDelta: SceneGraphDelta }
    | { error: string }
  >
}) {
  const sceneInfra = createMockSceneInfra()
  const rustContext = createMockRustContext()
  const kclManager = createMockKclManager()

  // Create a machine with mocked actors
  const testMachine = machine.provide({
    actors: {
      createArc: fromPromise(
        mockActors?.createArc ||
          (async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([], []),
          }))
      ),
      finalizeArc: fromPromise(
        mockActors?.finalizeArc ||
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

describe('centerArcTool - XState', () => {
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
      expect(context.arcId).toBeUndefined()
      expect(context.arcEndPointId).toBeUndefined()
      expect(context.arcStartPoint).toBeUndefined()
      expect(context.sketchId).toBe(0)
      actor.stop()
    })

    it('should call setCallbacks on entry to ready for center click', () => {
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

  describe('three-click workflow', () => {
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

    it('should transition to Creating arc on second click', async () => {
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

      // First click
      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
      await waitFor(actor, (state) => state.matches(showingRadiusPreview))

      // Second click
      actor.send({ type: 'add point', data: [30, 40], clickNumber: 2 })

      await waitFor(actor, (state) => state.matches('Creating arc'))
      actor.stop()
    })

    it('should transition to Animating arc after arc is created', async () => {
      const centerPoint = createPointApiObject({ id: 1, x: 10, y: 20 })
      const startPoint = createPointApiObject({ id: 2, x: 30, y: 40 })
      const endPoint = createPointApiObject({ id: 3, x: 30, y: 40 })
      const arcObj = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          createArc: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [centerPoint, startPoint, endPoint, arcObj],
              [1, 2, 3, 4]
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

      // First click
      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
      await waitFor(actor, (state) => state.matches(showingRadiusPreview))

      // Second click
      actor.send({ type: 'add point', data: [30, 40], clickNumber: 2 })
      await waitFor(actor, (state) => state.matches('Creating arc'))
      await waitFor(actor, (state) => state.matches(animatingArc))

      const context = actor.getSnapshot().context
      expect(context.arcId).toBeDefined()
      expect(context.arcStartPoint).toBeDefined()

      actor.stop()
    })

    it('should transition to Finalizing arc on third click', async () => {
      const centerPoint = createPointApiObject({ id: 1, x: 10, y: 20 })
      const startPoint = createPointApiObject({ id: 2, x: 30, y: 40 })
      const endPoint = createPointApiObject({ id: 3, x: 30, y: 40 })
      const arcObj = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          createArc: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [centerPoint, startPoint, endPoint, arcObj],
              [1, 2, 3, 4]
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

      // First click
      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
      await waitFor(actor, (state) => state.matches(showingRadiusPreview))

      // Second click
      actor.send({ type: 'add point', data: [30, 40], clickNumber: 2 })
      await waitFor(actor, (state) => state.matches(animatingArc))

      // Third click
      actor.send({ type: 'add point', data: [50, 60], clickNumber: 3 })

      await waitFor(actor, (state) => state.matches('Finalizing arc'))
      actor.stop()
    })

    it('should transition to ready for center click after finalizing arc', async () => {
      const centerPoint = createPointApiObject({ id: 1, x: 10, y: 20 })
      const startPoint = createPointApiObject({ id: 2, x: 30, y: 40 })
      const endPoint = createPointApiObject({ id: 3, x: 30, y: 40 })
      const arcObj = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          createArc: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [centerPoint, startPoint, endPoint, arcObj],
              [1, 2, 3, 4]
            ),
          }),
          finalizeArc: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [centerPoint, startPoint, endPoint, arcObj],
              [1, 2, 3, 4]
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

      // First click
      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
      await waitFor(actor, (state) => state.matches(showingRadiusPreview))

      // Second click
      actor.send({ type: 'add point', data: [30, 40], clickNumber: 2 })
      await waitFor(actor, (state) => state.matches(animatingArc))

      // Third click
      actor.send({ type: 'add point', data: [50, 60], clickNumber: 3 })
      await waitFor(actor, (state) => state.matches('Finalizing arc'))
      // After finalizing, the tool returns to 'ready for center click' to allow creating another arc
      await waitFor(actor, (state) => state.matches('ready for center click'))

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

      // First click
      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
      await waitFor(actor, (state) => state.matches(showingRadiusPreview))

      // Escape
      actor.send({ type: 'escape' })

      await waitFor(actor, (state) => state.matches('unequipping'))
      actor.stop()
    })

    it('should transition to unequipping when escape is pressed in Animating arc', async () => {
      const centerPoint = createPointApiObject({ id: 1, x: 10, y: 20 })
      const startPoint = createPointApiObject({ id: 2, x: 30, y: 40 })
      const endPoint = createPointApiObject({ id: 3, x: 30, y: 40 })
      const arcObj = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          createArc: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [centerPoint, startPoint, endPoint, arcObj],
              [1, 2, 3, 4]
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

      // First click
      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
      await waitFor(actor, (state) => state.matches(showingRadiusPreview))

      // Second click
      actor.send({ type: 'add point', data: [30, 40], clickNumber: 2 })
      await waitFor(actor, (state) => state.matches(animatingArc))

      // Escape
      actor.send({ type: 'escape' })

      await waitFor(actor, (state) => state.matches('unequipping'))
      actor.stop()
    })
  })
})
