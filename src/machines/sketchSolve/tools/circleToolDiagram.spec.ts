import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  machine,
  showingRadiusPreview,
} from '@src/machines/sketchSolve/tools/circleToolDiagram'
import {
  createCircleApiObject,
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'

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
            kclSource: { text: 'test' },
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

function startCircleTool() {
  const fixture = createTestMachine()
  const actor = createActor(fixture.machine, {
    input: {
      sceneInfra: fixture.sceneInfra,
      rustContext: fixture.rustContext,
      kclManager: fixture.kclManager,
      sketchId: 0,
    },
  }).start()
  return { actor, sceneInfra: fixture.sceneInfra }
}

describe('circleTool - XState', () => {
  describe('when initialized', () => {
    it('should have default context values', () => {
      const { actor } = startCircleTool()

      const context = actor.getSnapshot().context
      expect(context.centerPointId).toBeUndefined()
      expect(context.centerPoint).toBeUndefined()
      expect(context.circleId).toBeUndefined()
      expect(context.sketchId).toBe(0)
      actor.stop()
    })

    it('should call setCallbacks on entry to ready for center click', async () => {
      const { actor, sceneInfra } = startCircleTool()

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(sceneInfra.setCallbacks).toHaveBeenCalled()
      actor.stop()
    })
  })

  describe('escape key handling', () => {
    it('should transition to unequipping when escape is pressed in ready for center click', async () => {
      const { actor } = startCircleTool()

      actor.send({ type: 'escape' })

      await waitFor(actor, (state) => state.matches('unequipping'))
      actor.stop()
    })
  })

  describe('unequip handling', () => {
    it('should transition to unequipping when unequip event is sent', async () => {
      const { actor } = startCircleTool()

      actor.send({ type: 'unequip' })

      await waitFor(actor, (state) => state.matches('unequipping'))
      actor.stop()
    })
  })

  describe('two-click workflow', () => {
    it('should store center point on first click and transition to Showing radius preview', () => {
      const { actor } = startCircleTool()

      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })

      const snapshot = actor.getSnapshot()
      expect(snapshot.value).toBe('Showing radius preview')
      expect(snapshot.context.centerPoint).toEqual([10, 20])
      actor.stop()
    })

    it('should transition to Creating circle on second click', async () => {
      const { actor } = startCircleTool()

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
            kclSource: { text: 'test' },
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

  it('waits for a pending radius update before finishing cancellation', async () => {
    const { machine, sceneInfra, rustContext, kclManager } = createTestMachine()
    const actor = createActor(machine, {
      input: { sceneInfra, rustContext, kclManager, sketchId: 0 },
    }).start()
    actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
    const pending = Promise.withResolvers<undefined>()
    actor.getSnapshot().context.preview!.pending = pending.promise
    actor.send({ type: 'escape' })
    expect(actor.getSnapshot().status).toBe('active')
    expect(actor.getSnapshot().value).toBe('unequipping')
    pending.resolve(undefined)
    await waitFor(actor, (state) => state.status === 'done')
    actor.stop()
  })

  it('finishes a pending circle commit before unequipping', async () => {
    const commit = Promise.withResolvers<{
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    }>()
    const { machine, sceneInfra, rustContext, kclManager } = createTestMachine({
      createCircle: () => commit.promise,
    })
    const actor = createActor(machine, {
      input: { sceneInfra, rustContext, kclManager, sketchId: 0 },
    }).start()
    actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
    actor.send({ type: 'add point', data: [30, 40], clickNumber: 2 })
    actor.send({ type: 'unequip' })
    expect(actor.getSnapshot().value).toBe('Creating circle')
    commit.resolve({
      kclSource: { text: 'circle' },
      sceneGraphDelta: createSceneGraphDelta([], []),
    })
    await waitFor(actor, (state) => state.status === 'done')
    actor.stop()
  })

  describe('escape during workflow', () => {
    it('should transition to unequipping when escape is pressed in Showing radius preview', async () => {
      const { actor } = startCircleTool()

      actor.send({ type: 'add point', data: [10, 20], clickNumber: 1 })
      await waitFor(actor, (state) => state.matches(showingRadiusPreview))

      actor.send({ type: 'escape' })

      await waitFor(actor, (state) => state.matches('unequipping'))
      actor.stop()
    })
  })
})
