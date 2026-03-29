import { describe, expect, it } from 'vitest'
import { createActor, waitFor, fromPromise } from 'xstate'
import type {
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { machine } from '@src/machines/sketchSolve/tools/lineToolDiagram'
import {
  createLineApiObject,
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'

function createConstraintApiObject(id: number): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint: {
        type: 'Coincident',
        segments: [],
      } as any,
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

describe('lineToolDiagram snapping', () => {
  it('adds a coincident constraint when finalizing onto a snap target', async () => {
    const startPoint = createPointApiObject({ id: 1, x: 10, y: 20 })
    const draftPoint = createPointApiObject({ id: 2, x: 10, y: 20 })
    const firstLine = createLineApiObject({ id: 3, start: 1, end: 2 })
    const snapTarget = createPointApiObject({ id: 9, x: 30, y: 40 })
    const snapConstraint = createConstraintApiObject(20)
    const nextDraftPoint = createPointApiObject({ id: 4, x: 30, y: 40 })
    const nextLine = createLineApiObject({ id: 5, start: 2, end: 4 })
    const chainConstraint = createConstraintApiObject(6)

    const sceneInfra = createMockSceneInfra()
    const rustContext = createMockRustContext()
    const kclManager = createMockKclManager()
    ;(rustContext.editSegments as any).mockResolvedValue({
      kclSource: { text: 'edit' } as SourceDelta,
      sceneGraphDelta: createSceneGraphDelta(
        [startPoint, draftPoint, firstLine, snapTarget],
        []
      ),
    })
    ;(rustContext.addConstraint as any).mockResolvedValue({
      kclSource: { text: 'snap' } as SourceDelta,
      sceneGraphDelta: createSceneGraphDelta(
        [startPoint, draftPoint, firstLine, snapTarget, snapConstraint],
        [20]
      ),
    })
    ;(rustContext.chainSegment as any).mockResolvedValue({
      kclSource: { text: 'chain' } as SourceDelta,
      sceneGraphDelta: createSceneGraphDelta(
        [
          startPoint,
          draftPoint,
          nextDraftPoint,
          firstLine,
          nextLine,
          snapTarget,
          chainConstraint,
          snapConstraint,
        ],
        [4, 5, 6]
      ),
    })

    const testMachine = machine.provide({
      actors: {
        modAndSolveFirstClick: fromPromise(
          async (): Promise<
            | { kclSource: SourceDelta; sceneGraphDelta: SceneGraphDelta }
            | { error: string }
          > => ({
            kclSource: { text: 'first' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [startPoint, draftPoint, firstLine],
              [1, 2, 3]
            ),
          })
        ),
      },
    })

    const actor = createActor(testMachine, {
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
      data: [30, 40],
      id: 2,
      snapTarget: { type: 'segment', id: 9 },
    })
    await waitFor(actor, (state) => state.matches('ShowDraftLine'))

    expect((rustContext.addConstraint as any).mock.calls[0]?.[0]).toBe(0)
    expect((rustContext.addConstraint as any).mock.calls[0]?.[1]).toBe(0)
    expect((rustContext.addConstraint as any).mock.calls[0]?.[2]).toEqual({
      type: 'Coincident',
      segments: [
        { type: 'Segment', id: 2 },
        { type: 'Segment', id: 9 },
      ],
    })
    expect((rustContext.addConstraint as any).mock.calls[0]?.[3]).toBeTruthy()

    actor.stop()
  })

  it('adds a coincident-to-origin constraint when finalizing onto the origin', async () => {
    const startPoint = createPointApiObject({ id: 1, x: 10, y: 20 })
    const draftPoint = createPointApiObject({ id: 2, x: 10, y: 20 })
    const firstLine = createLineApiObject({ id: 3, start: 1, end: 2 })
    const snapConstraint = createConstraintApiObject(20)
    const nextDraftPoint = createPointApiObject({ id: 4, x: 0, y: 0 })
    const nextLine = createLineApiObject({ id: 5, start: 2, end: 4 })
    const chainConstraint = createConstraintApiObject(6)

    const sceneInfra = createMockSceneInfra()
    const rustContext = createMockRustContext()
    const kclManager = createMockKclManager()
    ;(rustContext.editSegments as any).mockResolvedValue({
      kclSource: { text: 'edit' } as SourceDelta,
      sceneGraphDelta: createSceneGraphDelta(
        [startPoint, draftPoint, firstLine],
        []
      ),
    })
    ;(rustContext.addConstraint as any).mockResolvedValue({
      kclSource: { text: 'snap-origin' } as SourceDelta,
      sceneGraphDelta: createSceneGraphDelta(
        [startPoint, draftPoint, firstLine, snapConstraint],
        [20]
      ),
    })
    ;(rustContext.chainSegment as any).mockResolvedValue({
      kclSource: { text: 'chain' } as SourceDelta,
      sceneGraphDelta: createSceneGraphDelta(
        [
          startPoint,
          draftPoint,
          nextDraftPoint,
          firstLine,
          nextLine,
          chainConstraint,
          snapConstraint,
        ],
        [4, 5, 6]
      ),
    })

    const testMachine = machine.provide({
      actors: {
        modAndSolveFirstClick: fromPromise(
          async (): Promise<
            | { kclSource: SourceDelta; sceneGraphDelta: SceneGraphDelta }
            | { error: string }
          > => ({
            kclSource: { text: 'first' } as SourceDelta,
            sceneGraphDelta: createSceneGraphDelta(
              [startPoint, draftPoint, firstLine],
              [1, 2, 3]
            ),
          })
        ),
      },
    })

    const actor = createActor(testMachine, {
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
      id: 2,
      snapTarget: { type: 'origin' },
    })
    await waitFor(actor, (state) => state.matches('ShowDraftLine'))

    expect((rustContext.addConstraint as any).mock.calls[0]?.[0]).toBe(0)
    expect((rustContext.addConstraint as any).mock.calls[0]?.[1]).toBe(0)
    expect((rustContext.addConstraint as any).mock.calls[0]?.[2]).toEqual({
      type: 'Coincident',
      segments: [{ type: 'Segment', id: 2 }, { type: 'Origin' }],
    })
    expect((rustContext.addConstraint as any).mock.calls[0]?.[3]).toBeTruthy()

    actor.stop()
  })
})
