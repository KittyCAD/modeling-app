import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  createArcApiObject,
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { machine } from '@src/machines/sketchSolve/tools/tangentialArcToolDiagram'
import { describe, expect, it } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'

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

describe('tangentialArcTool - XState', () => {
  it('should start in ready-for-anchor state', () => {
    const { machine, sceneInfra, rustContext, kclManager } = createTestMachine()
    const actor = createActor(machine, {
      input: {
        sceneInfra,
        rustContext,
        kclManager,
        sketchId: 0,
      },
    }).start()

    expect(actor.getSnapshot().value).toBe('ready for tangent anchor click')
    actor.stop()
  })

  it('should transition to animation after first click creates the arc', async () => {
    const center = createPointApiObject({ id: 1, x: 0, y: 0 })
    const start = createPointApiObject({ id: 2, x: 10, y: 0 })
    const end = createPointApiObject({ id: 3, x: 10, y: 0 })
    const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })
    const createResult = createSceneGraphDelta(
      [center, start, end, arc],
      [1, 2, 3, 4]
    )

    const { machine, sceneInfra, rustContext, kclManager } = createTestMachine({
      createArc: async () => ({
        kclSource: { text: 'create' } as SourceDelta,
        sceneGraphDelta: createResult,
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

    actor.send({
      type: 'select tangent anchor',
      data: {
        lineId: 10,
        tangentStart: { id: 11, point: [10, 0] },
        tangentDirection: [1, 0],
      },
    })

    await waitFor(actor, (state) => state.matches('Animating arc'))
    actor.stop()
  })

  it('should complete on second click and return to ready state', async () => {
    const center = createPointApiObject({ id: 1, x: 0, y: 0 })
    const start = createPointApiObject({ id: 2, x: 10, y: 0 })
    const end = createPointApiObject({ id: 3, x: 10, y: 0 })
    const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })
    const createResult = createSceneGraphDelta(
      [center, start, end, arc],
      [1, 2, 3, 4]
    )

    const { machine, sceneInfra, rustContext, kclManager } = createTestMachine({
      createArc: async () => ({
        kclSource: { text: 'create' } as SourceDelta,
        sceneGraphDelta: createResult,
      }),
      finalizeArc: async () => ({
        kclSource: { text: 'finalize' } as SourceDelta,
        sceneGraphDelta: createResult,
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

    actor.send({
      type: 'select tangent anchor',
      data: {
        lineId: 10,
        tangentStart: { id: 11, point: [10, 0] },
        tangentDirection: [1, 0],
      },
    })
    await waitFor(actor, (state) => state.matches('Animating arc'))

    actor.send({ type: 'add point', data: [15, 5], clickNumber: 2 })
    await waitFor(actor, (state) => state.matches('Finalizing arc'))
    await waitFor(actor, (state) =>
      state.matches('ready for tangent anchor click')
    )

    actor.stop()
  })
})
