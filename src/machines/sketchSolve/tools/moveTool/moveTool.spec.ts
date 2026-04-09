import { describe, it, expect, vi } from 'vitest'
import { Group, OrthographicCamera, Vector2, Vector3 } from 'three'
import {
  createOnDragStartCallback,
  createOnDragCallback,
  createOnClickCallback,
  setUpOnDragAndSelectionClickCallbacks,
  createOnDragEndCallback,
} from '@src/machines/sketchSolve/tools/moveTool/moveTool'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import type { Themes } from '@src/lib/theme'
import type {
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import { isArray } from '@src/lib/utils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import {
  ORIGIN_TARGET,
  type SketchSolveSelectionId,
  updateSelectedIds,
} from '@src/machines/sketchSolve/sketchSolveImpl'

function createTestMouseEvent(detail = 1): MouseEvent {
  return new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    detail,
  })
}

function createOnClickDeps(objects: ApiObject[] = []) {
  return {
    getApiObjects: () => createSceneGraphDelta(objects).new_graph.objects,
    sceneInfra: {
      scene: {
        getObjectByName: vi.fn(() => null),
      },
      getClientSceneScaleFactor: vi.fn(() => 1),
    } as unknown as SceneInfra,
  }
}

function createConstraintApiObject({
  id,
  type,
}: {
  id: number
  type: 'Distance' | 'Horizontal'
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Constraint',
      constraint:
        type === 'Distance'
          ? {
              type,
              points: [1, 2],
              distance: { value: 10, units: 'Mm' },
              source: {
                expr: '10',
                is_literal: true,
              },
            }
          : {
              type,
              line: 3,
            },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  } as ApiObject
}

function createDraggedEntityIdGetter(entityId: number | null = null) {
  return vi.fn(() => entityId)
}

function createDragSnappingDeps() {
  return {
    sceneInfra: {
      scene: {
        getObjectByName: vi.fn(() => null),
      },
      getClientSceneScaleFactor: vi.fn(() => 1),
    } as unknown as SceneInfra,
    onUpdateDragSnapping: vi.fn(),
    setLastPreviewSegmentsToEdit: vi.fn(),
  }
}

function setUpMoveToolCallbacks({
  apiObjects = [],
  hoveredId = null,
  selectedIds = [],
  isAreaSelectActive = false,
  sketchId = 0,
  showNonVisualConstraints = false,
  constraintHoverPopups = [],
  getSceneObjectByName,
}: {
  apiObjects?: ApiObject[]
  hoveredId?: number | null
  selectedIds?: Array<SketchSolveSelectionId>
  isAreaSelectActive?: boolean
  sketchId?: number
  showNonVisualConstraints?: boolean
  constraintHoverPopups?: Array<{
    segmentId: number
    position: [number, number]
  }>
  getSceneObjectByName?: (name: string) => unknown
}) {
  let callbacks: Record<string, unknown> = {}
  const getObjectByName = vi.fn(
    (name: string) => getSceneObjectByName?.(name) ?? null
  )
  const camera = new OrthographicCamera(-50, 50, 50, -50, 0.1, 1000)
  camera.position.z = 10
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()

  const sceneInfra = {
    setCallbacks: vi.fn((nextCallbacks) => {
      callbacks = nextCallbacks as Record<string, unknown>
    }),
    scene: {
      getObjectByName,
    },
    camControls: { camera },
    renderer: {
      domElement: {
        clientWidth: 100,
        clientHeight: 100,
      },
    },
    getClientSceneScaleFactor: vi.fn(() => 1),
    baseUnitMultiplier: 1,
    isAreaSelectActive,
  } as unknown as SceneInfra

  const sceneGraphObjects = apiObjects.some(
    (obj) => obj.kind.type === 'Sketch' && obj.id === sketchId
  )
    ? apiObjects
    : [createSketchApiObject({ id: sketchId }), ...apiObjects]

  const snapshot = {
    context: {
      hoveredId,
      constraintHoverPopups,
      showNonVisualConstraints,
      selectedIds,
      duringAreaSelectIds: [],
      sketchId,
      draftEntities: undefined,
      sketchExecOutcome: {
        sceneGraphDelta: createSceneGraphDelta(sceneGraphObjects),
      },
    },
  }

  const self = {
    getSnapshot: vi.fn(() => snapshot),
    send: vi.fn((event: any) => {
      if (event.type === 'update hovered id') {
        snapshot.context.hoveredId = event.data.hoveredId
        if ('constraintHoverPopups' in event.data) {
          snapshot.context.constraintHoverPopups =
            event.data.constraintHoverPopups
        }
      }
      if (event.type === 'update selected ids') {
        Object.assign(
          snapshot.context,
          updateSelectedIds({
            context: snapshot.context,
            event,
          } as any)
        )
      }
    }),
  }

  const context = {
    sceneInfra,
    rustContext: {
      editSegments: vi.fn(),
      settingsActor: null,
    },
    kclManager: {
      fileSettings: {
        defaultLengthUnit: 'mm' as UnitLength,
      },
    },
  }

  setUpOnDragAndSelectionClickCallbacks({ self, context } as any)

  if (typeof callbacks.onMove !== 'function') {
    throw new Error('Move tool did not register an onMove callback')
  }
  if (typeof callbacks.onDragStart !== 'function') {
    throw new Error('Move tool did not register an onDragStart callback')
  }
  if (typeof callbacks.onAreaSelect !== 'function') {
    throw new Error('Move tool did not register an onAreaSelect callback')
  }
  if (typeof callbacks.onClick !== 'function') {
    throw new Error('Move tool did not register an onClick callback')
  }

  return {
    onClick: callbacks.onClick as (args: {
      mouseEvent: MouseEvent
      intersectionPoint?: { twoD: Vector2; threeD: Vector3 }
      intersects: Array<unknown>
      selected?: Group
    }) => Promise<void>,
    onMove: callbacks.onMove as (args: {
      intersectionPoint: { twoD: Vector2; threeD: Vector3 }
    }) => void,
    onDragStart: callbacks.onDragStart as (args: {
      intersectionPoint: { twoD: Vector2; threeD: Vector3 }
      mouseEvent: MouseEvent
      intersects: Array<unknown>
      selected?: Group
    }) => void,
    onAreaSelect: callbacks.onAreaSelect as (args: {
      mouseEvent?: MouseEvent
      startPoint: { twoD: Vector2; threeD: Vector3 }
      currentPoint: { twoD: Vector2; threeD: Vector3 }
    }) => void,
    sceneInfra,
    getObjectByName,
    send: self.send,
  }
}

/**
 * Helper function to create a point segment group for testing.
 * Uses the same function that creates point segments in production,
 * ensuring tests match the actual runtime structure.
 */
function createPointSegmentGroup({
  segmentId,
}: {
  segmentId: number
  theme?: Themes
  scale?: number
}): Group {
  const result = segmentUtilsMap.PointSegment.init({
    input: {
      type: 'Point',
      position: {
        x: { type: 'Var', value: 0, units: 'Mm' },
        y: { type: 'Var', value: 0, units: 'Mm' },
      },
    },
    id: segmentId,
    isConstruction: false,
  })
  if (result instanceof Group) {
    return result
  }
  throw new Error('Failed to create point segment group')
}

describe('createOnDragStartCallback', () => {
  it('should track the drag start position, dragged entity id, and dismiss constraint hover popup', () => {
    const setLastSuccessfulDragFromPoint = vi.fn()
    const setDraggedEntityId = vi.fn()
    const setLastPreviewSegmentsToEdit = vi.fn()
    const getHoveredId = vi.fn(() => 13)
    const dismissConstraintHoverPopup = vi.fn()

    const callback = createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggedEntityId,
      setLastPreviewSegmentsToEdit,
      getHoveredId,
      dismissConstraintHoverPopup,
    })

    const intersectionPoint = {
      twoD: new Vector2(10, 20),
      threeD: new Vector3(10, 20, 0),
    }

    void callback({
      intersectionPoint,
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    expect(dismissConstraintHoverPopup).toHaveBeenCalledOnce()
    expect(setLastSuccessfulDragFromPoint).toHaveBeenCalledOnce()
    expect(setLastSuccessfulDragFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({ x: 10, y: 20 })
    )
    // Verify it's a clone (new object)
    const callArg = setLastSuccessfulDragFromPoint.mock.calls[0][0]
    expect(callArg).not.toBe(intersectionPoint.twoD)
    expect(callArg.x).toBe(10)
    expect(callArg.y).toBe(20)
    expect(setDraggedEntityId).toHaveBeenCalledOnce()
    expect(setDraggedEntityId).toHaveBeenCalledWith(13)
    expect(getHoveredId).toHaveBeenCalledOnce()
  })
})

/**
 * Helper function to create an ApiObject representing a point segment for testing.
 * Uses the same structure as production code to ensure tests match runtime behavior.
 */
function createPointApiObject({
  id,
  x = 0,
  y = 0,
  owner = null,
}: {
  id: number
  x?: number
  y?: number
  owner?: number | null
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
        owner,
        freedom: 'Free',
        constraints: [],
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function createArcApiObject({
  id,
  center,
  start,
  end,
}: {
  id: number
  center: number
  start: number
  end: number
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Arc',
        center,
        start,
        end,
        ctor: {
          type: 'Arc',
          center: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
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
        construction: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

function createCircleApiObject({
  id,
  center,
  start,
}: {
  id: number
  center: number
  start: number
}): ApiObject {
  return {
    id,
    kind: {
      type: 'Segment',
      segment: {
        type: 'Circle',
        center,
        start,
        ctor: {
          type: 'Circle',
          center: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          start: {
            x: { type: 'Var', value: 0, units: 'Mm' },
            y: { type: 'Var', value: 0, units: 'Mm' },
          },
          construction: false,
        },
        ctor_applicable: false,
        construction: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

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
        construction: false,
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0], node_path: null },
  }
}

/**
 * Helper function to create a SceneGraphDelta for testing.
 */
// Helper to create a minimal valid SceneGraphDelta for testing
// In tests, we only care about the objects array, so we provide minimal valid values for other fields
// The objects array is indexed by object ID, so we need to create a sparse array
function createSceneGraphDelta(objects: Array<ApiObject>): SceneGraphDelta {
  // Create a sparse array where objects are placed at their ID index
  // This matches how the real code accesses objects: objects[id]
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
    new_objects: [],
    invalidates_ids: false,
    exec_outcome: {
      issues: [],
      variables: {},
      operations: [],
      artifactGraph: { map: {}, itemCount: 0 },
      filenames: {},
      defaultPlanes: null,
    },
  }
}

describe('createOnDragCallback', () => {
  it('should prevent concurrent drag operations to avoid race conditions', async () => {
    const getIsSolveInProgress = vi.fn(() => true) // Already in progress
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter()
    const getContextData = vi.fn(() => ({
      selectedIds: [],
      sketchId: 0,
      sketchExecOutcome: undefined,
    }))
    const editSegments = vi.fn()
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    await callback({
      intersectionPoint: {
        twoD: new Vector2(10, 20),
        threeD: new Vector3(10, 20, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should return early without calling editSegments
    expect(editSegments).not.toHaveBeenCalled()
    expect(setIsSolveInProgress).not.toHaveBeenCalled()
  })

  it('should clear dragged entity id and call onComplete once', async () => {
    const getDraggedEntityId = vi.fn(() => 5)
    const setDraggedEntityId = vi.fn()
    const onComplete = vi.fn(async () => {})

    const callback = createOnDragEndCallback({
      getDraggedEntityId,
      setDraggedEntityId,
      onComplete,
    })

    await callback({
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    expect(setDraggedEntityId).toHaveBeenCalledWith(null)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
  it('should clear dragging state even when no element is currently being dragged', async () => {
    const getDraggedEntityId = vi.fn(() => null)
    const setDraggedEntityId = vi.fn()

    const callback = createOnDragEndCallback({
      getDraggedEntityId,
      setDraggedEntityId,
      onComplete: async () => {},
    })

    await callback({
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should still clear the dragging state even if no element was being dragged
    // This ensures state is always clean after drag ends
    expect(setDraggedEntityId).toHaveBeenCalledWith(null)
  })

  it('should return early when no scene graph delta is available', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter()
    const getContextData = vi.fn(() => ({
      selectedIds: [],
      sketchId: 0,
      sketchExecOutcome: undefined, // No scene graph delta
    }))
    const editSegments = vi.fn()
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    await callback({
      intersectionPoint: {
        twoD: new Vector2(10, 20),
        threeD: new Vector3(10, 20, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should return early without calling editSegments
    expect(editSegments).not.toHaveBeenCalled()
    expect(setIsSolveInProgress).not.toHaveBeenCalled()
  })

  it('should return early when no entity is under cursor and no segments are selected', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter()
    const pointObject = createPointApiObject({ id: 5 })
    const sceneGraphDelta = createSceneGraphDelta([pointObject])
    const getContextData = vi.fn(() => ({
      selectedIds: [], // No selected segments
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    const editSegments = vi.fn()
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    await callback({
      intersectionPoint: {
        twoD: new Vector2(10, 20),
        threeD: new Vector3(10, 20, 0),
      },
      selected: undefined, // No entity under cursor
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should return early - nothing to drag
    expect(editSegments).not.toHaveBeenCalled()
    expect(setIsSolveInProgress).not.toHaveBeenCalled()
  })

  it('should calculate drag vector from last successful drag point to current position', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    // Last successful drag was at (5, 10)
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(5, 10))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(5)
    const pointObject = createPointApiObject({ id: 5, x: 0, y: 0 })
    const sceneGraphDelta = createSceneGraphDelta([pointObject])
    const getContextData = vi.fn(() => ({
      selectedIds: [5],
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    const editSegments = vi.fn(() =>
      Promise.resolve({
        kclSource: { text: '' },
        sceneGraphDelta: createSceneGraphDelta([pointObject]),
      })
    )
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    // Current cursor position is at (15, 25)
    await callback({
      intersectionPoint: {
        twoD: new Vector2(15, 25),
        threeD: new Vector3(15, 25, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should calculate drag vector: (15, 25) - (5, 10) = (10, 15)
    // This vector is applied to segment positions
    expect(editSegments).toHaveBeenCalled()
    const editCall = editSegments.mock.calls[0] as unknown as
      | [number, number, Array<{ id: number }>, unknown]
      | undefined
    if (editCall && editCall.length > 2) {
      const segments = editCall[2]
      if (isArray(segments)) {
        expect(segments).toHaveLength(1) // One segment to edit (index 2: version, sketchId, segments, settings)
      }
    }
    // The segment should have the drag vector applied
    expect(setLastSuccessfulDragFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({ x: 15, y: 25 })
    )
    // Verify it's a clone
    const callArg = setLastSuccessfulDragFromPoint.mock.calls[0]
    if (callArg && callArg.length > 0) {
      expect(callArg[0]).not.toBe(new Vector2(15, 25))
    }
  })

  it('should drag the entity under cursor when no other segments are selected', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(13)
    // Create a point segment that will be under the cursor
    const pointObject = createPointApiObject({ id: 13, x: 10, y: 20 })
    const sceneGraphDelta = createSceneGraphDelta([pointObject])
    const getContextData = vi.fn(() => ({
      selectedIds: [], // No selected segments
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    const editSegments = vi.fn(() =>
      Promise.resolve({
        kclSource: { text: '' },
        sceneGraphDelta: createSceneGraphDelta([pointObject]),
      })
    )
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    // Create a real point segment group to use as selected
    const pointGroup = createPointSegmentGroup({ segmentId: 13 })

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    await callback({
      intersectionPoint: {
        twoD: new Vector2(15, 25), // Drag to new position
        threeD: new Vector3(15, 25, 0),
      },
      selected: pointGroup, // Entity under cursor
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should edit the segment under cursor
    expect(editSegments).toHaveBeenCalled()
    const editCall = editSegments.mock.calls[0] as unknown as
      | [number, number, Array<{ id: number }>, unknown]
      | undefined
    if (editCall && editCall.length > 2) {
      const segments = editCall[2]
      if (isArray(segments) && segments.length > 0) {
        expect(segments).toHaveLength(1)
        const firstSegment = segments[0]
        if (
          firstSegment &&
          typeof firstSegment === 'object' &&
          'id' in firstSegment
        ) {
          expect(firstSegment.id).toBe(13)
        }
      }
    }
  })

  it('should drag both entity under cursor and selected segments together', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(13)
    // Create multiple point segments
    const point1 = createPointApiObject({ id: 5, x: 0, y: 0 })
    const point2 = createPointApiObject({ id: 13, x: 10, y: 20 })
    const sceneGraphDelta = createSceneGraphDelta([point1, point2])
    const getContextData = vi.fn(() => ({
      selectedIds: [5], // Segment 5 is selected
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    const editSegments = vi.fn(() =>
      Promise.resolve({
        kclSource: { text: '' },
        sceneGraphDelta: createSceneGraphDelta([point1, point2]),
      })
    )
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    // Create a point segment group for the entity under cursor
    const pointGroupUnderCursor = createPointSegmentGroup({ segmentId: 13 })

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    await callback({
      intersectionPoint: {
        twoD: new Vector2(15, 25),
        threeD: new Vector3(15, 25, 0),
      },
      selected: pointGroupUnderCursor, // Entity 13 under cursor
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should edit both segments: entity under cursor (13) + selected (5)
    expect(editSegments).toHaveBeenCalled()
    const editCall = editSegments.mock.calls[0] as unknown as
      | [number, number, Array<{ id: number }>, unknown]
      | undefined
    if (editCall && editCall.length > 2) {
      const segments = editCall[2]
      if (isArray(segments) && segments.length > 0) {
        expect(segments).toHaveLength(2)
        const editedIds = segments.map((s) => s.id).sort((a, b) => a - b)
        expect(editedIds).toEqual([5, 13])
      }
    }
  })

  it('should prevent race conditions and only update drag point after successful edit resolves', async () => {
    // Simulate state that persists across calls
    let isSolveInProgress = false
    const getIsSolveInProgress = vi.fn(() => isSolveInProgress)
    const setIsSolveInProgress = vi.fn((value: boolean) => {
      isSolveInProgress = value
    })
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(5)
    const pointObject = createPointApiObject({ id: 5 })
    const sceneGraphDelta = createSceneGraphDelta([pointObject])
    const getContextData = vi.fn(() => ({
      selectedIds: [5],
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))

    // Create a promise that we can control when it resolves
    let resolveEditSegments: (value: {
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    }) => void
    const editSegmentsPromise = new Promise<{
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    }>((resolve) => {
      resolveEditSegments = resolve
    })

    const editSegments = vi.fn(() => editSegmentsPromise)
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    // First call - editSegments hasn't resolved yet
    const firstPosition = new Vector2(10, 20)
    const firstCallPromise = callback({
      intersectionPoint: {
        twoD: firstPosition,
        threeD: new Vector3(10, 20, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Wait for the async callback to start executing
    await Promise.resolve()

    // Verify editSegments was called and state was set
    expect(editSegments).toHaveBeenCalledTimes(1)
    expect(setIsSolveInProgress).toHaveBeenCalledWith(true)
    expect(isSolveInProgress).toBe(true)

    // Drag point should NOT be updated yet (editSegments hasn't resolved)
    expect(setLastSuccessfulDragFromPoint).not.toHaveBeenCalled()

    // Second call while first is still pending - should be prevented by isSolveInProgress check
    // Since isSolveInProgress is now true, this call should return early
    const secondPosition = new Vector2(15, 25)
    const secondCallPromise = callback({
      intersectionPoint: {
        twoD: secondPosition,
        threeD: new Vector3(15, 25, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should not have called editSegments again (concurrent operation prevented)
    expect(editSegments).toHaveBeenCalledTimes(1)

    // Now resolve the first editSegments call
    resolveEditSegments!({
      kclSource: { text: '' },
      sceneGraphDelta: createSceneGraphDelta([pointObject]),
    })

    // Wait for first call to complete
    await firstCallPromise

    // Now drag point should be updated with the first position (the one that succeeded)
    expect(setLastSuccessfulDragFromPoint).toHaveBeenCalledTimes(1)
    expect(setLastSuccessfulDragFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({ x: 10, y: 20 })
    )
    expect(setIsSolveInProgress).toHaveBeenCalledWith(false)
    expect(isSolveInProgress).toBe(false)

    // Wait for second call (which should have returned early)
    await secondCallPromise

    // Verify second call didn't update drag point (it was prevented)
    expect(setLastSuccessfulDragFromPoint).toHaveBeenCalledTimes(1)
    expect(editSegments).toHaveBeenCalledTimes(1)
  })

  it('should update last successful drag point after successful edit to track drag progress', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(5)
    const pointObject = createPointApiObject({ id: 5 })
    const sceneGraphDelta = createSceneGraphDelta([pointObject])
    const getContextData = vi.fn(() => ({
      selectedIds: [5],
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    const editSegments = vi.fn(() =>
      Promise.resolve({
        kclSource: { text: '' },
        sceneGraphDelta: createSceneGraphDelta([pointObject]),
      })
    )
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    const newPosition = new Vector2(10, 20)
    await callback({
      intersectionPoint: {
        twoD: newPosition,
        threeD: new Vector3(10, 20, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // After successful edit, update the last successful drag point
    // This ensures the next drag calculates from the correct starting point
    expect(setLastSuccessfulDragFromPoint).toHaveBeenCalledWith(
      expect.objectContaining({ x: 10, y: 20 })
    )
    // Verify it's a clone
    const callArg = setLastSuccessfulDragFromPoint.mock.calls[0][0]
    expect(callArg).not.toBe(newPosition)
  })

  it('should allow drag snapping for an arc child point when its owner arc remains selected', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(2)
    const center = createPointApiObject({ id: 1, x: 0, y: 0, owner: 4 })
    const start = createPointApiObject({ id: 2, x: 10, y: 0, owner: 4 })
    const end = createPointApiObject({ id: 3, x: -10, y: 0, owner: 4 })
    const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })
    const snapTarget = createPointApiObject({ id: 10, x: 12, y: 2 })
    const sceneGraphDelta = createSceneGraphDelta([
      createSketchApiObject({ id: 0 }),
      center,
      start,
      end,
      arc,
      snapTarget,
    ])
    const getContextData = vi.fn(() => ({
      selectedIds: [4],
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    const editSegments = vi.fn(() =>
      Promise.resolve({
        kclSource: { text: '' },
        sceneGraphDelta,
      })
    )
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))
    const dragSnappingDeps = createDragSnappingDeps()

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...dragSnappingDeps,
    })

    await callback({
      intersectionPoint: {
        twoD: new Vector2(12, 2),
        threeD: new Vector3(12, 2, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    expect(dragSnappingDeps.onUpdateDragSnapping).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { type: 'point', pointId: 10 },
        position: [12, 2],
      })
    )
  })

  it('should allow drag snapping for a circle child point when its owner circle remains selected', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(2)
    const center = createPointApiObject({ id: 1, x: 0, y: 0, owner: 4 })
    const start = createPointApiObject({ id: 2, x: 10, y: 0, owner: 4 })
    const circle = createCircleApiObject({ id: 4, center: 1, start: 2 })
    const snapTarget = createPointApiObject({ id: 10, x: 12, y: 2 })
    const sceneGraphDelta = createSceneGraphDelta([
      createSketchApiObject({ id: 0 }),
      center,
      start,
      circle,
      snapTarget,
    ])
    const getContextData = vi.fn(() => ({
      selectedIds: [4],
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    const editSegments = vi.fn(() =>
      Promise.resolve({
        kclSource: { text: '' },
        sceneGraphDelta,
      })
    )
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))
    const dragSnappingDeps = createDragSnappingDeps()

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...dragSnappingDeps,
    })

    await callback({
      intersectionPoint: {
        twoD: new Vector2(12, 2),
        threeD: new Vector3(12, 2, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    expect(dragSnappingDeps.onUpdateDragSnapping).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { type: 'point', pointId: 10 },
        position: [12, 2],
      })
    )
  })

  it('should send event to update sketch outcome after successful edit', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(5)
    const pointObject = createPointApiObject({ id: 5 })
    const sceneGraphDelta = createSceneGraphDelta([pointObject])
    const getContextData = vi.fn(() => ({
      selectedIds: [5],
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    const result = {
      kclSource: { text: 'updated code' },
      sceneGraphDelta: createSceneGraphDelta([pointObject]),
    }
    const editSegments = vi.fn(() => Promise.resolve(result))
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    await callback({
      intersectionPoint: {
        twoD: new Vector2(10, 20),
        threeD: new Vector3(10, 20, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should send event to update the sketch outcome
    // This triggers the state machine to update the scene graph and code
    expect(onNewSketchOutcome).toHaveBeenCalledWith({
      ...result,
      writeToDisk: false,
    })
  })

  it('should not send event when edit fails to prevent invalid state updates', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(5)
    const pointObject = createPointApiObject({ id: 5 })
    const sceneGraphDelta = createSceneGraphDelta([pointObject])
    const getContextData = vi.fn(() => ({
      selectedIds: [5],
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    // Edit fails and returns null
    const editSegments = vi.fn(() => Promise.resolve(null))
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    await callback({
      intersectionPoint: {
        twoD: new Vector2(10, 20),
        threeD: new Vector3(10, 20, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should not notify about new outcome when edit fails
    // This prevents invalid state updates when the edit operation fails
    expect(onNewSketchOutcome).not.toHaveBeenCalled()
    // But should still update the drag point (the drag itself was successful, just the edit failed)
    expect(setLastSuccessfulDragFromPoint).toHaveBeenCalled()
  })

  it('should handle edit errors gracefully without crashing', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(5)
    const pointObject = createPointApiObject({ id: 5 })
    const sceneGraphDelta = createSceneGraphDelta([pointObject])
    const getContextData = vi.fn(() => ({
      selectedIds: [5],
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    // Edit throws an error
    const editSegments = vi.fn(() => Promise.reject(new Error('Edit failed')))
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    // Should not throw
    await callback({
      intersectionPoint: {
        twoD: new Vector2(10, 20),
        threeD: new Vector3(10, 20, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should handle error gracefully
    expect(editSegments).toHaveBeenCalled()
    expect(onNewSketchOutcome).not.toHaveBeenCalled()
    // Should still clear the solve in progress flag
    expect(setIsSolveInProgress).toHaveBeenCalledWith(false)
  })

  it('should return early when no valid segments are found to edit', async () => {
    const getIsSolveInProgress = vi.fn(() => false)
    const setIsSolveInProgress = vi.fn()
    const getLastSuccessfulDragFromPoint = vi.fn(() => new Vector2(0, 0))
    const setLastSuccessfulDragFromPoint = vi.fn()
    const getDraggedEntityId = createDraggedEntityIdGetter(5)
    // Create a non-segment object (e.g., a Sketch object)
    const sketchObject: ApiObject = {
      id: 5,
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
    const sceneGraphDelta = createSceneGraphDelta([sketchObject])
    const getContextData = vi.fn(() => ({
      selectedIds: [5], // Selected, but it's not a segment
      sketchId: 0,
      sketchExecOutcome: { sceneGraphDelta },
    }))
    const editSegments = vi.fn()
    const onNewSketchOutcome = vi.fn()
    const getDefaultLengthUnit = vi.fn((): UnitLength => 'mm')
    const getJsAppSettings = vi.fn(() => Promise.resolve({}))

    const callback = createOnDragCallback({
      getIsSolveInProgress,
      setIsSolveInProgress,
      getLastSuccessfulDragFromPoint,
      setLastSuccessfulDragFromPoint,
      getDraggedEntityId,
      getContextData,
      editSegments,
      onNewSketchOutcome,
      getDefaultLengthUnit,
      getJsAppSettings,
      ...createDragSnappingDeps(),
    })

    await callback({
      intersectionPoint: {
        twoD: new Vector2(10, 20),
        threeD: new Vector3(10, 20, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should return early when no valid segments found
    expect(editSegments).not.toHaveBeenCalled()
    expect(setIsSolveInProgress).toHaveBeenCalledWith(false) // Should clear the flag
  })
})

describe('createOnClickCallback', () => {
  it('should select a segment when clicking on it to enable editing', async () => {
    const onUpdateSelectedIds = vi.fn()
    const onEditConstraint = vi.fn()
    const pointObject = createPointApiObject({ id: 13, x: 10, y: 20 })

    const callback = createOnClickCallback({
      ...createOnClickDeps([pointObject]),
      onUpdateSelectedIds,
      onEditConstraint,
    })

    await callback({
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersectionPoint: {
        twoD: new Vector2(10, 20),
        threeD: new Vector3(10, 20, 0),
      },
      intersects: [],
    })

    // Clicking on a segment should select it, enabling the user to edit it
    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [13],
      duringAreaSelectIds: [],
    })
  })

  it('should clear selection when clicking on empty space to deselect all segments', async () => {
    const onUpdateSelectedIds = vi.fn()
    const onEditConstraint = vi.fn()

    const callback = createOnClickCallback({
      ...createOnClickDeps(),
      onUpdateSelectedIds,
      onEditConstraint,
    })

    await callback({
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Clicking on empty space should clear selection, allowing user to start fresh
    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [],
      duringAreaSelectIds: [],
    })
  })

  it('should select the origin when clicking near it', async () => {
    const onUpdateSelectedIds = vi.fn()
    const onEditConstraint = vi.fn()

    const callback = createOnClickCallback({
      ...createOnClickDeps(),
      onUpdateSelectedIds,
      onEditConstraint,
    })

    await callback({
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      intersects: [],
    })

    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [ORIGIN_TARGET],
      duringAreaSelectIds: [],
    })
  })

  it('should select a point at the origin instead of the origin target', async () => {
    const onUpdateSelectedIds = vi.fn()
    const onEditConstraint = vi.fn()
    const pointAtOrigin = createPointApiObject({ id: 1, x: 0, y: 0 })

    const callback = createOnClickCallback({
      ...createOnClickDeps([pointAtOrigin]),
      onUpdateSelectedIds,
      onEditConstraint,
    })

    await callback({
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      intersects: [],
    })

    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [1],
      duringAreaSelectIds: [],
    })
  })

  it('should handle clicking on non-segment objects by clearing selection', async () => {
    const nonSegmentGroup = new Group()
    nonSegmentGroup.name = 'not-a-segment'
    nonSegmentGroup.userData = { type: 'other' }
    const onUpdateSelectedIds = vi.fn()
    const onEditConstraint = vi.fn()

    const callback = createOnClickCallback({
      ...createOnClickDeps(),
      onUpdateSelectedIds,
      onEditConstraint,
    })

    await callback({
      selected: nonSegmentGroup,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Clicking on non-segment objects should clear selection
    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [],
      duringAreaSelectIds: [],
    })
  })

  it('should select line segments identified by STRAIGHT_SEGMENT_BODY children', async () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 5, start: 1, end: 2 })
    const onUpdateSelectedIds = vi.fn()
    const onEditConstraint = vi.fn()

    const callback = createOnClickCallback({
      ...createOnClickDeps([start, end, line]),
      onUpdateSelectedIds,
      onEditConstraint,
    })

    await callback({
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersectionPoint: {
        twoD: new Vector2(20, 0),
        threeD: new Vector3(20, 0, 0),
      },
      intersects: [],
    })

    // Line segments should be selectable
    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [5],
      duringAreaSelectIds: [],
    })
  })

  it('should replace the current selection when clicking a constraint', async () => {
    const sceneInfra = {
      scene: {
        getObjectByName: vi.fn((name: string) => {
          if (name === String(20)) {
            const group = new Group()
            group.name = '20'
            const child = new Group()
            child.userData.hitObjects = [
              {
                type: 'line',
                line: [
                  [0, 0],
                  [20, 0],
                ],
              },
            ]
            group.add(child)
            return group
          }

          if (name === SKETCH_SOLVE_GROUP) {
            return new Group()
          }

          return null
        }),
      },
      getClientSceneScaleFactor: vi.fn(() => 1),
    } as unknown as SceneInfra
    const onUpdateSelectedIds = vi.fn()
    const onEditConstraint = vi.fn()
    const pointA = createPointApiObject({ id: 1, x: -20, y: 0 })
    const pointB = createPointApiObject({ id: 2, x: 40, y: 0 })
    const constraint = createConstraintApiObject({ id: 20, type: 'Distance' })

    const callback = createOnClickCallback({
      getApiObjects: () =>
        createSceneGraphDelta([pointA, pointB, constraint]).new_graph.objects,
      sceneInfra,
      onUpdateSelectedIds,
      onEditConstraint,
    })

    await callback({
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersectionPoint: {
        twoD: new Vector2(10, 0),
        threeD: new Vector3(10, 0, 0),
      },
      intersects: [],
    })

    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [20],
      duringAreaSelectIds: [],
      replaceExistingSelection: true,
    })
  })

  it('should pin an invisible constraint selection to the clicked popup group', async () => {
    const camera = new OrthographicCamera(0, 100, 100, 0, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()

    const constraintGroup = new Group()
    constraintGroup.name = '20'
    constraintGroup.visible = true
    const relatedConstraintGroup = new Group()
    relatedConstraintGroup.name = '21'
    const badge = new Group()
    badge.userData.constraintHoverPopup = {
      segmentId: 3,
      position: [60, 20],
    }
    badge.userData.hitObjects = [
      {
        type: 'screenRect',
        center: [60, 20, 0],
        sizePx: [20, 20],
      },
    ]
    constraintGroup.add(badge)

    const sceneInfra = {
      scene: {
        getObjectByName: vi.fn((name: string) => {
          if (name === String(20)) {
            return constraintGroup
          }
          if (name === String(21)) {
            return relatedConstraintGroup
          }

          return null
        }),
      },
      camControls: { camera },
      renderer: {
        domElement: {
          clientWidth: 100,
          clientHeight: 100,
        },
      },
      getClientSceneScaleFactor: vi.fn(() => 1),
    } as unknown as SceneInfra
    const onUpdateSelectedIds = vi.fn()
    const onEditConstraint = vi.fn()
    const pointA = createPointApiObject({ id: 1, x: 0, y: 0 })
    const pointB = createPointApiObject({ id: 2, x: 40, y: 0 })
    const pointC = createPointApiObject({ id: 4, x: 0, y: 20 })
    const pointD = createPointApiObject({ id: 5, x: 40, y: 20 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const otherLine = createLineApiObject({ id: 6, start: 4, end: 5 })
    const constraint = createConstraintApiObject({ id: 20, type: 'Horizontal' })
    const relatedConstraint = {
      id: 21,
      kind: {
        type: 'Constraint',
        constraint: {
          type: 'Parallel',
          lines: [3, 6],
        },
      },
      label: '',
      comments: '',
      artifact_id: '0',
      source: { type: 'Simple', range: [0, 0, 0] },
    } as ApiObject

    const callback = createOnClickCallback({
      getApiObjects: () =>
        createSceneGraphDelta([
          pointA,
          pointB,
          pointC,
          pointD,
          line,
          otherLine,
          constraint,
          relatedConstraint,
        ]).new_graph.objects,
      sceneInfra,
      onUpdateSelectedIds,
      onEditConstraint,
    })

    await callback({
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersectionPoint: {
        twoD: new Vector2(60, 20),
        threeD: new Vector3(60, 20, 0),
      },
      intersects: [],
    })

    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [20],
      duringAreaSelectIds: [],
      replaceExistingSelection: true,
    })
    expect(constraintGroup.userData.selectedInvisibleConstraintPopup).toEqual({
      ownerConstraintId: 20,
      segmentId: 3,
      position: [60, 20],
    })
    expect(
      relatedConstraintGroup.userData.selectedInvisibleConstraintPopup
    ).toEqual({
      ownerConstraintId: 20,
      segmentId: 3,
      position: [60, 20],
    })
  })
})

describe('setUpOnDragAndSelectionClickCallbacks onMove', () => {
  it('should update hovered id when moving onto a segment', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 5, start: 1, end: 2 })

    const { onMove, send } = setUpMoveToolCallbacks({
      apiObjects: [start, end, line],
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(20, 0),
        threeD: new Vector3(20, 0, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: { hoveredId: 5 },
    })
  })

  it('should update hovered id when moving onto the origin', () => {
    const { onMove, send } = setUpMoveToolCallbacks({
      apiObjects: [],
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: { hoveredId: ORIGIN_TARGET },
    })
  })

  it('should update hovered id to a point at the origin instead of the origin target', () => {
    const pointAtOrigin = createPointApiObject({ id: 1, x: 0, y: 0 })
    const { onMove, send } = setUpMoveToolCallbacks({
      apiObjects: [pointAtOrigin],
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: { hoveredId: 1 },
    })
  })

  it('should include hover preview data when hovering a line with hidden non-visual constraints', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const horizontalConstraint = createConstraintApiObject({
      id: 20,
      type: 'Horizontal',
    })

    const { onMove, send } = setUpMoveToolCallbacks({
      apiObjects: [start, end, line, horizontalConstraint],
      showNonVisualConstraints: false,
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(20, 0),
        threeD: new Vector3(20, 0, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: {
        hoveredId: 3,
        constraintHoverPopups: [{ segmentId: 3, position: [20, 0] }],
      },
    })
  })

  it('should include hover preview data when hovering a point with hidden non-visual constraints', () => {
    const point = createPointApiObject({ id: 1, x: 10, y: 20 })
    const otherPoint = createPointApiObject({ id: 2, x: 20, y: 20 })
    const coincidentConstraint = {
      id: 20,
      kind: {
        type: 'Constraint',
        constraint: {
          type: 'Coincident',
          segments: [1, 2],
        },
      },
      label: '',
      comments: '',
      artifact_id: '0',
      source: { type: 'Simple', range: [0, 0, 0] },
    } as ApiObject

    const { onMove, send } = setUpMoveToolCallbacks({
      apiObjects: [point, otherPoint, coincidentConstraint],
      showNonVisualConstraints: false,
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(10, 20),
        threeD: new Vector3(10, 20, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: {
        hoveredId: 1,
        constraintHoverPopups: [{ segmentId: 1, position: [10, 20] }],
      },
    })
  })

  it('should keep existing popups while showing a new popup for another segment', () => {
    const lineStart = createPointApiObject({ id: 1, x: 0, y: 0 })
    const lineEnd = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const horizontalConstraint = createConstraintApiObject({
      id: 20,
      type: 'Horizontal',
    })
    const point = createPointApiObject({ id: 10, x: 60, y: 20 })
    const otherPoint = createPointApiObject({ id: 11, x: 70, y: 20 })
    const coincidentConstraint = {
      id: 21,
      kind: {
        type: 'Constraint',
        constraint: {
          type: 'Coincident',
          segments: [10, 11],
        },
      },
      label: '',
      comments: '',
      artifact_id: '0',
      source: { type: 'Simple', range: [0, 0, 0] },
    } as ApiObject

    const { onMove, send } = setUpMoveToolCallbacks({
      apiObjects: [
        lineStart,
        lineEnd,
        line,
        horizontalConstraint,
        point,
        otherPoint,
        coincidentConstraint,
      ],
      showNonVisualConstraints: false,
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(20, 0),
        threeD: new Vector3(20, 0, 0),
      },
    })
    send.mockClear()

    onMove({
      intersectionPoint: {
        twoD: new Vector2(60, 20),
        threeD: new Vector3(60, 20, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: {
        hoveredId: 10,
        constraintHoverPopups: [
          { segmentId: 3, position: [20, 0] },
          { segmentId: 10, position: [60, 20] },
        ],
      },
    })
  })

  it('should keep an existing popup in place when hovering the same segment again', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const horizontalConstraint = createConstraintApiObject({
      id: 20,
      type: 'Horizontal',
    })

    const { onMove, send } = setUpMoveToolCallbacks({
      apiObjects: [start, end, line, horizontalConstraint],
      showNonVisualConstraints: false,
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(20, 0),
        threeD: new Vector3(20, 0, 0),
      },
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(200, 200),
        threeD: new Vector3(200, 200, 0),
      },
    })
    send.mockClear()

    onMove({
      intersectionPoint: {
        twoD: new Vector2(25, 0),
        threeD: new Vector3(25, 0, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: {
        hoveredId: 3,
        constraintHoverPopups: [{ segmentId: 3, position: [20, 0] }],
      },
    })
  })

  it('should keep a revisited popup stable while newer popups stay on top', () => {
    const lineStart = createPointApiObject({ id: 1, x: 0, y: 0 })
    const lineEnd = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const horizontalConstraint = createConstraintApiObject({
      id: 20,
      type: 'Horizontal',
    })
    const point = createPointApiObject({ id: 10, x: 60, y: 20 })
    const otherPoint = createPointApiObject({ id: 11, x: 70, y: 20 })
    const coincidentConstraint = {
      id: 21,
      kind: {
        type: 'Constraint',
        constraint: {
          type: 'Coincident',
          segments: [10, 11],
        },
      },
      label: '',
      comments: '',
      artifact_id: '0',
      source: { type: 'Simple', range: [0, 0, 0] },
    } as ApiObject

    const { onMove, send } = setUpMoveToolCallbacks({
      apiObjects: [
        lineStart,
        lineEnd,
        line,
        horizontalConstraint,
        point,
        otherPoint,
        coincidentConstraint,
      ],
      showNonVisualConstraints: false,
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(20, 0),
        threeD: new Vector3(20, 0, 0),
      },
    })
    onMove({
      intersectionPoint: {
        twoD: new Vector2(60, 20),
        threeD: new Vector3(60, 20, 0),
      },
    })
    send.mockClear()

    onMove({
      intersectionPoint: {
        twoD: new Vector2(25, 0),
        threeD: new Vector3(25, 0, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: {
        hoveredId: 3,
        constraintHoverPopups: [
          { segmentId: 3, position: [20, 0] },
          { segmentId: 10, position: [60, 20] },
        ],
      },
    })
  })

  it('should only start hiding the preview after leaving the segment', () => {
    vi.useFakeTimers()

    try {
      const start = createPointApiObject({ id: 1, x: 0, y: 0 })
      const end = createPointApiObject({ id: 2, x: 40, y: 0 })
      const line = createLineApiObject({ id: 3, start: 1, end: 2 })
      const horizontalConstraint = createConstraintApiObject({
        id: 20,
        type: 'Horizontal',
      })

      const { onMove, send } = setUpMoveToolCallbacks({
        apiObjects: [start, end, line, horizontalConstraint],
        showNonVisualConstraints: false,
      })

      onMove({
        intersectionPoint: {
          twoD: new Vector2(20, 0),
          threeD: new Vector3(20, 0, 0),
        },
      })

      expect(send).toHaveBeenCalledWith({
        type: 'update hovered id',
        data: {
          hoveredId: 3,
          constraintHoverPopups: [{ segmentId: 3, position: [20, 0] }],
        },
      })

      send.mockClear()

      onMove({
        intersectionPoint: {
          twoD: new Vector2(25, 0),
          threeD: new Vector3(25, 0, 0),
        },
      })

      expect(send).not.toHaveBeenCalled()

      vi.advanceTimersByTime(2000)

      expect(send).not.toHaveBeenCalled()

      onMove({
        intersectionPoint: {
          twoD: new Vector2(200, 200),
          threeD: new Vector3(200, 200, 0),
        },
      })

      expect(send).toHaveBeenCalledWith({
        type: 'update hovered id',
        data: {
          hoveredId: null,
          constraintHoverPopups: [{ segmentId: 3, position: [20, 0] }],
        },
      })

      send.mockClear()
      vi.advanceTimersByTime(1999)
      expect(send).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)

      expect(send).toHaveBeenCalledWith({
        type: 'update hovered id',
        data: {
          hoveredId: null,
          constraintHoverPopups: [],
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('should keep the preview alive while hovering the icon and hide it 2 seconds after leaving', () => {
    vi.useFakeTimers()

    try {
      const start = createPointApiObject({ id: 1, x: 0, y: 0 })
      const end = createPointApiObject({ id: 2, x: 40, y: 0 })
      const line = createLineApiObject({ id: 3, start: 1, end: 2 })
      const horizontalConstraint = createConstraintApiObject({
        id: 20,
        type: 'Horizontal',
      })
      const constraintGroup = new Group()
      constraintGroup.name = '20'
      const badgeChild = new Group()
      badgeChild.userData.hitObjects = [
        {
          type: 'screenRect',
          center: [32, 12, 0],
          sizePx: [20, 20],
        },
      ]
      constraintGroup.add(badgeChild)

      const { onMove, send } = setUpMoveToolCallbacks({
        apiObjects: [start, end, line, horizontalConstraint],
        showNonVisualConstraints: false,
        getSceneObjectByName: (name) =>
          name === '20' ? constraintGroup : null,
      })

      onMove({
        intersectionPoint: {
          twoD: new Vector2(20, 0),
          threeD: new Vector3(20, 0, 0),
        },
      })
      send.mockClear()

      onMove({
        intersectionPoint: {
          twoD: new Vector2(32, 12),
          threeD: new Vector3(32, 12, 0),
        },
      })

      expect(send).toHaveBeenCalledWith({
        type: 'update hovered id',
        data: {
          hoveredId: 20,
          constraintHoverPopups: [{ segmentId: 3, position: [20, 0] }],
        },
      })

      send.mockClear()
      vi.advanceTimersByTime(2000)
      expect(send).not.toHaveBeenCalled()

      onMove({
        intersectionPoint: {
          twoD: new Vector2(45, 20),
          threeD: new Vector3(45, 20, 0),
        },
      })

      expect(send).toHaveBeenCalledWith({
        type: 'update hovered id',
        data: {
          hoveredId: null,
          constraintHoverPopups: [{ segmentId: 3, position: [20, 0] }],
        },
      })

      send.mockClear()
      vi.advanceTimersByTime(1999)
      expect(send).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)

      expect(send).toHaveBeenCalledWith({
        type: 'update hovered id',
        data: {
          hoveredId: null,
          constraintHoverPopups: [],
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('should clear the constraint hover popup when dragging starts', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 3, start: 1, end: 2 })
    const horizontalConstraint = createConstraintApiObject({
      id: 20,
      type: 'Horizontal',
    })

    const { onMove, onDragStart, send } = setUpMoveToolCallbacks({
      apiObjects: [start, end, line, horizontalConstraint],
      showNonVisualConstraints: false,
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(20, 0),
        threeD: new Vector3(20, 0, 0),
      },
    })

    send.mockClear()

    onDragStart({
      intersectionPoint: {
        twoD: new Vector2(20, 0),
        threeD: new Vector3(20, 0, 0),
      },
      mouseEvent: createTestMouseEvent(),
      intersects: [],
      selected: undefined,
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: {
        hoveredId: 3,
        constraintHoverPopups: [],
      },
    })
  })

  it('should clear the hovered id when moving away from the hovered segment', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 5, start: 1, end: 2 })

    const { onMove, send } = setUpMoveToolCallbacks({
      apiObjects: [start, end, line],
      hoveredId: 5,
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(200, 200),
        threeD: new Vector3(200, 200, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update hovered id',
      data: { hoveredId: null },
    })
  })

  it('should not update hovered id during area select', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 5, start: 1, end: 2 })

    const { onMove, send, getObjectByName } = setUpMoveToolCallbacks({
      apiObjects: [start, end, line],
      isAreaSelectActive: true,
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(20, 0),
        threeD: new Vector3(20, 0, 0),
      },
    })

    expect(send).not.toHaveBeenCalled()
    expect(getObjectByName).not.toHaveBeenCalled()
  })

  it('should avoid redundant hover updates when the hovered segment is unchanged', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0 })
    const end = createPointApiObject({ id: 2, x: 40, y: 0 })
    const line = createLineApiObject({ id: 5, start: 1, end: 2 })

    const { onMove, send } = setUpMoveToolCallbacks({
      apiObjects: [start, end, line],
      hoveredId: 5,
    })

    onMove({
      intersectionPoint: {
        twoD: new Vector2(20, 0),
        threeD: new Vector3(20, 0, 0),
      },
    })

    expect(send).not.toHaveBeenCalled()
  })
})

describe('setUpOnDragAndSelectionClickCallbacks onClick', () => {
  it('should ignore overlapping points from earlier sketches and select from the active sketch', async () => {
    const firstSketch = createSketchApiObject({ id: 1 })
    const firstSketchPoint = createPointApiObject({ id: 2, x: 10, y: 20 })
    const activeSketch = createSketchApiObject({ id: 10 })
    const activeSketchPoint = createPointApiObject({ id: 11, x: 10, y: 20 })

    const { onClick, send } = setUpMoveToolCallbacks({
      apiObjects: [
        firstSketch,
        firstSketchPoint,
        activeSketch,
        activeSketchPoint,
      ],
      sketchId: 10,
    })

    await onClick({
      mouseEvent: createTestMouseEvent(),
      intersectionPoint: {
        twoD: new Vector2(10, 20),
        threeD: new Vector3(10, 20, 0),
      },
      intersects: [],
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update selected ids',
      data: { selectedIds: [11], duringAreaSelectIds: [] },
    })
  })
})

describe('setUpOnDragAndSelectionClickCallbacks onAreaSelect', () => {
  it('should select contained line segments from api objects without scene geometry', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0, owner: 5 })
    const end = createPointApiObject({ id: 2, x: 10, y: 0, owner: 5 })
    const line = createLineApiObject({ id: 5, start: 1, end: 2 })

    const { onAreaSelect, send, getObjectByName } = setUpMoveToolCallbacks({
      apiObjects: [start, end, line],
    })

    onAreaSelect({
      startPoint: {
        twoD: new Vector2(-5, -5),
        threeD: new Vector3(-5, -5, 0),
      },
      currentPoint: {
        twoD: new Vector2(15, 5),
        threeD: new Vector3(15, 5, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update selected ids',
      data: { duringAreaSelectIds: [5] },
    })
    expect(getObjectByName).toHaveBeenCalledTimes(1)
  })

  it('should ignore area select updates during right-click drag', () => {
    const start = createPointApiObject({ id: 1, x: 0, y: 0, owner: 5 })
    const end = createPointApiObject({ id: 2, x: 10, y: 0, owner: 5 })
    const line = createLineApiObject({ id: 5, start: 1, end: 2 })

    const { onAreaSelect, send, getObjectByName } = setUpMoveToolCallbacks({
      apiObjects: [start, end, line],
    })

    onAreaSelect({
      mouseEvent: new MouseEvent('mousemove', { buttons: 2 }),
      startPoint: {
        twoD: new Vector2(-5, -5),
        threeD: new Vector3(-5, -5, 0),
      },
      currentPoint: {
        twoD: new Vector2(15, 5),
        threeD: new Vector3(15, 5, 0),
      },
    })

    expect(send).not.toHaveBeenCalled()
    expect(getObjectByName).not.toHaveBeenCalled()
  })

  it('should not treat an arc as contained when its sweep extends outside the box', () => {
    const center = createPointApiObject({ id: 1, x: 0, y: 0, owner: 4 })
    const start = createPointApiObject({ id: 2, x: 10, y: 0, owner: 4 })
    const end = createPointApiObject({ id: 3, x: -10, y: 0, owner: 4 })
    const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })

    const { onAreaSelect, send } = setUpMoveToolCallbacks({
      apiObjects: [center, start, end, arc],
    })

    onAreaSelect({
      startPoint: {
        twoD: new Vector2(-11, -1),
        threeD: new Vector3(-11, -1, 0),
      },
      currentPoint: {
        twoD: new Vector2(11, 1),
        threeD: new Vector3(11, 1, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update selected ids',
      data: { duringAreaSelectIds: [] },
    })
  })

  it('should select line segments that intersect the box in intersection mode', () => {
    const start = createPointApiObject({ id: 1, x: -10, y: 0, owner: 5 })
    const end = createPointApiObject({ id: 2, x: 10, y: 0, owner: 5 })
    const line = createLineApiObject({ id: 5, start: 1, end: 2 })

    const { onAreaSelect, send } = setUpMoveToolCallbacks({
      apiObjects: [start, end, line],
    })

    onAreaSelect({
      startPoint: {
        twoD: new Vector2(1, -1),
        threeD: new Vector3(1, -1, 0),
      },
      currentPoint: {
        twoD: new Vector2(-1, 1),
        threeD: new Vector3(-1, 1, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update selected ids',
      data: { duringAreaSelectIds: [5] },
    })
  })

  it('should select arcs that intersect the box in intersection mode', () => {
    const center = createPointApiObject({ id: 1, x: 0, y: 0, owner: 4 })
    const start = createPointApiObject({ id: 2, x: 10, y: 0, owner: 4 })
    const end = createPointApiObject({ id: 3, x: -10, y: 0, owner: 4 })
    const arc = createArcApiObject({ id: 4, center: 1, start: 2, end: 3 })

    const { onAreaSelect, send } = setUpMoveToolCallbacks({
      apiObjects: [center, start, end, arc],
    })

    onAreaSelect({
      startPoint: {
        twoD: new Vector2(1, 11),
        threeD: new Vector3(1, 11, 0),
      },
      currentPoint: {
        twoD: new Vector2(-1, 9),
        threeD: new Vector3(-1, 9, 0),
      },
    })

    expect(send).toHaveBeenCalledWith({
      type: 'update selected ids',
      data: { duringAreaSelectIds: [4] },
    })
  })
})
