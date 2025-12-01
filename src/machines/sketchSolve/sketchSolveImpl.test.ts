import { describe, it, expect, vi } from 'vitest'
import { Group, Vector2, Vector3 } from 'three'
import {
  createOnDragStartCallback,
  createOnDragEndCallback,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import type { Themes } from '@src/lib/theme'

/**
 * Helper function to create a point segment group for testing.
 * Uses the same function that creates point segments in production,
 * ensuring tests match the actual runtime structure.
 */
function createPointSegmentGroup({
  segmentId,
  theme = 'dark' as Themes,
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
      mouseEvent: {} as MouseEvent,
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
      mouseEvent: {} as MouseEvent,
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
      mouseEvent: {} as MouseEvent,
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
      mouseEvent: {} as MouseEvent,
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
      mouseEvent: {} as MouseEvent,
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
      mouseEvent: {} as MouseEvent,
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
      mouseEvent: {} as MouseEvent,
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
      mouseEvent: {} as MouseEvent,
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
      mouseEvent: {} as MouseEvent,
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
      mouseEvent: {} as MouseEvent,
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
      mouseEvent: {} as MouseEvent,
      intersects: [],
    })

    // Custom finder should be used
    expect(findInnerCircle).toHaveBeenCalledWith(mockElement)
    // Opacity should be restored
    expect(customInnerCircle.style.opacity).toBe('1')
    expect(setDraggingPointElement).toHaveBeenCalledWith(null)
  })
})
