import type {
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { ORIGIN_TARGET } from '@src/machines/sketchSolve/sketchSolveSelection'
import {
  confirmingDimensions,
  machine,
} from '@src/machines/sketchSolve/tools/lineToolDiagram'
import {
  createLineApiObject,
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'

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
        lastPointId?: number
      }
    | { error: string }
  >
  startNextDraftLine?: (input: unknown) => Promise<
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
            kclSource: { text: 'test' },
            sceneGraphDelta: createSceneGraphDelta([], []),
          }))
      ),
      modAndSolve: fromPromise(
        mockActors?.modAndSolve ||
          (async () => ({
            kclSource: { text: 'test' },
            sceneGraphDelta: createSceneGraphDelta([], []),
            lastPointId: 2,
          }))
      ),
      startNextDraftLine: fromPromise(
        mockActors?.startNextDraftLine ||
          (async () => ({
            kclSource: { text: 'test' },
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
            kclSource: { text: 'test' },
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
            kclSource: { text: 'test' },
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

      await waitFor(actor, (state) => state.matches(confirmingDimensions))

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
            kclSource: { text: 'test' },
            sceneGraphDelta: createSceneGraphDelta(
              [pointObj1, lineObj1],
              [1, 2]
            ),
          }),
          modAndSolve: async () => ({
            kclSource: { text: 'test' },
            sceneGraphDelta: createSceneGraphDelta(
              [pointObj1, lineObj1, pointObj2],
              [3]
            ),
            lastPointId: 3,
          }),
          startNextDraftLine: async () => ({
            kclSource: { text: 'test' },
            sceneGraphDelta: createSceneGraphDelta(
              [pointObj1, lineObj1, pointObj2, lineObj2],
              [4]
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
      await waitFor(actor, (state) => state.matches(confirmingDimensions))
      await waitFor(
        actor,
        (state) => state.value === 'waiting to start next draft line'
      )
      actor.send({ type: 'start next draft line', data: [50, 60] })
      await waitFor(actor, (state) => state.matches('ShowDraftLine'))

      // Add third point (should chain)
      actor.send({ type: 'add point', data: [50, 60] })
      await waitFor(actor, (state) => state.matches(confirmingDimensions))

      actor.stop()
    })

    it.each([
      {
        targetName: 'origin',
        coincidentSegments: [1, 'ORIGIN'],
        snapTarget: { type: ORIGIN_TARGET },
        expectedState: 'waiting to start next draft line',
      },
      {
        targetName: 'another non-origin point',
        coincidentSegments: [1, 99],
        snapTarget: { type: 'point', id: 99 },
        targetObjects: [
          createPointApiObject({ id: 99, x: 5, y: 5, owner: 100 }),
          createPointApiObject({ id: 101, x: 10, y: 5, owner: 100 }),
          createLineApiObject({ id: 100, start: 99, end: 101 }),
        ],
        expectedState: 'ready for user click',
      },
      {
        targetName: 'another real point at the origin',
        coincidentSegments: [1, 99],
        snapTarget: { type: 'point', id: 99 },
        targetObjects: [
          createPointApiObject({ id: 99, x: 0, y: 0, owner: 100 }),
          createPointApiObject({ id: 101, x: 10, y: 0, owner: 100 }),
          createLineApiObject({ id: 100, start: 99, end: 101 }),
        ],
        expectedState: 'ready for user click',
      },
      {
        targetName: 'a line',
        coincidentSegments: [1, 99],
        snapTarget: { type: 'line', id: 99 },
        targetObjects: [
          createPointApiObject({ id: 20, x: 0, y: 0 }),
          createPointApiObject({ id: 21, x: 10, y: 0 }),
          createLineApiObject({ id: 99, start: 20, end: 21 }),
        ],
        expectedState: 'waiting to start next draft line',
      },
    ] as const)(
      'should transition to $expectedState when snapping the next point coincident to $targetName',
      async ({
        coincidentSegments,
        snapTarget,
        targetObjects = [],
        expectedState,
      }) => {
        const pointObj = createPointApiObject({ id: 1, x: 10, y: 20 })
        const lineObj = createLineApiObject({ id: 2, start: 1, end: 1 })
        const coincidentConstraint = {
          id: 10,
          kind: {
            type: 'Constraint',
            constraint: {
              type: 'Coincident',
              segments: [...coincidentSegments],
            },
          },
          label: '',
          comments: '',
          artifact_id: '0',
          source: { type: 'Simple', range: [0, 0, 0], node_path: null },
        } satisfies ApiObject

        const sceneInfra = createMockSceneInfra()
        const rustContext = createMockRustContext()
        const kclManager = createMockKclManager()
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const addSegmentMock = vi.mocked(rustContext.addSegment)
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const editSegmentsMock = vi.mocked(rustContext.editSegments)
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const addConstraintMock = vi.mocked(rustContext.addConstraint)

        addSegmentMock.mockResolvedValue({
          kclSource: { text: 'line' },
          sceneGraphDelta: createSceneGraphDelta([pointObj, lineObj], [1, 2]),
          checkpointId: null,
        })
        editSegmentsMock.mockResolvedValue({
          kclSource: { text: 'line' },
          sceneGraphDelta: createSceneGraphDelta(
            [pointObj, lineObj, ...targetObjects],
            [1]
          ),
          checkpointId: null,
        })
        addConstraintMock.mockResolvedValue({
          kclSource: { text: 'line' },
          sceneGraphDelta: createSceneGraphDelta(
            [pointObj, lineObj, ...targetObjects, coincidentConstraint],
            [10]
          ),
          checkpointId: null,
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
        actor.send({
          type: 'add point',
          data: [0, 0],
          id: 1,
          snapTarget,
        })

        await waitFor(actor, (state) => state.value === expectedState)

        actor.stop()
      }
    )
  })
})
