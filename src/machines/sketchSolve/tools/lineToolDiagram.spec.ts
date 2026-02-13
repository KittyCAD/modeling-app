import { describe, it, expect } from 'vitest'
import { createActor, waitFor, fromPromise } from 'xstate'
import { machine } from '@src/machines/sketchSolve/tools/lineToolDiagram'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createSceneGraphDelta,
  createPointApiObject,
  createLineApiObject,
  createMockSceneInfra,
  createMockRustContext,
  createMockKclManager,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

// Helper to create test machine with mocked actors
// Note: The async actors MUST be mocked as they call real Rust/WASM code and make network requests
function createTestMachine(mockActors?: {
  modAndSolveFirstClick?: (
    input: unknown
  ) => Promise<
    | { kclSource: SourceDelta; sceneGraphDelta: SceneGraphDelta }
    | { error: string }
  >
  modAndSolve?: (input: unknown) => Promise<
    | {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        newLineEndPointId?: number
        newlyAddedEntities?: { segmentIds: number[]; constraintIds: number[] }
      }
    | { error: string }
  >
}) {
  const sceneInfra = createMockSceneInfra()
  const rustContext = createMockRustContext()
  const kclManager = createMockKclManager()

  // Create a machine with mocked actors
  const testMachine = machine.provide({
    actors: {
      modAndSolveFirstClick: fromPromise(
        mockActors?.modAndSolveFirstClick ||
          (async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([], []),
          }))
      ),
      modAndSolve: fromPromise(
        mockActors?.modAndSolve ||
          (async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([], []),
            newLineEndPointId: 2,
            newlyAddedEntities: { segmentIds: [1], constraintIds: [1] },
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

describe('lineTool - XState', () => {
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
      expect(context.draftPointId).toBeUndefined()
      expect(context.lastLineEndPointId).toBeUndefined()
      expect(context.pendingDoubleClick).toBeUndefined()
      expect(context.deleteFromEscape).toBeUndefined()
      expect(context.sketchId).toBe(0)
      actor.stop()
    })

    it('should call setCallbacks on entry to ready for user click', () => {
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
    it('should transition to unequipping when escape is pressed in ready for user click', () => {
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

      expect(actor.getSnapshot().value).toBe('unequipping')
      actor.stop()
    })
  })

  describe('unequip handling', () => {
    it('should transition to unequipping when unequip event is sent', () => {
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

      expect(actor.getSnapshot().value).toBe('unequipping')
      actor.stop()
    })
  })

  describe('adding points', () => {
    it('should transition to Adding point when add point event is sent', () => {
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

      actor.send({ type: 'add point', data: [10, 20] })

      expect(actor.getSnapshot().value).toBe('Adding point')
      actor.stop()
    })

    it('should transition to ShowDraftLine after first point is added', async () => {
      const pointObj = createPointApiObject({ id: 1, x: 10, y: 20 })
      const lineObj = createLineApiObject({ id: 2, start: 1, end: 1 })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          modAndSolveFirstClick: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([pointObj, lineObj], [1, 2]),
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

      actor.send({ type: 'add point', data: [10, 20] })

      await waitFor(actor, (state) => state.matches('ShowDraftLine'))

      const context = actor.getSnapshot().context
      expect(context.draftPointId).toBeDefined()

      actor.stop()
    })

    it('should transition to Confirming dimensions when second point is added', async () => {
      const pointObj = createPointApiObject({ id: 1, x: 10, y: 20 })
      const lineObj = createLineApiObject({ id: 2, start: 1, end: 1 })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          modAndSolveFirstClick: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([pointObj, lineObj], [1, 2]),
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

      // Add first point
      actor.send({ type: 'add point', data: [10, 20] })
      await waitFor(actor, (state) => state.matches('ShowDraftLine'))

      // Add second point
      actor.send({ type: 'add point', data: [30, 40] })

      await waitFor(actor, (state) => state.matches('Confirming dimensions'))

      actor.stop()
    })

    it('should chain segments when multiple points are added', async () => {
      const pointObj1 = createPointApiObject({ id: 1, x: 10, y: 20 })
      const lineObj1 = createLineApiObject({ id: 2, start: 1, end: 1 })
      const pointObj2 = createPointApiObject({ id: 3, x: 30, y: 40 })
      const lineObj2 = createLineApiObject({ id: 4, start: 1, end: 3 })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          modAndSolveFirstClick: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [pointObj1, lineObj1],
              [1, 2]
            ),
          }),
          modAndSolve: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [pointObj1, lineObj1, pointObj2, lineObj2],
              [3, 4]
            ),
            newLineEndPointId: 3,
            newlyAddedEntities: { segmentIds: [4], constraintIds: [1] },
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

      // Add first point
      actor.send({ type: 'add point', data: [10, 20] })
      await waitFor(actor, (state) => state.matches('ShowDraftLine'))

      // Add second point (creates first line)
      actor.send({ type: 'add point', data: [30, 40] })
      await waitFor(actor, (state) => state.matches('Confirming dimensions'))
      await waitFor(actor, (state) => state.matches('ShowDraftLine'))

      // Add third point (should chain)
      actor.send({ type: 'add point', data: [50, 60] })
      await waitFor(actor, (state) => state.matches('Confirming dimensions'))

      const context = actor.getSnapshot().context
      expect(context.lastLineEndPointId).toBe(3) // Should track the end point

      actor.stop()
    })
  })
})
