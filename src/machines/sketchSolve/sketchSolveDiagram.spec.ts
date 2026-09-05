import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { KclManager } from '@src/lang/KclManager'
import { Themes } from '@src/lib/theme'
import { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import { CHILD_TOOL_DONE_EVENT } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  createArcApiObject,
  createCircleApiObject,
  createLineApiObject,
  createMockRustContext,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { Group, OrthographicCamera } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

const startedActors: Array<{ stop: () => void }> = []

afterEach(() => {
  for (const actor of startedActors) {
    actor.stop()
  }
  startedActors.length = 0
  vi.restoreAllMocks()
})

function createSketchApiObject({
  id,
  segments,
}: {
  id: number
  segments: number[]
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      plane: 0,
      segments,
      constraints: [],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function createHorizontalConstraintApiObject(
  id: number,
  line: number
): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint: { type: 'Horizontal', line },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function createConstraintApiObject(
  id: number,
  constraint: ApiConstraint
): ApiObject {
  return {
    id,
    kind: { type: 'Constraint', constraint },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function addConstraintLineHitObject(
  scene: Group,
  constraintId: number,
  line: [[number, number], [number, number]]
) {
  const existingGroup = scene.getObjectByName(String(constraintId))
  const constraintGroup =
    existingGroup instanceof Group ? existingGroup : new Group()
  constraintGroup.name = String(constraintId)
  constraintGroup.visible = true
  const hitObject = new Group()
  hitObject.userData.hitObjects = [{ type: 'line', line }]
  constraintGroup.add(hitObject)
  if (!existingGroup) {
    scene.add(constraintGroup)
  }
}

function createSketchSolveHarness(objects: ApiObject[] = []) {
  const scene = new Group()
  const sketchSolveGroup = new Group()
  sketchSolveGroup.name = SKETCH_SOLVE_GROUP
  scene.add(sketchSolveGroup)

  const getPlaneIntersectPoint = vi.fn<
    () => { twoD: { x: number; y: number } } | null
  >(() => null)
  const camera = new OrthographicCamera(-100, 100, 100, -100, 0.1, 1000)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  const sceneInfra = {
    scene,
    camControls: { camera },
    renderer: {
      domElement: { clientWidth: 800, clientHeight: 600 },
    },
    setCallbacks: vi.fn(),
    setOnBeforeRender: vi.fn(),
    getClientSceneScaleFactor: vi.fn(() => 1),
    getPlaneIntersectPoint,
    isAreaSelectActive: false,
    theme: Themes.Light,
  }
  const rustContext = createMockRustContext()
  const addConstraintMock = vi.fn(
    async (..._args: Parameters<typeof rustContext.addConstraint>) => {
      throw new Error('Unexpected add constraint call')
    }
  )
  rustContext.addConstraint = addConstraintMock
  const pointToUnit = vi.fn(
    (point: string) => JSON.parse(point) as [number, number]
  )
  const kclManager = {
    code: 'sketch001 = startSketchOn(XY)',
    editorView: {
      dispatch: vi.fn(),
    },
    fileSettings: {
      defaultLengthUnit: 'Mm',
    },
    sceneInfra,
    sceneEntitiesManager: {
      initSketchSolveEntityOrientation: vi.fn(),
    },
    rustContext,
    setHighlightRange: vi.fn(),
    setSketchSolveDiagnostics: vi.fn(),
    syncSketchSolveOutcome: vi.fn(),
    updateCodeEditor: vi.fn(),
    wasmInstancePromise: Promise.resolve({ point_to_unit: pointToUnit }),
    systemDeps: {
      settings: {},
    },
  }

  const actor = createActor(
    sketchSolveMachine.provide({
      actions: {
        'send tool equipped to parent': () => {},
        'send tool unequipped to parent': () => {},
      },
    }),
    {
      input: {
        kclManager: kclManager as unknown as KclManager,
        initialSketchSolvePlane: null,
        sketchId: 0,
        initialSceneGraphDelta: createSceneGraphDelta(objects),
      },
    }
  ).start()
  startedActors.push(actor)

  return {
    actor,
    addConstraintMock,
    getPlaneIntersectPoint,
    pointToUnit,
    rustContext,
    scene,
  }
}

describe('sketchSolveMachine duplicate dimensions', () => {
  it('does not add a preselected line length that already exists', async () => {
    const point0 = createPointApiObject({ id: 1, x: 0, y: 0 })
    const point1 = createPointApiObject({ id: 2, x: 4, y: 3 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const dimension = createConstraintApiObject(20, {
      type: 'Distance',
      segments: [1, 2],
      distance: { value: 5, units: 'Mm' },
      source: { expr: '5', is_literal: true },
    })
    const { actor, addConstraintMock, pointToUnit } = createSketchSolveHarness([
      point0,
      point1,
      line,
      dimension,
    ])

    actor.send({ type: 'update selected ids', data: { selectedIds: [10] } })
    actor.send({ type: 'Dimension' })

    await vi.waitFor(() => expect(pointToUnit).toHaveBeenCalledTimes(4))
    expect(addConstraintMock).not.toHaveBeenCalled()
  })

  it('does not add a preselected circle diameter that already exists', async () => {
    const center = createPointApiObject({ id: 1, x: 0, y: 0 })
    const start = createPointApiObject({ id: 2, x: 3, y: 4 })
    const circle = createCircleApiObject({ id: 10, center: 1, start: 2 })
    const dimension = createConstraintApiObject(20, {
      type: 'Diameter',
      arc: 10,
      diameter: { value: 10, units: 'Mm' },
      source: { expr: '10', is_literal: true },
    })
    const { actor, addConstraintMock, pointToUnit } = createSketchSolveHarness([
      center,
      start,
      circle,
      dimension,
    ])

    actor.send({ type: 'update selected ids', data: { selectedIds: [10] } })
    actor.send({ type: 'Dimension' })

    await vi.waitFor(() => expect(pointToUnit).toHaveBeenCalledTimes(4))
    expect(addConstraintMock).not.toHaveBeenCalled()
  })
})

describe('sketchSolveMachine selection clearing', () => {
  it('clears the selection when an equipped child tool completes', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { actor } = createSketchSolveHarness()

    actor.send({ type: 'equip tool', data: { tool: 'dimensionTool' } })
    expect(actor.getSnapshot().matches('using tool')).toBe(true)

    actor.send({
      type: 'update selected ids',
      data: { selectedIds: [10], duringAreaSelectIds: [11] },
    })
    expect(actor.getSnapshot().context.selectedIds).toEqual([10])
    expect(actor.getSnapshot().context.duringAreaSelectIds).toEqual([11])

    actor.send({ type: CHILD_TOOL_DONE_EVENT })

    expect(actor.getSnapshot().matches('move and select')).toBe(true)
    expect(actor.getSnapshot().context.selectedIds).toEqual([])
    expect(actor.getSnapshot().context.duringAreaSelectIds).toEqual([])
  })

  it('keeps the selection when the equipped child tool requests it', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { actor } = createSketchSolveHarness()

    actor.send({
      type: 'equip tool',
      data: { tool: 'dimensionTool' },
      keepSelection: true,
    })
    actor.send({
      type: 'update selected ids',
      data: { selectedIds: [10], duringAreaSelectIds: [11] },
    })

    actor.send({ type: CHILD_TOOL_DONE_EVENT })

    expect(actor.getSnapshot().matches('move and select')).toBe(true)
    expect(actor.getSnapshot().context.selectedIds).toEqual([10])
    expect(actor.getSnapshot().context.duringAreaSelectIds).toEqual([])
  })

  it('clears the selection when constraint editing stops', () => {
    const { actor } = createSketchSolveHarness()

    actor.send({
      type: 'update selected ids',
      data: { selectedIds: [12], duringAreaSelectIds: [13] },
    })
    actor.send({
      type: 'start editing constraint',
      data: { constraintId: 12 },
    })

    actor.send({ type: 'stop editing constraint' })

    expect(actor.getSnapshot().context.editingConstraintId).toBeUndefined()
    expect(actor.getSnapshot().context.selectedIds).toEqual([])
    expect(actor.getSnapshot().context.duringAreaSelectIds).toEqual([])
  })
})

describe('sketchSolveMachine hovered tool picker', () => {
  it('equips the point tool over a standalone point', () => {
    const objects = [
      createSketchApiObject({ id: 0, segments: [1] }),
      createPointApiObject({ id: 1, x: 10, y: 10 }),
    ]
    const { actor, getPlaneIntersectPoint } = createSketchSolveHarness(objects)
    getPlaneIntersectPoint.mockReturnValue({ twoD: { x: 10, y: 10 } })

    actor.send({ type: 'pick hovered tool' })

    expect(actor.getSnapshot().matches('using tool')).toBe(true)
    expect(actor.getSnapshot().context.sketchSolveToolName).toBe('pointTool')
  })

  it('equips the line under the cursor and leaves the active line tool alone', () => {
    const objects = [
      createSketchApiObject({ id: 0, segments: [1, 2, 3] }),
      createPointApiObject({ id: 1, x: -20, y: 0, owner: 3 }),
      createPointApiObject({ id: 2, x: 20, y: 0, owner: 3 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
    ]
    const { actor, getPlaneIntersectPoint } = createSketchSolveHarness(objects)
    getPlaneIntersectPoint.mockReturnValue({ twoD: { x: 0, y: 0 } })

    actor.send({ type: 'pick hovered tool' })

    expect(actor.getSnapshot().matches('using tool')).toBe(true)
    expect(actor.getSnapshot().context.sketchSolveToolName).toBe('lineTool')
    const childTool = actor.getSnapshot().context.childTool

    actor.send({ type: 'pick hovered tool' })

    expect(actor.getSnapshot().context.childTool).toBe(childTool)
  })

  it('equips the circle under the cursor', () => {
    const objects = [
      createSketchApiObject({ id: 0, segments: [1, 2, 3] }),
      createPointApiObject({ id: 1, x: 0, y: 0, owner: 3 }),
      createPointApiObject({ id: 2, x: 10, y: 0, owner: 3 }),
      createCircleApiObject({ id: 3, center: 1, start: 2 }),
    ]
    const { actor, getPlaneIntersectPoint } = createSketchSolveHarness(objects)
    getPlaneIntersectPoint.mockReturnValue({ twoD: { x: 0, y: 10 } })

    actor.send({ type: 'pick hovered tool' })

    expect(actor.getSnapshot().matches('using tool')).toBe(true)
    expect(actor.getSnapshot().context.sketchSolveToolName).toBe('circleTool')
  })

  it('equips the center arc tool over an arc', () => {
    const objects = [
      createSketchApiObject({ id: 0, segments: [1, 2, 3, 4] }),
      createPointApiObject({ id: 1, x: 0, y: 0, owner: 4 }),
      createPointApiObject({ id: 2, x: 10, y: 0, owner: 4 }),
      createPointApiObject({ id: 3, x: 0, y: 10, owner: 4 }),
      createArcApiObject({ id: 4, center: 1, start: 2, end: 3 }),
    ]
    const { actor, getPlaneIntersectPoint } = createSketchSolveHarness(objects)
    getPlaneIntersectPoint.mockReturnValue({
      twoD: { x: Math.SQRT1_2 * 10, y: Math.SQRT1_2 * 10 },
    })

    actor.send({ type: 'pick hovered tool' })

    expect(actor.getSnapshot().matches('using tool')).toBe(true)
    expect(actor.getSnapshot().context.sketchSolveToolName).toBe(
      'centerArcTool'
    )
  })

  it('unequips at a draft endpoint after excluding draft geometry', async () => {
    const objects = [
      createSketchApiObject({ id: 0, segments: [1, 2, 3] }),
      createPointApiObject({ id: 1, x: -20, y: 0, owner: 3 }),
      createPointApiObject({ id: 2, x: 20, y: 0, owner: 3 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
    ]
    const { actor, getPlaneIntersectPoint } = createSketchSolveHarness(objects)
    getPlaneIntersectPoint.mockReturnValue({ twoD: { x: 20, y: 0 } })
    actor.send({ type: 'pick hovered tool' })
    actor.send({
      type: 'set draft entities',
      data: { segmentIds: [3], constraintIds: [] },
    })

    actor.send({ type: 'pick hovered tool' })

    await vi.waitFor(() => {
      expect(actor.getSnapshot().matches('move and select')).toBe(true)
    })
    expect(actor.getSnapshot().context.sketchSolveToolName).toBeNull()
  })

  it('force-equips a hovered constraint tool instead of constraining a draft line', async () => {
    const objects = [
      createSketchApiObject({ id: 0, segments: [1, 2, 3, 4, 5, 6] }),
      createPointApiObject({ id: 1, x: -20, y: 20, owner: 3 }),
      createPointApiObject({ id: 2, x: 20, y: 20, owner: 3 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      createPointApiObject({ id: 4, x: -20, y: 0, owner: 6 }),
      createPointApiObject({ id: 5, x: 20, y: 0, owner: 6 }),
      createLineApiObject({ id: 6, start: 4, end: 5 }),
      createHorizontalConstraintApiObject(7, 6),
    ]
    const { actor, getPlaneIntersectPoint, rustContext, scene } =
      createSketchSolveHarness(objects)
    const addConstraintSpy = vi.spyOn(rustContext, 'addConstraint')
    const deleteObjectsSpy = vi.spyOn(rustContext, 'deleteObjects')
    getPlaneIntersectPoint.mockReturnValue({ twoD: { x: 0, y: 0 } })
    actor.send({ type: 'equip tool', data: { tool: 'lineTool' } })
    actor.send({
      type: 'set draft entities',
      data: { segmentIds: [3], constraintIds: [] },
    })
    addConstraintLineHitObject(scene, 7, [
      [-20, 0],
      [20, 0],
    ])

    actor.send({ type: 'pick hovered tool' })

    await vi.waitFor(() => {
      expect(actor.getSnapshot().context.sketchSolveToolName).toBe(
        'horizontalConstraintTool'
      )
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(actor.getSnapshot().matches('using tool')).toBe(true)
    expect(addConstraintSpy).not.toHaveBeenCalled()
    expect(deleteObjectsSpy).not.toHaveBeenCalled()
  })

  it('picks a constraint tool without applying it to the current selection', async () => {
    const objects = [
      createSketchApiObject({ id: 0, segments: [1, 2, 3] }),
      createPointApiObject({ id: 1, x: -20, y: 0, owner: 3 }),
      createPointApiObject({ id: 2, x: 20, y: 0, owner: 3 }),
      createLineApiObject({ id: 3, start: 1, end: 2 }),
      createHorizontalConstraintApiObject(4, 3),
    ]
    const { actor, getPlaneIntersectPoint, rustContext, scene } =
      createSketchSolveHarness(objects)
    const addConstraintSpy = vi.spyOn(rustContext, 'addConstraint')
    const deleteObjectsSpy = vi.spyOn(rustContext, 'deleteObjects')
    getPlaneIntersectPoint.mockReturnValue({ twoD: { x: 0, y: 0 } })
    actor.send({
      type: 'update selected ids',
      data: { selectedIds: [3], duringAreaSelectIds: [] },
    })
    addConstraintLineHitObject(scene, 4, [
      [-20, 0],
      [20, 0],
    ])

    actor.send({ type: 'pick hovered tool' })

    expect(actor.getSnapshot().context.sketchSolveToolName).toBe(
      'horizontalConstraintTool'
    )
    expect(actor.getSnapshot().context.selectedIds).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(addConstraintSpy).not.toHaveBeenCalled()
    expect(deleteObjectsSpy).not.toHaveBeenCalled()
  })
})
