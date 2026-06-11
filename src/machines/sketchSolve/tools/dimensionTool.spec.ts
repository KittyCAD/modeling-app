import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'
import type {
  SelectionClickPoints,
  SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import {
  type DimensionAngleDraftContext,
  buildDimensionAngleConstraint,
  machine as dimensionTool,
  getDimensionAngleSelection,
} from '@src/machines/sketchSolve/tools/dimensionTool'
import {
  createLineApiObject,
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it, vi } from 'vitest'
import { assign, createActor, setup, waitFor } from 'xstate'

function createSketchApiObject({ id }: { id: number }): ApiObject {
  return {
    id,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      plane: 0,
      segments: [],
      constraints: [],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function createAngleConstraintObject({
  id,
  constraint,
}: {
  id: number
  constraint: ApiConstraint
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint,
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function createMouseEvent(point: Coords2d) {
  return {
    mouseEvent: {
      which: 1,
      detail: 1,
    },
    intersectionPoint: {
      twoD: {
        x: point[0],
        y: point[1],
      },
    },
  }
}

function createParentHarness(
  objects: ApiObject[],
  options: {
    initialSelectionIds?: SketchSolveSelectionId[]
    initialSelectionClickPoints?: SelectionClickPoints
  } = {}
) {
  const sceneInfra = createMockSceneInfra()
  const rustContext = createMockRustContext()
  const kclManager = createMockKclManager()
  const events: Array<{ type: string; data?: unknown }> = []
  let nextConstraintId = 30

  rustContext.addConstraint = vi.fn(async (_version, _sketchId, constraint) => {
    const constraintId = nextConstraintId++
    const resultObjects = [
      ...objects,
      createAngleConstraintObject({ id: constraintId, constraint }),
    ]

    return {
      kclSource: { text: '' },
      sceneGraphDelta: createSceneGraphDelta(resultObjects, [constraintId]),
      checkpointId: null,
    }
  }) as typeof rustContext.addConstraint
  rustContext.deleteObjects = vi.fn(async () => ({
    kclSource: { text: '' },
    sceneGraphDelta: createSceneGraphDelta(objects),
    checkpointId: null,
  })) as typeof rustContext.deleteObjects

  const sceneGraphDelta = createSceneGraphDelta(objects)
  const parentMachine = setup({
    types: {
      context: {} as {
        sceneGraphDelta: typeof sceneGraphDelta
      },
      events: {} as
        | { type: 'update selected ids'; data: unknown }
        | { type: 'update hovered id'; data: unknown }
        | {
            type: 'update sketch outcome'
            data: { sceneGraphDelta: typeof sceneGraphDelta }
          }
        | { type: 'set draft entities'; data: unknown }
        | { type: 'clear draft entities' }
        | { type: 'delete draft entities' },
      input: {},
    },
    actors: {
      childTool: dimensionTool,
    },
    actions: {
      'record event': assign(({ context, event }) => {
        events.push(event)
        if (event.type !== 'update sketch outcome') {
          return {}
        }

        return {
          sceneGraphDelta: event.data.sceneGraphDelta,
        }
      }),
    },
  }).createMachine({
    context: {
      sceneGraphDelta,
    },
    initial: 'running',
    on: {
      'update selected ids': { actions: 'record event' },
      'update hovered id': { actions: 'record event' },
      'update sketch outcome': { actions: 'record event' },
      'set draft entities': { actions: 'record event' },
      'clear draft entities': { actions: 'record event' },
      'delete draft entities': { actions: 'record event' },
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
            initialSelectionIds: options.initialSelectionIds,
            initialSelectionClickPoints: options.initialSelectionClickPoints,
            initialObjects: sceneGraphDelta.new_graph.objects,
          },
        },
      },
    },
  })

  const actor = createActor(parentMachine, { input: {} }).start()
  return {
    actor,
    sceneInfra,
    rustContext,
    events,
  }
}

describe('dimensionTool angle selection', () => {
  const lineDirections = {
    line0Direction: [1, 0] as Coords2d,
    line1Direction: [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)] as Coords2d,
  }
  const angleContext: DimensionAngleDraftContext = {
    line0Id: 10,
    line1Id: 11,
    ...lineDirections,
    vertex: [0, 0],
    baseWedgeIndex: 0,
  }

  it('maps cursor sectors relative to the clicked rays', () => {
    expect(getDimensionAngleSelection([1, 0.25], angleContext)).toEqual({
      sector: 1,
      reflex: false,
    })
    expect(getDimensionAngleSelection([0, 10], angleContext)).toEqual({
      sector: 2,
      reflex: false,
    })
    expect(getDimensionAngleSelection([1, -1], angleContext)).toEqual({
      sector: 4,
      reflex: false,
    })
    expect(getDimensionAngleSelection([-1, -0.6], angleContext)).toEqual({
      sector: 1,
      reflex: true,
    })
  })

  it('uses reflex when the visual wedge is opposite the directed KCL sector', () => {
    const clockwiseContext: DimensionAngleDraftContext = {
      line0Id: 10,
      line1Id: 11,
      line0Direction: [
        Math.cos(Math.PI / 3),
        Math.sin(Math.PI / 3),
      ] as Coords2d,
      line1Direction: [1, 0],
      vertex: [0, 0],
      baseWedgeIndex: 0,
    }

    expect(getDimensionAngleSelection([1, 0.25], clockwiseContext)).toEqual({
      sector: 1,
      reflex: true,
    })
    expect(getDimensionAngleSelection([0, 10], clockwiseContext)).toEqual({
      sector: 4,
      reflex: true,
    })
    expect(getDimensionAngleSelection([1, -1], clockwiseContext)).toEqual({
      sector: 2,
      reflex: true,
    })
    expect(getDimensionAngleSelection([-1, -0.3], clockwiseContext)).toEqual({
      sector: 1,
      reflex: false,
    })
  })

  it('builds the labelled angle constraint with sector, reflex, and label position', () => {
    const constraint = buildDimensionAngleConstraint(
      angleContext,
      [-1, -0.6],
      'Mm'
    )

    expect(constraint).toEqual({
      type: 'Angle',
      lines: [10, 11],
      angle: { value: 300, units: 'Deg' },
      sector: 1,
      reflex: true,
      labelPosition: {
        x: { value: -1, units: 'Mm' },
        y: { value: -0.6, units: 'Mm' },
      },
      source: {
        expr: '300deg',
        is_literal: true,
      },
    })
  })
})

describe('dimensionTool', () => {
  it('creates a draft labelled angle constraint after selecting two lines', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const line0End = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line1End = createPointApiObject({
      id: 3,
      x: 5,
      y: 8.660254037844386,
    })
    const line0 = createLineApiObject({ id: 10, start: 1, end: 2 })
    const line1 = createLineApiObject({ id: 11, start: 1, end: 3 })
    const objects = [sketch, origin, line0End, line1End, line0, line1]
    const { actor, sceneInfra, rustContext, events } =
      createParentHarness(objects)
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onClick(createMouseEvent([8, 0]))
    callbacks.onClick(createMouseEvent([5, 8.660254037844386]))

    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )

    expect((rustContext.addConstraint as any).mock.calls[0][2]).toEqual({
      type: 'Angle',
      lines: [10, 11],
      angle: { value: 60, units: 'Deg' },
      sector: 1,
      reflex: false,
      labelPosition: {
        x: { value: 5, units: 'Mm' },
        y: { value: 8.66, units: 'Mm' },
      },
      source: {
        expr: '60deg',
        is_literal: true,
      },
    })
    expect(events).toContainEqual({
      type: 'set draft entities',
      data: {
        segmentIds: [],
        constraintIds: [30],
      },
    })
  })

  it('starts sector selection when initialized with two selected lines', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const origin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const line0End = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line1End = createPointApiObject({
      id: 3,
      x: 5,
      y: 8.660254037844386,
    })
    const line0 = createLineApiObject({ id: 10, start: 1, end: 2 })
    const line1 = createLineApiObject({ id: 11, start: 1, end: 3 })
    const objects = [sketch, origin, line0End, line1End, line0, line1]
    const { actor, sceneInfra, rustContext, events } = createParentHarness(
      objects,
      {
        initialSelectionIds: [10, 11],
      }
    )
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onMove(createMouseEvent([-1, -0.6]))

    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )

    expect((rustContext.addConstraint as any).mock.calls[0][2]).toEqual({
      type: 'Angle',
      lines: [10, 11],
      angle: { value: 300, units: 'Deg' },
      sector: 1,
      reflex: true,
      labelPosition: {
        x: { value: -1, units: 'Mm' },
        y: { value: -0.6, units: 'Mm' },
      },
      source: {
        expr: '300deg',
        is_literal: true,
      },
    })
    expect(events).toContainEqual({
      type: 'update selected ids',
      data: {
        selectedIds: [10, 11],
        replaceExistingSelection: true,
        selectionClickPoints: {
          10: [10, 0],
          11: [5, 8.660254037844386],
        },
      },
    })
    expect(events).toContainEqual({
      type: 'set draft entities',
      data: {
        segmentIds: [],
        constraintIds: [30],
      },
    })
  })
})
