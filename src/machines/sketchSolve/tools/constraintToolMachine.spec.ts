import { describe, expect, it, vi } from 'vitest'
import { assign, createActor, setup, waitFor } from 'xstate'
import { machine as horizontalConstraintTool } from '@src/machines/sketchSolve/tools/horizontalConstraintTool'
import { machine as equalLengthConstraintTool } from '@src/machines/sketchSolve/tools/equalLengthConstraintTool'
import {
  createMockKclManager,
  createMockSceneInfra,
  createLineApiObject,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'

function createHarness({
  childMachine,
  selectedIds = [],
  objects = [],
}: {
  childMachine: any
  selectedIds?: SketchSolveSelectionId[]
  objects?: ApiObject[]
}) {
  const sceneInfra = createMockSceneInfra()
  const rustContext = {
    addConstraint: vi.fn(),
    settingsActor: {
      send: vi.fn(),
      getSnapshot: vi.fn(() => ({
        context: {
          app: {},
        },
      })),
    },
  } as any
  const kclManager = createMockKclManager()
  const events: Array<{ type: string; data?: Record<string, unknown> }> = []
  const sceneGraphDelta = createSceneGraphDelta(objects)

  const parentMachine = setup({
    types: {
      context: {} as {
        selectedIds: SketchSolveSelectionId[]
        sketchId: number
        sketchExecOutcome: {
          sceneGraphDelta: ReturnType<typeof createSceneGraphDelta>
        }
      },
      events: {} as
        | {
            type: 'update selected ids'
            data: {
              selectedIds: SketchSolveSelectionId[]
              duringAreaSelectIds: number[]
              replaceExistingSelection: true
            }
          }
        | {
            type: 'update hovered id'
            data: {
              hoveredId: SketchSolveSelectionId | null
            }
          }
        | {
            type: 'update sketch outcome'
            data: {
              sourceDelta: { text: string }
              sceneGraphDelta: ReturnType<typeof createSceneGraphDelta>
              checkpointId: number | null
            }
          },
      input: {} as Record<string, never>,
    },
    actors: {
      childTool: childMachine,
    },
    actions: {
      'record selected ids': assign(({ context, event }) => {
        events.push(event)
        if (event.type !== 'update selected ids') {
          return {}
        }

        return {
          selectedIds: event.data.selectedIds,
        }
      }),
      'record hovered id': ({ event }) => {
        events.push(event)
      },
      'record sketch outcome': assign(({ event }) => {
        events.push(event)
        if (event.type !== 'update sketch outcome') {
          return {}
        }

        return {
          sketchExecOutcome: {
            sceneGraphDelta: event.data.sceneGraphDelta,
          },
        }
      }),
    },
  }).createMachine({
    context: {
      selectedIds,
      sketchId: 0,
      sketchExecOutcome: {
        sceneGraphDelta,
      },
    },
    initial: 'running',
    on: {
      'update selected ids': {
        actions: 'record selected ids',
      },
      'update hovered id': {
        actions: 'record hovered id',
      },
      'update sketch outcome': {
        actions: 'record sketch outcome',
      },
    },
    states: {
      running: {
        invoke: {
          id: 'childTool',
          src: 'childTool',
          input: {
            sceneInfra,
            rustContext,
            kclManager,
            sketchId: 0,
          },
        },
      },
    },
  })

  const actor = createActor(parentMachine as any).start()
  const child = actor.getSnapshot().children.childTool!

  return {
    actor,
    child,
    sceneInfra,
    rustContext,
    events,
  }
}

describe('constraintToolMachine', () => {
  it('normalizes the inherited selection when a tool is equipped', async () => {
    const point1 = createPointApiObject({ id: 1 })
    const dimension = {
      id: 3,
      kind: {
        type: 'Constraint',
        constraint: {
          type: 'Distance',
        },
      },
      label: '',
      comments: '',
      artifact_id: '0',
      source: { type: 'Simple', range: [0, 0, 0], node_path: null },
    } as ApiObject
    const { actor, events } = createHarness({
      childMachine: horizontalConstraintTool,
      selectedIds: [1, 3],
      objects: [point1, dimension],
    })

    await waitFor(
      actor,
      (snapshot) =>
        JSON.stringify(snapshot.context.selectedIds) === JSON.stringify([1])
    )

    expect(events).toContainEqual({
      type: 'update selected ids',
      data: {
        selectedIds: [1],
        duringAreaSelectIds: [],
        replaceExistingSelection: true,
      },
    })
  })

  it('keeps a partial compatible area selection', async () => {
    const point1 = createPointApiObject({ id: 1 })
    const { actor, child } = createHarness({
      childMachine: horizontalConstraintTool,
      objects: [point1],
    })

    child.send({
      type: 'commit area selection',
      currentSelectionIds: [],
      candidateSelectionIds: [1],
      objects: createSceneGraphDelta([point1]).new_graph.objects,
    } as any)

    await waitFor(
      actor,
      (snapshot) =>
        JSON.stringify(snapshot.context.selectedIds) === JSON.stringify([1])
    )
  })

  it('applies the full equal-length area selection set', async () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 12, start: 5, end: 6 })
    const objects = [
      pointA,
      pointB,
      pointC,
      pointD,
      pointE,
      pointF,
      lineA,
      lineB,
      lineC,
    ]
    const { child, rustContext } = createHarness({
      childMachine: equalLengthConstraintTool as any,
      objects,
    })

    rustContext.addConstraint.mockResolvedValue({
      kclSource: { text: 'next' },
      sceneGraphDelta: createSceneGraphDelta(objects),
      checkpointId: 1,
    })

    child.send({
      type: 'commit area selection',
      currentSelectionIds: [],
      candidateSelectionIds: [10, 11, 12],
      objects: createSceneGraphDelta(objects).new_graph.objects,
    } as any)

    await waitFor(
      child as any,
      () => rustContext.addConstraint.mock.calls.length > 0
    )

    expect(rustContext.addConstraint).toHaveBeenCalledWith(
      0,
      0,
      {
        type: 'LinesEqualLength',
        lines: [10, 11, 12],
      },
      expect.anything(),
      true
    )
  })

  it('applies one horizontal constraint per selected line in an area selection', async () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const objects = [pointA, pointB, pointC, pointD, lineA, lineB]
    const { child, rustContext } = createHarness({
      childMachine: horizontalConstraintTool as any,
      objects,
    })

    rustContext.addConstraint
      .mockResolvedValueOnce({
        kclSource: { text: 'next-1' },
        sceneGraphDelta: createSceneGraphDelta(objects),
        checkpointId: null,
      })
      .mockResolvedValueOnce({
        kclSource: { text: 'next-2' },
        sceneGraphDelta: createSceneGraphDelta(objects),
        checkpointId: 2,
      })

    child.send({
      type: 'commit area selection',
      currentSelectionIds: [],
      candidateSelectionIds: [10, 11],
      objects: createSceneGraphDelta(objects).new_graph.objects,
    } as any)

    await waitFor(
      child as any,
      () => rustContext.addConstraint.mock.calls.length === 2
    )

    expect(rustContext.addConstraint).toHaveBeenNthCalledWith(
      1,
      0,
      0,
      {
        type: 'Horizontal',
        Line: { line_id: 10 },
      },
      expect.anything(),
      false
    )
    expect(rustContext.addConstraint).toHaveBeenNthCalledWith(
      2,
      0,
      0,
      {
        type: 'Horizontal',
        Line: { line_id: 11 },
      },
      expect.anything(),
      true
    )
  })
})
