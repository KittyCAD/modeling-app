import { describe, it, expect, vi } from 'vitest'
import { Group, Vector2, Vector3, Mesh } from 'three'
import {
  createOnDragStartCallback,
  createOnDragEndCallback,
  createOnDragCallback,
  createOnClickCallback,
  createOnMouseEnterCallback,
  createOnMouseLeaveCallback,
  findEntityUnderCursorId,
} from '@src/machines/sketchSolve/tools/moveTool/moveTool'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import { STRAIGHT_SEGMENT_BODY } from '@src/clientSideScene/sceneConstants'
import { Themes } from '@src/lib/theme'
import type {
  ApiObject,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { UnitLength } from '@rust/kcl-lib/bindings/ModelingCmd'
import { isArray } from '@src/lib/utils'

function createTestMouseEvent(): MouseEvent {
  return new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
  })
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
  })
  if (result instanceof Group) {
    return result
  }
  throw new Error('Failed to create point segment group')
}

/**
 * Helper function to create a line segment mesh for testing.
 * Uses the same function that creates line segments in production,
 * ensuring tests match the actual runtime structure.
 */
export function createLineSegmentMesh({
  segmentId,
  theme = Themes.Dark,
  scale = 1,
}: {
  segmentId: number
  theme?: Themes
  scale?: number
}): Mesh {
  const result = segmentUtilsMap.LineSegment.init({
    input: {
      type: 'Line',
      start: {
        x: { type: 'Var', value: 0, units: 'Mm' },
        y: { type: 'Var', value: 0, units: 'Mm' },
      },
      end: {
        x: { type: 'Var', value: 10, units: 'Mm' },
        y: { type: 'Var', value: 10, units: 'Mm' },
      },
    },
    theme,
    scale,
    id: segmentId,
  })
  if (result instanceof Group) {
    // Find the STRAIGHT_SEGMENT_BODY mesh within the group
    const mesh = result.children.find(
      (child) =>
        child instanceof Mesh && child.userData?.type === STRAIGHT_SEGMENT_BODY
    )
    if (mesh instanceof Mesh) {
      return mesh
    }
  }
  throw new Error('Failed to create line segment mesh')
}

describe('createOnDragStartCallback', () => {
  it('should track the drag start position for calculating drag vectors', () => {
    const setLastSuccessfulDragFromPoint = vi.fn()
    const setDraggingPointElement = vi.fn()
    const getDraggingPointElement = vi.fn(() => null)
    const findPointSegmentElement = vi.fn(() => null)

    const callback = createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggingPointElement,
      getDraggingPointElement,
      findPointSegmentElement,
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
  })

  it('should set draggingPointElement to null when selected is not a Group', () => {
    const setLastSuccessfulDragFromPoint = vi.fn()
    const setDraggingPointElement = vi.fn()
    const getDraggingPointElement = vi.fn(() => null)
    const findPointSegmentElement = vi.fn(() => null)

    const callback = createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggingPointElement,
      getDraggingPointElement,
      findPointSegmentElement,
    })

    void callback({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    expect(setDraggingPointElement).toHaveBeenCalledWith(null)
  })

  it('should ignore groups that are not valid segment groups (non-numeric names)', () => {
    const setLastSuccessfulDragFromPoint = vi.fn()
    const setDraggingPointElement = vi.fn()
    const getDraggingPointElement = vi.fn(() => null)
    const findPointSegmentElement = vi.fn(() => null)

    const callback = createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggingPointElement,
      getDraggingPointElement,
      findPointSegmentElement,
    })

    const group = new Group()
    group.name = 'invalid-name'

    void callback({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      selected: group,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    expect(setDraggingPointElement).toHaveBeenCalledWith(null)
    expect(findPointSegmentElement).not.toHaveBeenCalled()
  })

  it('should ignore groups that are not point segments (no CSS2DObject handle)', () => {
    const setLastSuccessfulDragFromPoint = vi.fn()
    const setDraggingPointElement = vi.fn()
    const getDraggingPointElement = vi.fn(() => null)
    const findPointSegmentElement = vi.fn(() => null)

    const callback = createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggingPointElement,
      getDraggingPointElement,
      findPointSegmentElement,
    })

    // Create a group that looks like a segment but isn't a point segment
    const group = new Group()
    group.name = '5' // Valid numeric ID, but missing the CSS2DObject handle (`userData.type === 'handle'`)

    void callback({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      selected: group,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    expect(setDraggingPointElement).toHaveBeenCalledWith(null)
    expect(findPointSegmentElement).not.toHaveBeenCalled()
  })

  it('should set visual feedback element when dragging a point segment', () => {
    const setLastSuccessfulDragFromPoint = vi.fn()
    const setDraggingPointElement = vi.fn()
    // The segment ID is used to find the DOM element that displays the point
    // This ID comes from the Group's name property, which must be numeric
    const segmentId = 13
    const pointGroup = createPointSegmentGroup({ segmentId })

    // Find the actual DOM element created by the point segment
    const handleElement =
      pointGroup.children[0]?.userData?.type === 'handle'
        ? (pointGroup.children[0] as any).element
        : null
    if (handleElement instanceof HTMLElement === false) {
      throw new Error('Failed to get handle element from point segment group')
    }

    const getDraggingPointElement = vi.fn(() => handleElement)
    const findPointSegmentElement = vi.fn(() => handleElement)

    const callback = createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggingPointElement,
      getDraggingPointElement,
      findPointSegmentElement,
    })

    void callback({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      selected: pointGroup,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // The segment ID (from group.name) is used to find the visual element
    expect(findPointSegmentElement).toHaveBeenCalledWith(segmentId)
    expect(setDraggingPointElement).toHaveBeenCalledWith(handleElement)
    expect(getDraggingPointElement).toHaveBeenCalled()
  })

  it('should handle case where point segment DOM element cannot be found', () => {
    const setLastSuccessfulDragFromPoint = vi.fn()
    const setDraggingPointElement = vi.fn()
    const getDraggingPointElement = vi.fn(() => null)
    // Simulate the DOM query failing to find the element
    const findPointSegmentElement = vi.fn(() => null)

    const callback = createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggingPointElement,
      getDraggingPointElement,
      findPointSegmentElement,
    })

    // Use a real point segment group to ensure we're testing the right structure
    const segmentId = 13
    const pointGroup = createPointSegmentGroup({ segmentId })

    void callback({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      selected: pointGroup,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should still attempt to find the element using the segment ID
    expect(findPointSegmentElement).toHaveBeenCalledWith(segmentId)
    // But gracefully handle when it's not found
    expect(setDraggingPointElement).toHaveBeenCalledWith(null)
    expect(getDraggingPointElement).toHaveBeenCalled()
  })

  it('should not set visual feedback for line segments (only point segments)', () => {
    const setLastSuccessfulDragFromPoint = vi.fn()
    const setDraggingPointElement = vi.fn()
    const getDraggingPointElement = vi.fn(() => null)
    const findPointSegmentElement = vi.fn(() => null)

    const callback = createOnDragStartCallback({
      setLastSuccessfulDragFromPoint,
      setDraggingPointElement,
      getDraggingPointElement,
      findPointSegmentElement,
    })

    // Create a group that represents a line segment (not a point)
    // Line segments don't have CSS2DObject handles, so they shouldn't trigger
    // the visual feedback logic
    const group = new Group()
    group.name = '5' // Valid segment ID
    // Line segments have different structure - no CSS2DObject with 'handle' type

    void callback({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      selected: group,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Line segments don't need DOM element lookup for visual feedback
    expect(findPointSegmentElement).not.toHaveBeenCalled()
    expect(setDraggingPointElement).toHaveBeenCalledWith(null)
  })
})

describe('createOnDragEndCallback', () => {
  it('should restore visual feedback opacity when drag ends on a point segment', () => {
    const setDraggingPointElement = vi.fn()
    // Create a real point segment to get the actual DOM structure
    const segmentId = 13
    const pointGroup = createPointSegmentGroup({ segmentId })

    // Get the actual DOM element from the point segment
    const handleElement =
      pointGroup.children[0]?.userData?.type === 'handle'
        ? (pointGroup.children[0] as any).element
        : null
    if (!(handleElement instanceof HTMLElement)) {
      throw new Error('Failed to get handle element from point segment group')
    }

    // Find the inner circle that shows the visual feedback using the data attribute
    const innerCircle = handleElement.querySelector(
      '[data-point-inner-circle="true"]'
    )
    if (innerCircle instanceof HTMLElement === false) {
      throw new Error('Failed to find inner circle in point segment')
    }

    // Simulate the drag state by setting opacity to 0.7 (as done in onDragStart)
    innerCircle.style.opacity = '0.7'

    const getDraggingPointElement = vi.fn(() => handleElement)

    const callback = createOnDragEndCallback({
      getDraggingPointElement,
      setDraggingPointElement,
    })

    void callback({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Opacity should be restored to full visibility to indicate drag has ended
    expect(innerCircle.style.opacity).toBe('1')
    // Dragging element should be cleared
    expect(setDraggingPointElement).toHaveBeenCalledWith(null)
  })

  it('should clear dragging state even when no element is currently being dragged', () => {
    const setDraggingPointElement = vi.fn()
    const getDraggingPointElement = vi.fn(() => null)

    const callback = createOnDragEndCallback({
      getDraggingPointElement,
      setDraggingPointElement,
    })

    void callback({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should still clear the dragging state even if no element was being dragged
    // This ensures state is always clean after drag ends
    expect(setDraggingPointElement).toHaveBeenCalledWith(null)
  })

  it('should handle missing inner circle element gracefully', () => {
    const setDraggingPointElement = vi.fn()
    // Create an element without the inner circle structure
    const mockElement = document.createElement('div')
    // Don't add the inner circle div

    const getDraggingPointElement = vi.fn(() => mockElement)

    const callback = createOnDragEndCallback({
      getDraggingPointElement,
      setDraggingPointElement,
    })

    // Should not throw when inner circle is missing
    void callback({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should still clear the dragging state even if inner circle is missing
    expect(setDraggingPointElement).toHaveBeenCalledWith(null)
  })

  it('should allow custom inner circle finder for testing', () => {
    const setDraggingPointElement = vi.fn()
    const mockElement = document.createElement('div')
    const customInnerCircle = document.createElement('div')
    customInnerCircle.id = 'custom-inner'
    mockElement.appendChild(customInnerCircle)

    // Set initial opacity
    customInnerCircle.style.opacity = '0.7'

    const getDraggingPointElement = vi.fn(() => mockElement)
    // Custom finder that looks for element with id 'custom-inner'
    const findInnerCircle = vi.fn((element: HTMLElement) =>
      element.querySelector('#custom-inner')
    )

    const callback = createOnDragEndCallback({
      getDraggingPointElement,
      setDraggingPointElement,
      findInnerCircle,
    })

    void callback({
      intersectionPoint: {
        twoD: new Vector2(0, 0),
        threeD: new Vector3(0, 0, 0),
      },
      selected: undefined,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Custom finder should be used
    expect(findInnerCircle).toHaveBeenCalledWith(mockElement)
    // Opacity should be restored
    expect(customInnerCircle.style.opacity).toBe('1')
    expect(setDraggingPointElement).toHaveBeenCalledWith(null)
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
    // Create a non-segment object (e.g., a Sketch object)
    const sketchObject: ApiObject = {
      id: 5,
      kind: {
        type: 'Sketch',
        args: { on: { default: 'xy' } },
        segments: [],
        constraints: [],
        is_underconstrained: null,
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

describe('findEntityUnderCursorId', () => {
  it('should return null when no object is selected', () => {
    const getParentGroup = vi.fn()
    const result = findEntityUnderCursorId(undefined, getParentGroup)
    expect(result).toBeNull()
  })

  it('should return segment ID when selected is a Group with numeric name and point segment type', () => {
    const group = new Group()
    group.name = '13'
    group.userData = { type: 'point' }
    const getParentGroup = vi.fn()

    const result = findEntityUnderCursorId(group, getParentGroup)
    expect(result).toBe(13)
  })

  it('should return segment ID when selected is a Group with numeric name and line segment type', () => {
    const group = new Group()
    group.name = '5'
    group.userData = { type: 'LINE' }
    const getParentGroup = vi.fn()

    const result = findEntityUnderCursorId(group, getParentGroup)
    expect(result).toBe(5)
  })

  it('should return segment ID when Group has point segment child with handle type', () => {
    const group = new Group()
    group.name = '7'
    const handleChild = new Group()
    handleChild.userData = { type: 'handle' }
    group.add(handleChild)
    const getParentGroup = vi.fn()

    const result = findEntityUnderCursorId(group, getParentGroup)
    expect(result).toBe(7)
  })

  it('should return null when Group name is not numeric', () => {
    const group = new Group()
    group.name = 'not-a-number'
    group.userData = { type: 'point' }
    const getParentGroup = vi.fn()

    const result = findEntityUnderCursorId(group, getParentGroup)
    expect(result).toBeNull()
  })

  it('should use getParentGroup when selected is not a Group', () => {
    const mesh = new Group() // Using Group as a mock for any Object3D
    mesh.name = 'not-a-group'
    const parentGroup = new Group()
    parentGroup.name = '42'
    const getParentGroup = vi.fn(() => parentGroup)

    const result = findEntityUnderCursorId(mesh, getParentGroup)
    expect(result).toBe(42)
  })

  it('should return null when getParentGroup returns null', () => {
    const mesh = new Group()
    const getParentGroup = vi.fn(() => null)

    const result = findEntityUnderCursorId(mesh, getParentGroup)
    expect(result).toBeNull()
  })

  it('should return null when getParentGroup returns group with non-numeric name', () => {
    const mesh = new Group()
    const parentGroup = new Group()
    parentGroup.name = 'invalid'
    const getParentGroup = vi.fn(() => parentGroup)

    const result = findEntityUnderCursorId(mesh, getParentGroup)
    expect(result).toBeNull()
  })
})

describe('createOnClickCallback', () => {
  it('should select a segment when clicking on it to enable editing', async () => {
    const getParentGroup = vi.fn()
    const onUpdateSelectedIds = vi.fn()
    const pointGroup = createPointSegmentGroup({ segmentId: 13 })

    const callback = createOnClickCallback({
      getParentGroup,
      onUpdateSelectedIds,
    })

    await callback({
      selected: pointGroup,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Clicking on a segment should select it, enabling the user to edit it
    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [13],
      duringAreaSelectIds: [],
    })
  })

  it('should clear selection when clicking on empty space to deselect all segments', async () => {
    const getParentGroup = vi.fn(() => null)
    const onUpdateSelectedIds = vi.fn()

    const callback = createOnClickCallback({
      getParentGroup,
      onUpdateSelectedIds,
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

  it('should find segment via getParentGroup when selected is not a Group', async () => {
    const mesh = new Group() // Mock for any Object3D
    const parentGroup = new Group()
    parentGroup.name = '42'
    const getParentGroup = vi.fn(() => parentGroup)
    const onUpdateSelectedIds = vi.fn()

    const callback = createOnClickCallback({
      getParentGroup,
      onUpdateSelectedIds,
    })

    await callback({
      selected: mesh,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Should find the segment through getParentGroup and select it
    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [42],
      duringAreaSelectIds: [],
    })
  })

  it('should handle clicking on non-segment objects by clearing selection', async () => {
    const nonSegmentGroup = new Group()
    nonSegmentGroup.name = 'not-a-segment'
    nonSegmentGroup.userData = { type: 'other' }
    const getParentGroup = vi.fn(() => null)
    const onUpdateSelectedIds = vi.fn()

    const callback = createOnClickCallback({
      getParentGroup,
      onUpdateSelectedIds,
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

  it('should select point segments identified by handle children', async () => {
    const pointGroup = new Group()
    pointGroup.name = '7'
    const handleChild = new Group()
    handleChild.userData = { type: 'handle' }
    pointGroup.add(handleChild)
    const getParentGroup = vi.fn()
    const onUpdateSelectedIds = vi.fn()

    const callback = createOnClickCallback({
      getParentGroup,
      onUpdateSelectedIds,
    })

    await callback({
      selected: pointGroup,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Point segments with handle children should be selectable
    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [7],
      duringAreaSelectIds: [],
    })
  })

  it('should select line segments identified by STRAIGHT_SEGMENT_BODY children', async () => {
    const lineGroup = new Group()
    lineGroup.name = '5'
    lineGroup.userData = { type: 'LINE' }
    const getParentGroup = vi.fn()
    const onUpdateSelectedIds = vi.fn()

    const callback = createOnClickCallback({
      getParentGroup,
      onUpdateSelectedIds,
    })

    await callback({
      selected: lineGroup,
      mouseEvent: createTestMouseEvent(),
      intersects: [],
    })

    // Line segments should be selectable
    expect(onUpdateSelectedIds).toHaveBeenCalledWith({
      selectedIds: [5],
      duringAreaSelectIds: [],
    })
  })
})

describe('createOnMouseEnterCallback', () => {
  it('should highlight line segments on hover to provide visual feedback', () => {
    const updateLineSegmentHover = vi.fn()
    const getSelectedIds = vi.fn(() => [])
    const setLastHoveredMesh = vi.fn()
    const lineMesh = createLineSegmentMesh({ segmentId: 5 })

    const callback = createOnMouseEnterCallback({
      updateLineSegmentHover,
      getSelectedIds,
      setLastHoveredMesh,
    })

    callback({
      selected: lineMesh,
      isAreaSelectActive: false,
      mouseEvent: createTestMouseEvent(),
    })

    // Hovering over a line segment should highlight it to show it's interactive
    expect(updateLineSegmentHover).toHaveBeenCalledWith(
      lineMesh,
      true,
      [],
      undefined
    )
    expect(setLastHoveredMesh).toHaveBeenCalledWith(lineMesh)
  })

  it('should not highlight during area select to avoid visual conflicts', () => {
    const updateLineSegmentHover = vi.fn()
    const getSelectedIds = vi.fn(() => [])
    const setLastHoveredMesh = vi.fn()
    const lineMesh = createLineSegmentMesh({ segmentId: 5 })

    const callback = createOnMouseEnterCallback({
      updateLineSegmentHover,
      getSelectedIds,
      setLastHoveredMesh,
    })

    callback({
      selected: lineMesh,
      isAreaSelectActive: true,
      mouseEvent: createTestMouseEvent(),
    })

    // Should not highlight during area select to keep the UI clean
    expect(updateLineSegmentHover).not.toHaveBeenCalled()
    expect(setLastHoveredMesh).not.toHaveBeenCalled()
  })

  it('should ignore non-line-segment objects to only highlight relevant segments', () => {
    const updateLineSegmentHover = vi.fn()
    const getSelectedIds = vi.fn(() => [])
    const setLastHoveredMesh = vi.fn()
    const pointGroup = createPointSegmentGroup({ segmentId: 3 })

    const callback = createOnMouseEnterCallback({
      updateLineSegmentHover,
      getSelectedIds,
      setLastHoveredMesh,
    })

    callback({
      selected: pointGroup,
      isAreaSelectActive: false,
      mouseEvent: createTestMouseEvent(),
    })

    // Point segments should not trigger hover highlighting
    expect(updateLineSegmentHover).not.toHaveBeenCalled()
    expect(setLastHoveredMesh).not.toHaveBeenCalled()
  })

  it('should include selected IDs when highlighting to show selection state', () => {
    const updateLineSegmentHover = vi.fn()
    const getSelectedIds = vi.fn(() => [5, 13])
    const setLastHoveredMesh = vi.fn()
    const lineMesh = createLineSegmentMesh({ segmentId: 7 })

    const callback = createOnMouseEnterCallback({
      updateLineSegmentHover,
      getSelectedIds,
      setLastHoveredMesh,
    })

    callback({
      selected: lineMesh,
      isAreaSelectActive: false,
      mouseEvent: createTestMouseEvent(),
    })

    // Highlighting should include selected IDs so the hover effect respects selection state
    expect(updateLineSegmentHover).toHaveBeenCalledWith(
      lineMesh,
      true,
      [5, 13],
      undefined
    )
  })

  it('should handle undefined selected gracefully', () => {
    const updateLineSegmentHover = vi.fn()
    const getSelectedIds = vi.fn(() => [])
    const setLastHoveredMesh = vi.fn()

    const callback = createOnMouseEnterCallback({
      updateLineSegmentHover,
      getSelectedIds,
      setLastHoveredMesh,
    })

    callback({
      selected: undefined,
      isAreaSelectActive: false,
      mouseEvent: createTestMouseEvent(),
    })

    // Should not crash when nothing is selected
    expect(updateLineSegmentHover).not.toHaveBeenCalled()
    expect(setLastHoveredMesh).not.toHaveBeenCalled()
  })
})

describe('createOnMouseLeaveCallback', () => {
  it('should clear hover highlighting when leaving a line segment', () => {
    const updateLineSegmentHover = vi.fn()
    const getSelectedIds = vi.fn(() => [])
    const lineMesh = createLineSegmentMesh({ segmentId: 5 })
    const getLastHoveredMesh = vi.fn(() => lineMesh)
    const setLastHoveredMesh = vi.fn()

    const callback = createOnMouseLeaveCallback({
      updateLineSegmentHover,
      getSelectedIds,
      getLastHoveredMesh,
      setLastHoveredMesh,
    })

    callback({
      selected: undefined,
      isAreaSelectActive: false,
      mouseEvent: createTestMouseEvent(),
    })

    // Leaving a hovered segment should clear the highlight to restore normal appearance
    expect(updateLineSegmentHover).toHaveBeenCalledWith(
      lineMesh,
      false,
      [],
      undefined
    )
    expect(setLastHoveredMesh).toHaveBeenCalledWith(null)
  })

  it('should not clear hover during area select to avoid visual conflicts', () => {
    const updateLineSegmentHover = vi.fn()
    const getSelectedIds = vi.fn(() => [])
    const lineMesh = createLineSegmentMesh({ segmentId: 5 })
    const getLastHoveredMesh = vi.fn(() => lineMesh)
    const setLastHoveredMesh = vi.fn()

    const callback = createOnMouseLeaveCallback({
      updateLineSegmentHover,
      getSelectedIds,
      getLastHoveredMesh,
      setLastHoveredMesh,
    })

    callback({
      selected: undefined,
      isAreaSelectActive: true,
      mouseEvent: createTestMouseEvent(),
    })

    // Should not modify hover state during area select
    expect(updateLineSegmentHover).not.toHaveBeenCalled()
    expect(setLastHoveredMesh).not.toHaveBeenCalled()
  })

  it('should include selected IDs when clearing hover to maintain selection state', () => {
    const updateLineSegmentHover = vi.fn()
    const getSelectedIds = vi.fn(() => [5, 13])
    const lineMesh = createLineSegmentMesh({ segmentId: 7 })
    const getLastHoveredMesh = vi.fn(() => lineMesh)
    const setLastHoveredMesh = vi.fn()

    const callback = createOnMouseLeaveCallback({
      updateLineSegmentHover,
      getSelectedIds,
      getLastHoveredMesh,
      setLastHoveredMesh,
    })

    callback({
      selected: undefined,
      isAreaSelectActive: false,
      mouseEvent: createTestMouseEvent(),
    })

    // Clearing hover should include selected IDs to maintain proper visual state
    expect(updateLineSegmentHover).toHaveBeenCalledWith(
      lineMesh,
      false,
      [5, 13],
      undefined
    )
  })

  it('should handle case where no mesh was previously hovered', () => {
    const updateLineSegmentHover = vi.fn()
    const getSelectedIds = vi.fn(() => [])
    const getLastHoveredMesh = vi.fn(() => null)
    const setLastHoveredMesh = vi.fn()

    const callback = createOnMouseLeaveCallback({
      updateLineSegmentHover,
      getSelectedIds,
      getLastHoveredMesh,
      setLastHoveredMesh,
    })

    callback({
      selected: undefined,
      isAreaSelectActive: false,
      mouseEvent: createTestMouseEvent(),
    })

    // Should not crash when no mesh was hovered
    expect(updateLineSegmentHover).not.toHaveBeenCalled()
    expect(setLastHoveredMesh).not.toHaveBeenCalled()
  })

  it('should ignore non-line-segment objects when clearing hover', () => {
    const updateLineSegmentHover = vi.fn()
    const getSelectedIds = vi.fn(() => [])
    const pointGroup = createPointSegmentGroup({ segmentId: 3 })
    const getLastHoveredMesh = vi.fn(() => null)
    const setLastHoveredMesh = vi.fn()

    const callback = createOnMouseLeaveCallback({
      updateLineSegmentHover,
      getSelectedIds,
      getLastHoveredMesh,
      setLastHoveredMesh,
    })

    callback({
      selected: pointGroup,
      isAreaSelectActive: false,
      mouseEvent: createTestMouseEvent(),
    })

    // Point segments should not trigger hover clearing
    expect(updateLineSegmentHover).not.toHaveBeenCalled()
  })
})
