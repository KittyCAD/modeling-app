import { describe, expect, it, vi } from 'vitest'
import { assign, createActor, setup, waitFor } from 'xstate'
import { machine as horizontalConstraintTool } from '@src/machines/sketchSolve/tools/horizontalConstraintTool'
import { machine as equalLengthConstraintTool } from '@src/machines/sketchSolve/tools/equalLengthConstraintTool'
import { machine as fixedConstraintTool } from '@src/machines/sketchSolve/tools/fixedConstraintTool'
import { machine as tangentConstraintTool } from '@src/machines/sketchSolve/tools/tangentConstraintTool'
import {
  createArcApiObject,
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createLineApiObject,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SketchSolveSelectionId } from '@src/machines/sketchSolve/sketchSolveSelection'

type ParentContext = {
  selectedIds: SketchSolveSelectionId[]
  sketchId: number
  sketchExecOutcome: {
    sceneGraphDelta: ReturnType<typeof createSceneGraphDelta>
  }
}

type ParentEvent =
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
    }

type ConstraintToolActorLogic = typeof horizontalConstraintTool
const parentContextType: ParentContext = null!
const parentEventType: ParentEvent = null!
const parentInputType: Record<string, never> = null!

function createHarness({
  childMachine,
  selectedIds = [],
  objects = [],
}: {
  childMachine: ConstraintToolActorLogic
  selectedIds?: SketchSolveSelectionId[]
  objects?: ApiObject[]
}) {
  const sceneInfra = createMockSceneInfra()
  const rustContext = createMockRustContext()
  const kclManager = createMockKclManager()
  const events: Array<{ type: string; data?: Record<string, unknown> }> = []
  const sceneGraphDelta = createSceneGraphDelta(objects)

  const parentMachine = setup({
    types: {
      context: parentContextType,
      events: parentEventType,
      input: parentInputType,
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

  const actor = createActor(parentMachine, { input: {} }).start()
  const child = actor.getSnapshot().children.childTool
  if (!child) {
    throw new Error('Expected child tool actor to be spawned')
  }

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
          points: [1, 2],
          distance: { value: 5, units: 'Mm' },
          source: { expr: '5', is_literal: true },
        },
      },
      label: '',
      comments: '',
      artifact_id: '0',
      source: { type: 'Simple', range: [0, 0, 0], node_path: null },
    } satisfies ApiObject
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
    })

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
      childMachine: equalLengthConstraintTool,
      objects,
    })
    const addConstraintMock = vi.spyOn(rustContext, 'addConstraint')

    addConstraintMock.mockResolvedValue({
      kclSource: { text: 'next' },
      sceneGraphDelta: createSceneGraphDelta(objects),
      checkpointId: 1,
    })

    child.send({
      type: 'commit area selection',
      currentSelectionIds: [],
      candidateSelectionIds: [10, 11, 12],
      objects: createSceneGraphDelta(objects).new_graph.objects,
    })

    await waitFor(child, () => addConstraintMock.mock.calls.length > 0)

    expect(addConstraintMock).toHaveBeenCalledWith(
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
      childMachine: horizontalConstraintTool,
      objects,
    })
    const addConstraintMock = vi.spyOn(rustContext, 'addConstraint')

    addConstraintMock
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
    })

    await waitFor(child, () => addConstraintMock.mock.calls.length === 2)

    expect(addConstraintMock).toHaveBeenNthCalledWith(
      1,
      0,
      0,
      {
        type: 'Horizontal',
        line: 10,
      },
      expect.anything(),
      false
    )
    expect(addConstraintMock).toHaveBeenNthCalledWith(
      2,
      0,
      0,
      {
        type: 'Horizontal',
        line: 11,
      },
      expect.anything(),
      true
    )
  })

  it('applies a fixed constraint for a single clicked point and stays equipped', async () => {
    const point = createPointApiObject({ id: 10, x: 3, y: 4 })
    const objects = [point]
    const { child, rustContext } = createHarness({
      childMachine: fixedConstraintTool,
      objects,
    })
    const addConstraintMock = vi.spyOn(rustContext, 'addConstraint')

    addConstraintMock.mockResolvedValue({
      kclSource: { text: 'fixed' },
      sceneGraphDelta: createSceneGraphDelta(objects),
      checkpointId: 3,
    })

    child.send({
      type: 'click selection',
      currentSelectionIds: [],
      clickedSelectionId: 10,
      objects: createSceneGraphDelta(objects).new_graph.objects,
    })

    await waitFor(child, () => addConstraintMock.mock.calls.length === 1)

    expect(addConstraintMock).toHaveBeenCalledWith(
      0,
      0,
      {
        type: 'Fixed',
        points: [
          {
            point: 10,
            position: {
              x: { value: 3, units: 'Mm' },
              y: { value: 4, units: 'Mm' },
            },
          },
        ],
      },
      expect.anything(),
      true
    )
    expect(child.getSnapshot().status).toBe('active')
  })

  it('filters tangent selections through the first valid partial selection path', async () => {
    const center = createPointApiObject({ id: 1 })
    const arcStart = createPointApiObject({ id: 2 })
    const arcEnd = createPointApiObject({ id: 3 })
    const lineStart = createPointApiObject({ id: 4 })
    const lineEnd = createPointApiObject({ id: 5 })
    const otherLineStart = createPointApiObject({ id: 6 })
    const otherLineEnd = createPointApiObject({ id: 7 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const line = createLineApiObject({ id: 11, start: 4, end: 5 })
    const otherLine = createLineApiObject({ id: 12, start: 6, end: 7 })
    const objects = [
      center,
      arcStart,
      arcEnd,
      lineStart,
      lineEnd,
      otherLineStart,
      otherLineEnd,
      arc,
      line,
      otherLine,
    ]
    const { actor, child, rustContext } = createHarness({
      childMachine: tangentConstraintTool,
      objects,
    })
    const addConstraintMock = vi.spyOn(rustContext, 'addConstraint')

    addConstraintMock.mockResolvedValue({
      kclSource: { text: 'tangent' },
      sceneGraphDelta: createSceneGraphDelta(objects),
      checkpointId: 4,
    })

    child.send({
      type: 'click selection',
      currentSelectionIds: [],
      clickedSelectionId: 11,
      objects: createSceneGraphDelta(objects).new_graph.objects,
    })

    await waitFor(
      actor,
      (snapshot) =>
        JSON.stringify(snapshot.context.selectedIds) === JSON.stringify([11])
    )

    child.send({
      type: 'click selection',
      currentSelectionIds: [11],
      clickedSelectionId: 12,
      objects: createSceneGraphDelta(objects).new_graph.objects,
    })

    await waitFor(
      actor,
      (snapshot) =>
        JSON.stringify(snapshot.context.selectedIds) === JSON.stringify([])
    )

    child.send({
      type: 'click selection',
      currentSelectionIds: [],
      clickedSelectionId: 11,
      objects: createSceneGraphDelta(objects).new_graph.objects,
    })

    await waitFor(
      actor,
      (snapshot) =>
        JSON.stringify(snapshot.context.selectedIds) === JSON.stringify([11])
    )

    child.send({
      type: 'click selection',
      currentSelectionIds: [11],
      clickedSelectionId: 10,
      objects: createSceneGraphDelta(objects).new_graph.objects,
    })

    await waitFor(child, () => addConstraintMock.mock.calls.length === 1)

    expect(addConstraintMock).toHaveBeenCalledWith(
      0,
      0,
      {
        type: 'Tangent',
        input: [11, 10],
      },
      expect.anything(),
      true
    )
  })
})
