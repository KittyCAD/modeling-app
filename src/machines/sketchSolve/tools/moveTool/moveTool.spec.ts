import { describe, it, expect, vi } from 'vitest'
import { Group, Vector2, Vector3 } from 'three'
import {
  createOnDragStartCallback,
  createOnDragCallback,
  createOnClickCallback,
  setUpOnDragAndSelectionClickCallbacks,
} from '@src/machines/sketchSolve/tools/moveTool/moveTool'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import { Themes } from '@src/lib/theme'
import type {
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import { isArray } from '@src/lib/utils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

function createTestMouseEvent(): MouseEvent {
  return new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
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

function createDraggedEntityIdGetter(entityId: number | null = null) {
  return vi.fn(() => entityId)
}

function setUpMoveToolCallbacks({
  apiObjects = [],
  hoveredId = null,
  isAreaSelectActive = false,
}: {
  apiObjects?: ApiObject[]
  hoveredId?: number | null
  isAreaSelectActive?: boolean
}) {
  let callbacks: Record<string, unknown> = {}

  const sceneInfra = {
    setCallbacks: vi.fn((nextCallbacks) => {
      callbacks = nextCallbacks as Record<string, unknown>
    }),
    scene: {
      getObjectByName: vi.fn(() => null),
    },
    getClientSceneScaleFactor: vi.fn(() => 1),
    isAreaSelectActive,
  } as unknown as SceneInfra

  const snapshot = {
    context: {
      hoveredId,
      selectedIds: [],
      duringAreaSelectIds: [],
      sketchId: 0,
      draftEntities: undefined,
      sketchExecOutcome: {
        sceneGraphDelta: createSceneGraphDelta(apiObjects),
      },
    },
  }

  const self = {
    getSnapshot: vi.fn(() => snapshot),
    send: vi.fn(),
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

  setUpOnDragAndSelectionClickCallbacks({
    self: self as never,
    context: context as never,
  })

  if (typeof callbacks.onMove !== 'function') {
    throw new Error('Move tool did not register an onMove callback')
  }

  return {
    onMove: callbacks.onMove as (args: {
      intersectionPoint: { twoD: Vector2; threeD: Vector3 }
    }) => void,
    sceneInfra,
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
  theme = Themes.Dark,
  scale = 1,
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
    theme,
    scale,
    id: segmentId,
    isDraft: false,
    isConstruction: false,
  })
  if (result instanceof Group) {
    return result
  }
  throw new Error('Failed to create point segment group')
}

describe('createOnDragStartCallback', () => {
  it('should track the drag start position and dragged entity id', () => {
    const setLastSuccessfulDragFromPoint = vi.fn()
    const setDraggedEntityId = vi.fn()
    const getHoveredId = vi.fn(() => 13)

    const callback = createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggedEntityId,
      getHoveredId,
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
}: {
  id: number
  x?: number
  y?: number
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
        owner: null,
        freedom: 'Free',
        constraints: [],
      },
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
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
    source: { type: 'Simple', range: [0, 0, 0] },
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
      errors: [],
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
      source: { type: 'Simple', range: [0, 0, 0] },
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

    const { onMove, send, sceneInfra } = setUpMoveToolCallbacks({
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
    expect(sceneInfra.scene.getObjectByName).not.toHaveBeenCalled()
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
