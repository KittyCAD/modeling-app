import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { OnClickCallbackArgs } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import { toastToolbar, toolbarToastsSignal } from '@src/lib/toolbarToast'
import {
  ORIGIN_TARGET,
  type SelectionCoordinates,
  type SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import {
  buildDimensionAngleConstraint,
  buildDimensionDistanceConstraint,
  type DimensionAngleDraftContext,
  type DimensionDistanceDraftContext,
  machine as dimensionTool,
  getDimensionAngleSelection,
  getDimensionDistanceType,
} from '@src/machines/sketchSolve/tools/dimensionTool'
import {
  createArcApiObject,
  createCircleApiObject,
  createLineApiObject,
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { Vector2, Vector3 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assign, createActor, setup, waitFor } from 'xstate'

afterEach(() => {
  toastToolbar.dismiss()
})

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

function createConstraintObject({
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

function createMouseEvent(
  point: Coords2d,
  { shiftKey = false }: { shiftKey?: boolean } = {}
): OnClickCallbackArgs & {
  intersectionPoint: NonNullable<OnClickCallbackArgs['intersectionPoint']>
} {
  return {
    mouseEvent: {
      which: 1,
      detail: 1,
      shiftKey,
    } as MouseEvent,
    intersectionPoint: {
      twoD: new Vector2(point[0], point[1]),
      threeD: new Vector3(point[0], point[1]),
    },
    intersects: [],
    wasmInstance: {} as never,
  }
}

function createParentHarness(
  objects: ApiObject[],
  options: {
    initialSelectionIds?: SketchSolveSelectionId[]
    initialSelectionCoordinates?: SelectionCoordinates
    keepSelection?: boolean
  } = {}
) {
  const sceneInfra = createMockSceneInfra()
  sceneInfra.getClientSceneScaleFactor = vi.fn(() => 0.1)
  const rustContext = createMockRustContext()
  const kclManager = createMockKclManager()
  const events: Array<{ type: string; data?: unknown }> = []
  let nextConstraintId = 30
  let currentObjects = [...objects]

  const addConstraintMock = vi.fn(
    async (...args: Parameters<typeof rustContext.addConstraint>) => {
      const constraint = args[2]
      const constraintId = nextConstraintId++
      currentObjects = [
        ...currentObjects,
        createConstraintObject({ id: constraintId, constraint }),
      ]

      return {
        kclSource: { text: '' },
        sceneGraphDelta: createSceneGraphDelta(currentObjects, [constraintId]),
        checkpointId: null,
      }
    }
  )
  rustContext.addConstraint = addConstraintMock
  rustContext.editAngleConstraint = vi.fn(
    async (_version, _sketchId, constraintId, constraint) => {
      currentObjects = currentObjects.map((object) =>
        object.id === constraintId
          ? createConstraintObject({ id: constraintId, constraint })
          : object
      )

      return {
        kclSource: { text: '' },
        sceneGraphDelta: createSceneGraphDelta(currentObjects),
        checkpointId: null,
      }
    }
  ) as typeof rustContext.editAngleConstraint
  const editDistanceConstraintMock = vi.fn(
    async (...args: Parameters<typeof rustContext.editDistanceConstraint>) => {
      const constraintId = args[2]
      const constraint = args[3]
      currentObjects = currentObjects.map((object) =>
        object.id === constraintId
          ? createConstraintObject({ id: constraintId, constraint })
          : object
      )

      return {
        kclSource: { text: '' },
        sceneGraphDelta: createSceneGraphDelta(currentObjects),
        checkpointId: null,
      }
    }
  )
  rustContext.editDistanceConstraint = editDistanceConstraintMock
  const deleteObjectsMock = vi.fn(
    async (...args: Parameters<typeof rustContext.deleteObjects>) => {
      const constraintIds = args[2]
      currentObjects = currentObjects.filter(
        (object) => !constraintIds.includes(object.id)
      )

      return {
        kclSource: { text: '' },
        sceneGraphDelta: createSceneGraphDelta(currentObjects),
        checkpointId: null,
      }
    }
  )
  rustContext.deleteObjects = deleteObjectsMock

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
            initialSelectionCoordinates: options.initialSelectionCoordinates,
            initialObjects: sceneGraphDelta.new_graph.objects,
            keepSelection: options.keepSelection,
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
    addConstraintMock,
    editDistanceConstraintMock,
    deleteObjectsMock,
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
    baseSelection: {
      sector: 1,
      inverse: false,
    },
  }

  it('maps cursor sectors relative to the clicked rays', () => {
    expect(getDimensionAngleSelection([1, 0.25], angleContext)).toEqual({
      sector: 1,
      inverse: false,
    })
    expect(getDimensionAngleSelection([0, 10], angleContext)).toEqual({
      sector: 2,
      inverse: false,
    })
    expect(getDimensionAngleSelection([1, -1], angleContext)).toEqual({
      sector: 4,
      inverse: false,
    })
    expect(getDimensionAngleSelection([-1, -0.6], angleContext)).toEqual({
      sector: 1,
      inverse: true,
    })
  })

  it('uses inverse when the visible region is opposite the directed KCL sector', () => {
    const clockwiseContext: DimensionAngleDraftContext = {
      line0Id: 10,
      line1Id: 11,
      line0Direction: [
        Math.cos(Math.PI / 3),
        Math.sin(Math.PI / 3),
      ] as Coords2d,
      line1Direction: [1, 0],
      vertex: [0, 0],
      baseSelection: {
        sector: 1,
        inverse: true,
      },
    }

    expect(getDimensionAngleSelection([1, 0.25], clockwiseContext)).toEqual({
      sector: 1,
      inverse: true,
    })
    expect(getDimensionAngleSelection([0, 10], clockwiseContext)).toEqual({
      sector: 4,
      inverse: true,
    })
    expect(getDimensionAngleSelection([1, -1], clockwiseContext)).toEqual({
      sector: 2,
      inverse: true,
    })
    expect(getDimensionAngleSelection([-1, -0.3], clockwiseContext)).toEqual({
      sector: 1,
      inverse: false,
    })
  })

  it('keeps the clicked sector and flips inverse when hovering the opposite side', () => {
    const southLineContext: DimensionAngleDraftContext = {
      line0Id: 10,
      line1Id: 11,
      line0Direction: [1, 0],
      line1Direction: [0, -1],
      vertex: [0, 0],
      baseSelection: {
        sector: 1,
        inverse: true,
      },
    }

    expect(getDimensionAngleSelection([-1, 1], southLineContext)).toEqual({
      sector: 1,
      inverse: false,
    })
  })

  it('builds the labelled angle constraint with sector, inverse, and label position', () => {
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
      inverse: true,
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

describe('dimensionTool distance selection', () => {
  const distanceContext: DimensionDistanceDraftContext = {
    kind: 'pointPoint',
    point0: { type: 'point', id: 1, point: [0, 0] },
    point1: { type: 'point', id: 2, point: [4, 3] },
  }

  it('maps cursor regions to absolute, horizontal, and vertical distance', () => {
    expect(getDimensionDistanceType([2, 5], distanceContext)).toBe(
      'HorizontalDistance'
    )
    expect(getDimensionDistanceType([2, -2], distanceContext)).toBe(
      'HorizontalDistance'
    )
    expect(getDimensionDistanceType([6, 1], distanceContext)).toBe(
      'VerticalDistance'
    )
    expect(getDimensionDistanceType([-2, 1], distanceContext)).toBe(
      'VerticalDistance'
    )
    expect(getDimensionDistanceType([2, 1], distanceContext)).toBe('Distance')
    expect(getDimensionDistanceType([6, 5], distanceContext)).toBe('Distance')
  })

  it('builds the selected distance type with its value and label position', () => {
    expect(
      buildDimensionDistanceConstraint(distanceContext, [2, 5], 'Mm')
    ).toEqual({
      type: 'HorizontalDistance',
      segments: [1, 2],
      distance: { value: 4, units: 'Mm' },
      labelPosition: {
        x: { value: 2, units: 'Mm' },
        y: { value: 5, units: 'Mm' },
      },
      source: {
        expr: '4',
        is_literal: true,
      },
    })
  })

  it('serializes the sketch origin as an ORIGIN constraint segment', () => {
    const originDistanceContext: DimensionDistanceDraftContext = {
      kind: 'pointPoint',
      point0: { type: 'point', id: ORIGIN_TARGET, point: [0, 0] },
      point1: { type: 'point', id: 2, point: [4, 3] },
    }

    expect(
      buildDimensionDistanceConstraint(originDistanceContext, [2, 5], 'Mm')
    ).toMatchObject({
      type: 'HorizontalDistance',
      segments: ['ORIGIN', 2],
      distance: { value: 4, units: 'Mm' },
    })
  })

  it('keeps point-to-line dimensions absolute in every cursor region', () => {
    const pointLineContext: DimensionDistanceDraftContext = {
      kind: 'pointLine',
      point: { type: 'point', id: 1, point: [5, 4] },
      line: { type: 'line', id: 10, clickPoint: [5, 0] },
      distance: 4,
    }

    expect(getDimensionDistanceType([5, 8], pointLineContext)).toBe('Distance')
    expect(
      buildDimensionDistanceConstraint(pointLineContext, [8, 6], 'Mm')
    ).toEqual({
      type: 'Distance',
      segments: [1, 10],
      distance: { value: 4, units: 'Mm' },
      labelPosition: {
        x: { value: 8, units: 'Mm' },
        y: { value: 6, units: 'Mm' },
      },
      source: { expr: '4', is_literal: true },
    })
  })

  it('builds an absolute distance between parallel lines', () => {
    const lineLineContext: DimensionDistanceDraftContext = {
      kind: 'lineLine',
      line0: { type: 'line', id: 10, clickPoint: [5, 0] },
      line1: { type: 'line', id: 11, clickPoint: [5, 4] },
      distance: 4,
    }

    expect(
      buildDimensionDistanceConstraint(lineLineContext, [5, 7], 'Mm')
    ).toEqual({
      type: 'Distance',
      segments: [10, 11],
      distance: { value: 4, units: 'Mm' },
      labelPosition: {
        x: { value: 5, units: 'Mm' },
        y: { value: 7, units: 'Mm' },
      },
      source: { expr: '4', is_literal: true },
    })
  })
})

describe('dimensionTool', () => {
  it.each([
    {
      name: 'circle',
      segment: createCircleApiObject({ id: 10, center: 1, start: 2 }),
      expectedConstraint: {
        type: 'Diameter',
        diameter: { value: 10, units: 'Mm' },
        arc: 10,
        source: { expr: '10', is_literal: true },
      },
    },
    {
      name: 'arc',
      segment: createArcApiObject({ id: 10, center: 1, start: 2, end: 3 }),
      expectedConstraint: {
        type: 'Radius',
        radius: { value: 5, units: 'Mm' },
        arc: 10,
        source: { expr: '5', is_literal: true },
      },
    },
  ])(
    'creates the default $name dimension on the first click',
    async ({ segment, expectedConstraint }) => {
      const sketch = createSketchApiObject({ id: 0 })
      const center = createPointApiObject({ id: 1, x: 0, y: 0 })
      const start = createPointApiObject({ id: 2, x: 3, y: 4 })
      const end = createPointApiObject({ id: 3, x: -3, y: 4 })
      const { actor, sceneInfra, addConstraintMock, events } =
        createParentHarness([sketch, center, start, end, segment])
      const callbacks = vi.mocked(sceneInfra.setCallbacks).mock.calls[0]?.[0]
      if (!callbacks?.onClick) {
        throw new Error('Dimension tool did not register its click callback')
      }

      await callbacks.onClick(createMouseEvent([0, 5]))

      await waitFor(actor, () => addConstraintMock.mock.calls.length === 1)
      await waitFor(actor, () =>
        events.some((event) => event.type === 'update sketch outcome')
      )
      expect(addConstraintMock.mock.calls[0][2]).toEqual(expectedConstraint)
      expect(addConstraintMock.mock.calls[0][4]).toBe(true)
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          'update sketch outcome',
          'clear draft entities',
          'update hovered id',
        ])
      )
    }
  )

  it.each([
    {
      name: 'circle diameter',
      segment: createCircleApiObject({ id: 10, center: 1, start: 2 }),
      constraint: {
        type: 'Diameter',
        diameter: { value: 10, units: 'Mm' },
        arc: 10,
        source: { expr: '10', is_literal: true },
      } satisfies ApiConstraint,
    },
    {
      name: 'arc radius',
      segment: createArcApiObject({ id: 10, center: 1, start: 2, end: 3 }),
      constraint: {
        type: 'Radius',
        radius: { value: 5, units: 'Mm' },
        arc: 10,
        source: { expr: '5', is_literal: true },
      } satisfies ApiConstraint,
    },
    {
      name: 'circle diameter when a radius exists',
      segment: createCircleApiObject({ id: 10, center: 1, start: 2 }),
      constraint: {
        type: 'Radius',
        radius: { value: 5, units: 'Mm' },
        arc: 10,
        source: { expr: '5', is_literal: true },
      } satisfies ApiConstraint,
    },
    {
      name: 'arc radius when a diameter exists',
      segment: createArcApiObject({ id: 10, center: 1, start: 2, end: 3 }),
      constraint: {
        type: 'Diameter',
        diameter: { value: 10, units: 'Mm' },
        arc: 10,
        source: { expr: '10', is_literal: true },
      } satisfies ApiConstraint,
    },
  ])('does not add a duplicate $name', async ({ segment, constraint }) => {
    const sketch = createSketchApiObject({ id: 0 })
    const center = createPointApiObject({ id: 1, x: 0, y: 0 })
    const start = createPointApiObject({ id: 2, x: 3, y: 4 })
    const end = createPointApiObject({ id: 3, x: -3, y: 4 })
    const existingConstraint = createConstraintObject({
      id: 20,
      constraint,
    })
    const { actor, sceneInfra, addConstraintMock, events } =
      createParentHarness([
        sketch,
        center,
        start,
        end,
        segment,
        existingConstraint,
      ])
    const callbacks = vi.mocked(sceneInfra.setCallbacks).mock.calls[0]?.[0]
    if (!callbacks?.onClick || !callbacks.onMove) {
      throw new Error('Dimension tool did not register its callbacks')
    }

    await callbacks.onClick(createMouseEvent([0, 5]))

    await waitFor(actor, () =>
      events.some(
        (event) =>
          event.type === 'update hovered id' &&
          (event.data as { hoveredId?: number } | undefined)?.hoveredId ===
            existingConstraint.id
      )
    )

    expect(addConstraintMock).not.toHaveBeenCalled()
  })

  it('does not add another angle dimension for the same line pair', async () => {
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
    const existingConstraint = createConstraintObject({
      id: 20,
      constraint: {
        type: 'Angle',
        lines: [11, 10],
        angle: { value: 300, units: 'Deg' },
        sector: 3,
        inverse: true,
        source: { expr: '300deg', is_literal: true },
      },
    })
    const { actor, sceneInfra, addConstraintMock, events } =
      createParentHarness(
        [sketch, origin, line0End, line1End, line0, line1, existingConstraint],
        { initialSelectionIds: [10, 11] }
      )
    const callbacks = vi.mocked(sceneInfra.setCallbacks).mock.calls[0]?.[0]
    if (!callbacks?.onClick || !callbacks.onMove) {
      throw new Error('Dimension tool did not register its callbacks')
    }

    const matchingHoverEvents = () =>
      events.filter(
        (event) =>
          event.type === 'update hovered id' &&
          (event.data as { hoveredId?: number } | undefined)?.hoveredId ===
            existingConstraint.id
      )

    toastToolbar.dismiss()
    await callbacks.onMove(createMouseEvent([4, 3]))
    await waitFor(actor, () => matchingHoverEvents().length === 1)
    expect(
      toolbarToastsSignal.value.some(
        (toast) => toast.message === 'That dimension already exists.'
      )
    ).toBe(true)

    await callbacks.onMove(undefined as never)
    await callbacks.onMove(createMouseEvent([4, 3]))
    await waitFor(actor, () => matchingHoverEvents().length === 2)

    await callbacks.onClick(createMouseEvent([4, 3]))
    await waitFor(actor, () => matchingHoverEvents().length === 3)

    expect(addConstraintMock).not.toHaveBeenCalled()
  })

  it('skips a duplicate line length while allowing another distance type', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const lineStart = createPointApiObject({ id: 1, x: 0, y: 0 })
    const lineEnd = createPointApiObject({ id: 2, x: 4, y: 3 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const existingConstraint = createConstraintObject({
      id: 20,
      constraint: {
        type: 'Distance',
        segments: [1, 2],
        distance: { value: 5, units: 'Mm' },
        source: { expr: '5', is_literal: true },
      },
    })
    const { actor, sceneInfra, addConstraintMock, events } =
      createParentHarness([
        sketch,
        lineStart,
        lineEnd,
        line,
        existingConstraint,
      ])
    const callbacks = vi.mocked(sceneInfra.setCallbacks).mock.calls[0]?.[0]
    if (!callbacks?.onClick || !callbacks.onMove) {
      throw new Error('Dimension tool did not register its callbacks')
    }

    await callbacks.onClick(createMouseEvent([2, 1.5]))

    expect(addConstraintMock).not.toHaveBeenCalled()

    await callbacks.onMove(createMouseEvent([2, 5]))
    await waitFor(actor, () => addConstraintMock.mock.calls.length === 1)
    expect(addConstraintMock.mock.calls[0][2]).toMatchObject({
      type: 'HorizontalDistance',
      segments: [1, 2],
    })
    expect(
      events.filter((event) => event.type === 'update hovered id').at(-1)?.data
    ).toEqual({ hoveredId: null })
  })

  it('removes a draft when its dimension type changes to a duplicate', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const point0 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const point1 = createPointApiObject({ id: 2, x: 4, y: 3 })
    const existingConstraint = createConstraintObject({
      id: 20,
      constraint: {
        type: 'HorizontalDistance',
        segments: [1, 2],
        distance: { value: 4, units: 'Mm' },
        source: { expr: '4', is_literal: true },
      },
    })
    const { actor, sceneInfra, addConstraintMock, deleteObjectsMock } =
      createParentHarness([sketch, point0, point1, existingConstraint], {
        initialSelectionIds: [1, 2],
      })
    const callbacks = vi.mocked(sceneInfra.setCallbacks).mock.calls[0]?.[0]
    if (!callbacks?.onMove) {
      throw new Error('Dimension tool did not register its move callback')
    }

    await callbacks.onMove(createMouseEvent([2, 1.5]))
    await waitFor(actor, () => addConstraintMock.mock.calls.length === 1)
    expect(addConstraintMock.mock.calls[0][2]).toMatchObject({
      type: 'Distance',
      segments: [1, 2],
    })

    await callbacks.onMove(createMouseEvent([2, 5]))
    await waitFor(actor, () => deleteObjectsMock.mock.calls.length === 1)

    expect(deleteObjectsMock.mock.calls[0][2]).toEqual([30])
    expect(addConstraintMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'a duplicate click followed by escape',
      clickPoint: [2, 5] as Coords2d,
      expectedConstraintType: null,
      escape: true,
    },
    {
      name: 'a permitted dimension click',
      clickPoint: [6, 1.5] as Coords2d,
      expectedConstraintType: 'VerticalDistance',
      escape: false,
    },
  ])('serializes draft cleanup during $name', async (testCase) => {
    const sketch = createSketchApiObject({ id: 0 })
    const point0 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const point1 = createPointApiObject({ id: 2, x: 4, y: 3 })
    const existingConstraint = createConstraintObject({
      id: 20,
      constraint: {
        type: 'HorizontalDistance',
        segments: [1, 2],
        distance: { value: 4, units: 'Mm' },
        source: { expr: '4', is_literal: true },
      },
    })
    const { actor, sceneInfra, addConstraintMock, deleteObjectsMock, events } =
      createParentHarness([sketch, point0, point1, existingConstraint], {
        initialSelectionIds: [1, 2],
      })
    const callbacks = vi.mocked(sceneInfra.setCallbacks).mock.calls[0]?.[0]
    if (!callbacks?.onClick || !callbacks.onMove) {
      throw new Error('Dimension tool did not register its callbacks')
    }
    const deleteObjects = deleteObjectsMock.getMockImplementation()
    if (!deleteObjects) {
      throw new Error('Delete objects mock has no implementation')
    }
    let finishDelete: () => void = () => {
      throw new Error('Delete objects mock was not called')
    }
    deleteObjectsMock.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        finishDelete = resolve
      })
      return deleteObjects(...args)
    })

    await callbacks.onMove(createMouseEvent([2, 1.5]))
    await waitFor(actor, () => addConstraintMock.mock.calls.length === 1)
    toastToolbar.dismiss()
    await callbacks.onMove(createMouseEvent([2, 5]))
    await waitFor(actor, () => deleteObjectsMock.mock.calls.length === 1)

    await callbacks.onClick(createMouseEvent(testCase.clickPoint))
    expect(deleteObjectsMock).toHaveBeenCalledTimes(1)
    if (testCase.escape) {
      const childTool = actor.getSnapshot().children.childTool
      if (!childTool) {
        throw new Error('Dimension tool child actor was not started')
      }
      childTool.send({ type: 'escape' })
      expect(
        events.some((event) => event.type === 'delete draft entities')
      ).toBe(false)
    }

    finishDelete()
    if (testCase.expectedConstraintType) {
      await waitFor(actor, () => addConstraintMock.mock.calls.length === 2)
      expect(addConstraintMock.mock.calls[1][2]).toMatchObject({
        type: testCase.expectedConstraintType,
        segments: [1, 2],
      })
      expect(addConstraintMock.mock.calls[1][4]).toBe(true)
    } else {
      await waitFor(actor, () =>
        events.some((event) => event.type === 'clear draft entities')
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(
        events.some(
          (event) =>
            event.type === 'update hovered id' &&
            (event.data as { hoveredId?: number } | undefined)?.hoveredId ===
              existingConstraint.id
        )
      ).toBe(false)
      expect(
        toolbarToastsSignal.value.some(
          (toast) => toast.message === 'That dimension already exists.'
        )
      ).toBe(false)
    }
  })

  it.each([
    { name: 'deleting a duplicate draft', action: 'duplicate' },
    { name: 'handling escape cleanup', action: 'escape' },
  ])('waits for a preview edit before $name', async ({ action }) => {
    const sketch = createSketchApiObject({ id: 0 })
    const point0 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const point1 = createPointApiObject({ id: 2, x: 4, y: 3 })
    const existingConstraint = createConstraintObject({
      id: 20,
      constraint: {
        type: 'Distance',
        segments: [1, 2],
        distance: { value: 5, units: 'Mm' },
        source: { expr: '5', is_literal: true },
      },
    })
    const {
      actor,
      sceneInfra,
      addConstraintMock,
      editDistanceConstraintMock,
      deleteObjectsMock,
      events,
    } = createParentHarness([sketch, point0, point1, existingConstraint], {
      initialSelectionIds: [1, 2],
    })
    const callbacks = vi.mocked(sceneInfra.setCallbacks).mock.calls[0]?.[0]
    if (!callbacks?.onClick || !callbacks.onMove) {
      throw new Error('Dimension tool did not register its callbacks')
    }
    const editDistanceConstraint =
      editDistanceConstraintMock.getMockImplementation()
    if (!editDistanceConstraint) {
      throw new Error('Edit distance constraint mock has no implementation')
    }
    let finishEdit: () => void = () => {
      throw new Error('Edit distance constraint mock was not called')
    }
    editDistanceConstraintMock.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        finishEdit = resolve
      })
      return editDistanceConstraint(...args)
    })

    await callbacks.onMove(createMouseEvent([2, 5]))
    await waitFor(actor, () => addConstraintMock.mock.calls.length === 1)
    await callbacks.onMove(createMouseEvent([6, 1.5]))
    await waitFor(
      actor,
      () => editDistanceConstraintMock.mock.calls.length === 1
    )

    if (action === 'duplicate') {
      await callbacks.onClick(createMouseEvent([2, 1.5]))
    } else {
      const childTool = actor.getSnapshot().children.childTool
      if (!childTool) {
        throw new Error('Dimension tool child actor was not started')
      }
      childTool.send({ type: 'escape' })
    }
    expect(deleteObjectsMock).not.toHaveBeenCalled()
    expect(events.some((event) => event.type === 'delete draft entities')).toBe(
      false
    )

    finishEdit()
    if (action === 'duplicate') {
      await waitFor(actor, () => deleteObjectsMock.mock.calls.length === 1)
      expect(deleteObjectsMock.mock.calls[0][2]).toEqual([30])
    } else {
      await waitFor(actor, () =>
        events.some((event) => event.type === 'delete draft entities')
      )
      expect(deleteObjectsMock).not.toHaveBeenCalled()
    }
    expect(addConstraintMock).toHaveBeenCalledTimes(1)
  })

  it('starts a smart line-length draft on the first unmodified click', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const lineStart = createPointApiObject({ id: 1, x: 0, y: 0 })
    const lineEnd = createPointApiObject({ id: 2, x: 4, y: 3 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const { actor, sceneInfra, addConstraintMock, editDistanceConstraintMock } =
      createParentHarness([sketch, lineStart, lineEnd, line])
    const callbacks = vi.mocked(sceneInfra.setCallbacks).mock.calls[0]?.[0]
    if (!callbacks?.onClick || !callbacks.onMove) {
      throw new Error('Dimension tool did not register its callbacks')
    }

    await callbacks.onClick(createMouseEvent([2, 1.5]))

    await waitFor(actor, () => addConstraintMock.mock.calls.length === 1)
    expect(addConstraintMock.mock.calls[0][2]).toMatchObject({
      type: 'Distance',
      segments: [1, 2],
      distance: { value: 5, units: 'Mm' },
    })

    await callbacks.onMove(createMouseEvent([2, 5]))
    await waitFor(
      actor,
      () => editDistanceConstraintMock.mock.calls.length === 1
    )
    expect(editDistanceConstraintMock.mock.calls[0][3]).toMatchObject({
      type: 'HorizontalDistance',
      segments: [1, 2],
      distance: { value: 4, units: 'Mm' },
    })

    await callbacks.onMove(createMouseEvent([6, 1]))
    await waitFor(
      actor,
      () => editDistanceConstraintMock.mock.calls.length === 2
    )
    expect(editDistanceConstraintMock.mock.calls[1][3]).toMatchObject({
      type: 'VerticalDistance',
      segments: [1, 2],
      distance: { value: 3, units: 'Mm' },
    })

    await callbacks.onClick(createMouseEvent([6, 1]))
    await waitFor(
      actor,
      () => editDistanceConstraintMock.mock.calls.length === 3
    )
    const commitCall = editDistanceConstraintMock.mock.calls[2]
    expect(commitCall[3].type).toBe('VerticalDistance')
    expect(commitCall[5]).toBe(true)
    expect(commitCall[6]).toBe(true)
  })

  it('creates a distance draft after selecting the origin and a point', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const point = createPointApiObject({ id: 2, x: 4, y: 3 })
    const { actor, sceneInfra, rustContext } = createParentHarness([
      sketch,
      point,
    ])
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onClick(createMouseEvent([0, 0]))
    callbacks.onClick(createMouseEvent([4, 3]))

    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )
    expect((rustContext.addConstraint as any).mock.calls[0][2]).toMatchObject({
      type: 'Distance',
      segments: ['ORIGIN', 2],
      distance: { value: 5, units: 'Mm' },
    })
  })

  it('creates and edits one smart distance draft after selecting two points', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const point0 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const point1 = createPointApiObject({ id: 2, x: 4, y: 3 })
    const { actor, sceneInfra, rustContext } = createParentHarness([
      sketch,
      point0,
      point1,
    ])
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onClick(createMouseEvent([0, 0]))
    callbacks.onClick(createMouseEvent([4, 3]))

    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )
    expect((rustContext.addConstraint as any).mock.calls[0][2]).toEqual({
      type: 'Distance',
      segments: [1, 2],
      distance: { value: 5, units: 'Mm' },
      labelPosition: {
        x: { value: 4, units: 'Mm' },
        y: { value: 3, units: 'Mm' },
      },
      source: { expr: '5', is_literal: true },
    })

    callbacks.onMove(createMouseEvent([2, 5]))
    await waitFor(
      actor,
      () => (rustContext.editDistanceConstraint as any).mock.calls.length === 1
    )
    expect(
      (rustContext.editDistanceConstraint as any).mock.calls[0][3]
    ).toEqual({
      type: 'HorizontalDistance',
      segments: [1, 2],
      distance: { value: 4, units: 'Mm' },
      labelPosition: {
        x: { value: 2, units: 'Mm' },
        y: { value: 5, units: 'Mm' },
      },
      source: { expr: '4', is_literal: true },
    })

    callbacks.onClick(createMouseEvent([6, 1]))
    await waitFor(
      actor,
      () => (rustContext.editDistanceConstraint as any).mock.calls.length === 2
    )
    expect(
      (rustContext.editDistanceConstraint as any).mock.calls[1][3]
    ).toEqual({
      type: 'VerticalDistance',
      segments: [1, 2],
      distance: { value: 3, units: 'Mm' },
      labelPosition: {
        x: { value: 6, units: 'Mm' },
        y: { value: 1, units: 'Mm' },
      },
      source: { expr: '3', is_literal: true },
    })
    expect((rustContext.addConstraint as any).mock.calls).toHaveLength(1)
    expect((rustContext.deleteObjects as any).mock.calls).toHaveLength(0)
  })

  async function expectPointLineDraft(
    clicks: [Coords2d, Coords2d],
    { shiftFirst = false }: { shiftFirst?: boolean } = {}
  ) {
    const sketch = createSketchApiObject({ id: 0 })
    const lineStart = createPointApiObject({ id: 1, x: 0, y: 0 })
    const lineEnd = createPointApiObject({ id: 2, x: 10, y: 0 })
    const point = createPointApiObject({ id: 3, x: 5, y: 4 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const { actor, sceneInfra, rustContext } = createParentHarness([
      sketch,
      lineStart,
      lineEnd,
      point,
      line,
    ])
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onClick(createMouseEvent(clicks[0], { shiftKey: shiftFirst }))
    callbacks.onClick(createMouseEvent(clicks[1]))

    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )
    expect((rustContext.addConstraint as any).mock.calls[0][2]).toMatchObject({
      type: 'Distance',
      segments: [3, 10],
      distance: { value: 4, units: 'Mm' },
    })
  }

  it('creates a point-to-line draft after selecting a point then a line', async () => {
    await expectPointLineDraft([
      [5, 4],
      [5, 0],
    ])
  })

  it('creates a point-to-line draft after selecting a line then a point', async () => {
    await expectPointLineDraft(
      [
        [5, 0],
        [5, 4],
      ],
      { shiftFirst: true }
    )
  })

  it('creates a distance draft after selecting two parallel lines', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const line0Start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const line0End = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line1Start = createPointApiObject({ id: 3, x: 0, y: 4 })
    const line1End = createPointApiObject({ id: 4, x: 10, y: 4 })
    const line0 = createLineApiObject({ id: 10, start: 1, end: 2 })
    const line1 = createLineApiObject({ id: 11, start: 3, end: 4 })
    const { actor, sceneInfra, rustContext, addConstraintMock } =
      createParentHarness([
        sketch,
        line0Start,
        line0End,
        line1Start,
        line1End,
        line0,
        line1,
      ])
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onClick(createMouseEvent([5, 0], { shiftKey: true }))
    expect(addConstraintMock).not.toHaveBeenCalled()
    callbacks.onClick(createMouseEvent([5, 4]))

    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )
    expect((rustContext.addConstraint as any).mock.calls[0][2]).toMatchObject({
      type: 'Distance',
      segments: [10, 11],
      distance: { value: 4, units: 'Mm' },
    })
  })

  it.each([
    {
      clicks: [
        [5, 0],
        [5, 4],
      ] as [Coords2d, Coords2d],
      segments: [10, 11],
    },
    {
      clicks: [
        [5, 4],
        [5, 0],
      ] as [Coords2d, Coords2d],
      segments: [11, 10],
    },
  ])(
    'creates a distance draft for nearly anti-parallel lines selected as $segments',
    async ({ clicks, segments }) => {
      const sketch = createSketchApiObject({ id: 0 })
      const line0Start = createPointApiObject({ id: 1, x: 0, y: 0 })
      const line0End = createPointApiObject({ id: 2, x: 10, y: 0 })
      const line1Start = createPointApiObject({ id: 3, x: 10, y: 4 })
      const line1End = createPointApiObject({
        id: 4,
        x: 0,
        y: 4.00000005,
      })
      const line0 = createLineApiObject({ id: 10, start: 1, end: 2 })
      const line1 = createLineApiObject({ id: 11, start: 3, end: 4 })
      const { actor, sceneInfra, rustContext } = createParentHarness([
        sketch,
        line0Start,
        line0End,
        line1Start,
        line1End,
        line0,
        line1,
      ])
      const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

      callbacks.onClick(createMouseEvent(clicks[0], { shiftKey: true }))
      callbacks.onClick(createMouseEvent(clicks[1]))

      await waitFor(
        actor,
        () => (rustContext.addConstraint as any).mock.calls.length === 1
      )
      expect((rustContext.addConstraint as any).mock.calls[0][2]).toMatchObject(
        {
          type: 'Distance',
          segments,
          distance: { value: 4, units: 'Mm' },
        }
      )
    }
  )

  it('starts distance placement when initialized with two selected points', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const point0 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const point1 = createPointApiObject({ id: 2, x: 4, y: 3 })
    const { actor, sceneInfra, rustContext } = createParentHarness(
      [sketch, point0, point1],
      { initialSelectionIds: [1, 2] }
    )
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onMove(createMouseEvent([2, 5]))
    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )

    expect((rustContext.addConstraint as any).mock.calls[0][2].type).toBe(
      'HorizontalDistance'
    )
  })

  it('keeps entities selected after picking them and committing when requested', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const point0 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const point1 = createPointApiObject({ id: 2, x: 4, y: 3 })
    const { actor, sceneInfra, rustContext, events } = createParentHarness(
      [sketch, point0, point1],
      { keepSelection: true }
    )
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onClick(createMouseEvent([0, 0]))
    callbacks.onClick(createMouseEvent([4, 3]))
    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )

    callbacks.onClick(createMouseEvent([2, 5]))
    await waitFor(
      actor,
      () =>
        events.filter((event) => event.type === 'update selected ids')
          .length === 3
    )

    expect((rustContext.editDistanceConstraint as any).mock.calls).toHaveLength(
      1
    )
    const selectionUpdates = events.filter(
      (event) => event.type === 'update selected ids'
    )
    expect(selectionUpdates.at(-1)?.data).toEqual({
      duringAreaSelectIds: [],
    })
  })

  it('starts distance placement with a preselected origin and point', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const point = createPointApiObject({ id: 2, x: 4, y: 3 })
    const { actor, sceneInfra, rustContext } = createParentHarness(
      [sketch, point],
      { initialSelectionIds: [ORIGIN_TARGET, 2] }
    )
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onMove(createMouseEvent([2, 5]))
    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )

    expect((rustContext.addConstraint as any).mock.calls[0][2]).toMatchObject({
      type: 'HorizontalDistance',
      segments: ['ORIGIN', 2],
      distance: { value: 4, units: 'Mm' },
    })
  })

  it('starts label placement when initialized with a selected point and line', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const lineStart = createPointApiObject({ id: 1, x: 0, y: 0 })
    const lineEnd = createPointApiObject({ id: 2, x: 10, y: 0 })
    const point = createPointApiObject({ id: 3, x: 5, y: 4 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const { actor, sceneInfra, rustContext } = createParentHarness(
      [sketch, lineStart, lineEnd, point, line],
      {
        initialSelectionIds: [10, 3],
        initialSelectionCoordinates: { 10: [5, 0] },
      }
    )
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onMove(createMouseEvent([8, 6]))
    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )

    expect((rustContext.addConstraint as any).mock.calls[0][2]).toMatchObject({
      type: 'Distance',
      segments: [3, 10],
      distance: { value: 4, units: 'Mm' },
      labelPosition: {
        x: { value: 8, units: 'Mm' },
        y: { value: 6, units: 'Mm' },
      },
    })
  })

  it('starts distance placement when initialized with two parallel lines', async () => {
    const sketch = createSketchApiObject({ id: 0 })
    const line0Start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const line0End = createPointApiObject({ id: 2, x: 10, y: 0 })
    const line1Start = createPointApiObject({ id: 3, x: 0, y: 4 })
    const line1End = createPointApiObject({ id: 4, x: 10, y: 4 })
    const line0 = createLineApiObject({ id: 10, start: 1, end: 2 })
    const line1 = createLineApiObject({ id: 11, start: 3, end: 4 })
    const { actor, sceneInfra, rustContext } = createParentHarness(
      [sketch, line0Start, line0End, line1Start, line1End, line0, line1],
      {
        initialSelectionIds: [10, 11],
        initialSelectionCoordinates: { 10: [5, 0], 11: [5, 4] },
      }
    )
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onMove(createMouseEvent([5, 7]))
    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )

    expect((rustContext.addConstraint as any).mock.calls[0][2]).toMatchObject({
      type: 'Distance',
      segments: [10, 11],
      distance: { value: 4, units: 'Mm' },
      labelPosition: {
        x: { value: 5, units: 'Mm' },
        y: { value: 7, units: 'Mm' },
      },
    })
  })

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

    callbacks.onClick(createMouseEvent([8, 0], { shiftKey: true }))
    callbacks.onClick(createMouseEvent([2.5, 4.330127018922193]))

    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )

    expect((rustContext.addConstraint as any).mock.calls[0][2]).toEqual({
      type: 'Angle',
      lines: [10, 11],
      angle: { value: 60, units: 'Deg' },
      sector: 1,
      inverse: false,
      labelPosition: {
        x: { value: 2.5, units: 'Mm' },
        y: { value: 4.33, units: 'Mm' },
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
    callbacks.onClick(createMouseEvent([4, 3]))

    await waitFor(
      actor,
      () => (rustContext.editAngleConstraint as any).mock.calls.length === 1
    )
    await waitFor(actor, () =>
      events.some(
        (event) =>
          event.type === 'update hovered id' &&
          (event.data as { hoveredId?: number } | undefined)?.hoveredId === 30
      )
    )

    expect((rustContext.addConstraint as any).mock.calls).toHaveLength(1)
    expect((rustContext.editAngleConstraint as any).mock.calls[0]).toEqual([
      0,
      0,
      30,
      {
        type: 'Angle',
        lines: [10, 11],
        angle: { value: 60, units: 'Deg' },
        sector: 1,
        inverse: false,
        labelPosition: {
          x: { value: 4, units: 'Mm' },
          y: { value: 3, units: 'Mm' },
        },
        source: {
          expr: '60deg',
          is_literal: true,
        },
      },
      expect.any(Object),
      true,
      true,
    ])
    expect(events).toContainEqual({
      type: 'update selected ids',
      data: {
        selectedIds: [],
        duringAreaSelectIds: [],
      },
    })
    expect(events).toContainEqual({
      type: 'update hovered id',
      data: { hoveredId: 30 },
    })
  })

  it('edits the existing draft angle constraint while moving the cursor', async () => {
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
    const { actor, sceneInfra, rustContext } = createParentHarness(objects)
    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]

    callbacks.onClick(createMouseEvent([8, 0], { shiftKey: true }))
    callbacks.onClick(createMouseEvent([2.5, 4.330127018922193]))

    await waitFor(
      actor,
      () => (rustContext.addConstraint as any).mock.calls.length === 1
    )

    callbacks.onMove(createMouseEvent([0, 10]))

    await waitFor(
      actor,
      () => (rustContext.editAngleConstraint as any).mock.calls.length === 1
    )

    expect((rustContext.addConstraint as any).mock.calls).toHaveLength(1)
    expect((rustContext.deleteObjects as any).mock.calls).toHaveLength(0)
    const editCall = (rustContext.editAngleConstraint as any).mock.calls[0]
    expect(editCall[2]).toBe(30)
    expect(editCall[3]).toEqual({
      type: 'Angle',
      lines: [10, 11],
      angle: { value: 120, units: 'Deg' },
      sector: 2,
      inverse: false,
      labelPosition: {
        x: { value: 0, units: 'Mm' },
        y: { value: 10, units: 'Mm' },
      },
      source: {
        expr: '120deg',
        is_literal: true,
      },
    })
    expect(editCall[5]).toBe(false)
    expect(editCall[6]).toBe(false)
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
      inverse: true,
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
        selectionCoordinates: {
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
