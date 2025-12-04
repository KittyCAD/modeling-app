import { describe, it, expect, vi } from 'vitest'
import { createActor, waitFor, fromPromise } from 'xstate'
import { machine } from '@src/machines/sketchSolve/tools/lineTool'
import type {
  SceneGraphDelta,
  SourceDelta,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'

// Helper to create a minimal valid SceneGraphDelta for testing
function createSceneGraphDelta(
  objects: Array<ApiObject>,
  newObjectIds: number[] = []
): SceneGraphDelta {
  // Create a sparse array where objects are placed at their ID index
  const objectsArray: Array<ApiObject> = []
  for (const obj of objects) {
    objectsArray[obj.id] = obj
  }

  return {
    new_graph: {
      project: 0,
      file: 0,
      version: 0,
      objects: objectsArray,
      settings: {
        highlight_edges: false,
        enable_ssao: false,
        show_grid: false,
        replay: null,
        project_directory: null,
        current_file: null,
        fixed_size_grid: true,
      },
      sketch_mode: null,
    },
    new_objects: newObjectIds,
    invalidates_ids: false,
    exec_outcome: {
      errors: [],
      variables: {},
      operations: [],
      artifactGraph: { map: {}, itemCount: 0 },
      filenames: {},
      defaultPlanes: null,
    },
  }
}

// Helper to create a Point ApiObject
function createPointApiObject({
  id,
  x = 0,
  y = 0,
}: {
  id: number
  x?: number
  y?: number
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Point',
        position: {
          x: { value: x, units: 'Mm' },
          y: { value: y, units: 'Mm' },
        },
        ctor: null,
        owner: null,
        freedom: 'Free',
        constraints: [],
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

// Helper to create a Line ApiObject
function createLineApiObject({
  id,
  start,
  end,
}: {
  id: number
  start: number
  end: number
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Line',
        start,
        end,
        ctor: {
          type: 'Line',
          start: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          end: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
        },
        ctor_applicable: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

// Mock dependencies
// Note: SceneInfra only needs setCallbacks, but we mock it for simplicity
// RustContext and KclManager MUST be mocked as they have WASM bindings and complex dependencies
function createMockSceneInfra(): SceneInfra {
  return {
    setCallbacks: vi.fn(),
  } as unknown as SceneInfra
}

function createMockRustContext(): RustContext {
  return {
    addSegment: vi.fn(),
    addConstraint: vi.fn(),
    editSegments: vi.fn(),
    deleteObjects: vi.fn(),
  } as unknown as RustContext
}

function createMockKclManager(): KclManager {
  return {
    fileSettings: {
      defaultLengthUnit: 'Mm',
    },
  } as unknown as KclManager
}

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
  deleteNewlyAddedEntities?: (
    input: unknown
  ) => Promise<{ kclSource: SourceDelta; sceneGraphDelta: SceneGraphDelta }>
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
      deleteNewlyAddedEntities: fromPromise(
        (mockActors?.deleteNewlyAddedEntities ||
          (async () => ({
            kclSource: { text: 'deleted' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([], []),
          }))) as (input: unknown) => Promise<{
          kclSource: SourceDelta
          sceneGraphDelta: SceneGraphDelta
        }>
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
      expect(context.newlyAddedSketchEntities).toBeUndefined()
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

    it('should delete draft entities and return to ready when escape is pressed in ShowDraftLine', async () => {
      const pointObj = createPointApiObject({ id: 1, x: 10, y: 20 })
      const lineObj = createLineApiObject({ id: 2, start: 1, end: 1 })

      const mockDelete = vi.fn().mockResolvedValue({
        kclSource: { text: 'deleted' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([], []),
      })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          modAndSolveFirstClick: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([pointObj, lineObj], [1, 2]),
          }),
          deleteNewlyAddedEntities: mockDelete,
        })

      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      // Add first point to get to ShowDraftLine
      actor.send({ type: 'add point', data: [10, 20] })
      await waitFor(actor, (state) => state.matches('ShowDraftLine'))

      // Press escape
      actor.send({ type: 'escape' })

      // Should transition to delete draft entities on unequip
      await waitFor(actor, (state) =>
        state.matches('delete draft entities on unequip')
      )

      // Wait for deletion to complete and return to ready
      await waitFor(actor, (state) => state.matches('ready for user click'))

      // Note: We don't verify rustContext.deleteObjects directly because we're mocking
      // the entire deleteNewlyAddedEntities actor. The state transition to 'ready for user click'
      // confirms that the deletion actor completed successfully.

      const context = actor.getSnapshot().context
      expect(context.deleteFromEscape).toBeUndefined() // Should be cleared
      expect(context.newlyAddedSketchEntities).toBeUndefined() // Should be cleared
      expect(context.draftPointId).toBeUndefined() // Should be cleared

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

    it('should delete draft entities and unequip when unequip is pressed in ShowDraftLine', async () => {
      const pointObj = createPointApiObject({ id: 1, x: 10, y: 20 })
      const lineObj = createLineApiObject({ id: 2, start: 1, end: 1 })

      const mockDelete = vi.fn().mockResolvedValue({
        kclSource: { text: 'deleted' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta([], []),
      })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          modAndSolveFirstClick: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([pointObj, lineObj], [1, 2]),
          }),
          deleteNewlyAddedEntities: mockDelete,
        })

      const actor = createActor(machine, {
        input: {
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        },
      }).start()

      // Add first point to get to ShowDraftLine
      actor.send({ type: 'add point', data: [10, 20] })
      await waitFor(actor, (state) => state.matches('ShowDraftLine'))

      // Send unequip
      actor.send({ type: 'unequip' })

      // Should transition to delete draft entities on unequip
      await waitFor(actor, (state) =>
        state.matches('delete draft entities on unequip')
      )

      // Wait for deletion to complete and transition to unequipping
      await waitFor(actor, (state) => state.matches('unequipping'))

      // Note: We don't verify rustContext.deleteObjects directly because we're mocking
      // the entire deleteNewlyAddedEntities actor. The state transition to 'unequipping'
      // confirms that the deletion actor completed successfully.

      const context = actor.getSnapshot().context
      expect(context.deleteFromEscape).toBeUndefined() // Should be cleared
      expect(context.newlyAddedSketchEntities).toBeUndefined() // Should be cleared

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

  describe('double-click handling', () => {
    it('should set pendingDoubleClick flag when double-click is detected', async () => {
      const pointObj1 = createPointApiObject({ id: 1, x: 10, y: 20 })
      const lineObj1 = createLineApiObject({ id: 2, start: 1, end: 1 })
      const pointObj2 = createPointApiObject({ id: 3, x: 30, y: 40 })

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
              [pointObj1, lineObj1, pointObj2],
              [3]
            ),
            newLineEndPointId: 3,
            newlyAddedEntities: { segmentIds: [2], constraintIds: [1] },
          }),
          deleteNewlyAddedEntities: async () => ({
            kclSource: { text: 'deleted' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([], []),
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

      // Add second point with double-click
      actor.send({
        type: 'add point',
        data: [30, 40],
        isDoubleClick: true,
      })

      // Should set pendingDoubleClick flag
      await waitFor(actor, (state) => state.matches('Confirming dimensions'))
      const contextAfterClick = actor.getSnapshot().context
      expect(contextAfterClick.pendingDoubleClick).toBe(true)

      // Should transition to delete newly added entities
      await waitFor(actor, (state) =>
        state.matches('delete newly added entities')
      )

      // Should return to ready for user click after deletion
      await waitFor(actor, (state) => state.matches('ready for user click'))

      const finalContext = actor.getSnapshot().context
      expect(finalContext.pendingDoubleClick).toBeUndefined()
      expect(finalContext.newlyAddedSketchEntities).toBeUndefined()
      expect(finalContext.lastLineEndPointId).toBeUndefined() // Should clear on double-click

      actor.stop()
    })

    it('should handle set pending double click event during modAndSolve (i.e. this is how the second click of a double click is detected clean up last added segment and transition back to', async () => {
      const pointObj1 = createPointApiObject({ id: 1, x: 10, y: 20 })
      const lineObj1 = createLineApiObject({ id: 2, start: 1, end: 1 })
      const pointObj2 = createPointApiObject({ id: 3, x: 30, y: 40 })

      let resolveModAndSolve: (value: unknown) => void
      const modAndSolvePromise = new Promise((resolve) => {
        resolveModAndSolve = resolve
      })

      const { machine, sceneInfra, rustContext, kclManager } =
        createTestMachine({
          modAndSolveFirstClick: async () => ({
            kclSource: { text: 'test' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [pointObj1, lineObj1],
              [1, 2]
            ),
          }),
          modAndSolve: async () => {
            return modAndSolvePromise as Promise<{
              kclSource: SourceDelta
              sceneGraphDelta: SceneGraphDelta
              newLineEndPointId: number
              newlyAddedEntities: {
                segmentIds: number[]
                constraintIds: number[]
              }
            }>
          },
          deleteNewlyAddedEntities: async () => ({
            kclSource: { text: 'deleted' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta([], []),
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

      // Add second point (starts modAndSolve)
      actor.send({ type: 'add point', data: [30, 40] })
      await waitFor(actor, (state) => state.matches('Confirming dimensions'))

      // Send set pending double click while modAndSolve is running
      actor.send({ type: 'set pending double click' })

      // Resolve modAndSolve
      resolveModAndSolve!({
        kclSource: { text: 'test' } as SourceDelta,
        sceneGraphDelta: createSceneGraphDelta(
          [pointObj1, lineObj1, pointObj2],
          [3]
        ),
        newLineEndPointId: 3,
        newlyAddedEntities: { segmentIds: [2], constraintIds: [1] },
      })

      // Should transition to delete newly added entities
      await waitFor(actor, (state) =>
        state.matches('delete newly added entities')
      )

      // Wait for deletion to complete and return to ready
      await waitFor(actor, (state) => state.matches('ready for user click'))

      actor.stop()
    })
  })
})
