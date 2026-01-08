import { describe, it, expect } from 'vitest'
import { Group, Vector2, Vector3, OrthographicCamera } from 'three'
import {
  project3DToScreen,
  calculateBoxBounds,
  isIntersectionSelectionMode,
  doBoxesIntersect,
  areAllPointsContained,
  calculateSelectionBoxProperties,
  calculateLabelPositioning,
  calculateCornerLineStyles,
  calculateLabelStyles,
  transformToLocalSpace,
  extractTrianglesFromMesh,
  doesTriangleIntersectBox,
  doesAnyPolygonIntersectBox,
  doesSegmentIntersectSelectionBox,
} from '@src/machines/sketchSolve/tools/moveTool/areaSelectUtils'
import { createLineSegmentMesh } from '@src/machines/sketchSolve/tools/moveTool/moveTool.spec'

describe('project3DToScreen', () => {
  it('should project 3D world coordinates to 2D screen coordinates', () => {
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    const viewportSize = new Vector2(800, 600)

    // Point at origin should project to center of screen
    const point3D = new Vector3(0, 0, 0)
    const screenPos = project3DToScreen(point3D, camera, viewportSize)

    // Center of screen should be approximately (400, 300) for 800x600 viewport
    expect(screenPos.x).toBeCloseTo(400, 0)
    expect(screenPos.y).toBeCloseTo(300, 0)
  })

  it('should handle different viewport sizes correctly', () => {
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)

    // random numbers 3 and 4, but should be find since we're asserting relationship between the two
    const point3D = new Vector3(3, 4, 0)
    const smallViewport = new Vector2(400, 300)
    const largeViewport = new Vector2(1600, 1200)

    const smallScreen = project3DToScreen(point3D, camera, smallViewport)
    const largeScreen = project3DToScreen(point3D, camera, largeViewport)

    // Should scale proportionally with viewport size (1600/400 = 4x, 1200/300 = 4x)
    expect(largeScreen.x).toBeCloseTo(smallScreen.x * 4, 0)
    expect(largeScreen.y).toBeCloseTo(smallScreen.y * 4, 0)
  })
})

describe('calculateBoxBounds', () => {
  it('should calculate correct min/max bounds from two points', () => {
    const point1 = new Vector2(10, 20)
    const point2 = new Vector2(30, 40)

    const bounds = calculateBoxBounds(point1, point2)

    expect(bounds.min.x).toBe(10)
    expect(bounds.min.y).toBe(20)
    expect(bounds.max.x).toBe(30)
    expect(bounds.max.y).toBe(40)
  })

  it('should handle points in reverse order correctly', () => {
    const point1 = new Vector2(30, 40)
    const point2 = new Vector2(10, 20)

    const bounds = calculateBoxBounds(point1, point2)

    // Should still produce correct min/max regardless of order
    expect(bounds.min.x).toBe(10)
    expect(bounds.min.y).toBe(20)
    expect(bounds.max.x).toBe(30)
    expect(bounds.max.y).toBe(40)
  })

  it('should handle negative coordinates', () => {
    const point1 = new Vector2(-10, -20)
    const point2 = new Vector2(30, 40)

    const bounds = calculateBoxBounds(point1, point2)

    expect(bounds.min.x).toBe(-10)
    expect(bounds.min.y).toBe(-20)
    expect(bounds.max.x).toBe(30)
    expect(bounds.max.y).toBe(40)
  })
})

describe('isIntersectionSelectionMode', () => {
  it('should return true for right-to-left drag (intersection mode)', () => {
    const startPoint = new Vector2(100, 50)
    const currentPoint = new Vector2(50, 50)

    const result = isIntersectionSelectionMode(startPoint, currentPoint)

    // Right-to-left drag should use intersection mode
    expect(result).toBe(true)
  })

  it('should return false for left-to-right drag (contains mode)', () => {
    const startPoint = new Vector2(50, 50)
    const currentPoint = new Vector2(100, 50)

    const result = isIntersectionSelectionMode(startPoint, currentPoint)

    // Left-to-right drag should use contains mode
    expect(result).toBe(false)
  })

  it('should return false when start and current are at same x position', () => {
    const startPoint = new Vector2(50, 50)
    const currentPoint = new Vector2(50, 100)

    const result = isIntersectionSelectionMode(startPoint, currentPoint)

    // Vertical drag should use contains mode
    expect(result).toBe(false)
  })
})

describe('doBoxesIntersect', () => {
  it('should return true when boxes overlap', () => {
    const box1Min = new Vector2(10, 10)
    const box1Max = new Vector2(30, 30)
    const box2Min = new Vector2(20, 20)
    const box2Max = new Vector2(40, 40)

    const result = doBoxesIntersect(box1Min, box1Max, box2Min, box2Max)

    // Overlapping boxes should intersect
    expect(result).toBe(true)
  })

  it('should return false when boxes do not overlap', () => {
    const box1Min = new Vector2(10, 10)
    const box1Max = new Vector2(20, 20)
    const box2Min = new Vector2(30, 30)
    const box2Max = new Vector2(40, 40)

    const result = doBoxesIntersect(box1Min, box1Max, box2Min, box2Max)

    // Non-overlapping boxes should not intersect
    expect(result).toBe(false)
  })

  it('should return true when boxes touch at edges', () => {
    const box1Min = new Vector2(10, 10)
    const box1Max = new Vector2(20, 20)
    const box2Min = new Vector2(20, 10)
    const box2Max = new Vector2(30, 20)

    const result = doBoxesIntersect(box1Min, box1Max, box2Min, box2Max)

    // Touching boxes should intersect
    expect(result).toBe(true)
  })

  it('should return true when one box is completely inside another', () => {
    const box1Min = new Vector2(10, 10)
    const box1Max = new Vector2(50, 50)
    const box2Min = new Vector2(20, 20)
    const box2Max = new Vector2(30, 30)

    const result = doBoxesIntersect(box1Min, box1Max, box2Min, box2Max)

    // Nested boxes should intersect
    expect(result).toBe(true)
  })
})

describe('areAllPointsContained', () => {
  it('should return true when all points are within the box', () => {
    const points = [
      new Vector2(15, 15),
      new Vector2(20, 20),
      new Vector2(25, 25),
    ]
    const boxMin = new Vector2(10, 10)
    const boxMax = new Vector2(30, 30)

    const result = areAllPointsContained(points, boxMin, boxMax)

    // All points inside should return true
    expect(result).toBe(true)
  })

  it('should return false when any point is outside the box', () => {
    const points = [
      new Vector2(15, 15),
      new Vector2(35, 20), // This one is outside
      new Vector2(25, 25),
    ]
    const boxMin = new Vector2(10, 10)
    const boxMax = new Vector2(30, 30)

    const result = areAllPointsContained(points, boxMin, boxMax)

    // Any point outside should return false
    expect(result).toBe(false)
  })

  it('should return true when points are on the box boundaries', () => {
    const points = [
      new Vector2(10, 10), // On min corner
      new Vector2(30, 30), // On max corner
      new Vector2(20, 10), // On edge
    ]
    const boxMin = new Vector2(10, 10)
    const boxMax = new Vector2(30, 30)

    const result = areAllPointsContained(points, boxMin, boxMax)

    // Points on boundaries should be considered contained
    expect(result).toBe(true)
  })

  it('should return true for empty array', () => {
    const points: Array<Vector2> = []
    const boxMin = new Vector2(10, 10)
    const boxMax = new Vector2(30, 30)

    const result = areAllPointsContained(points, boxMin, boxMax)

    // Empty array should return true (vacuous truth)
    expect(result).toBe(true)
  })
})

describe('calculateSelectionBoxProperties', () => {
  it('should calculate all selection box properties from 3D points', () => {
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    const viewportSize = new Vector2(800, 600)
    const startPoint3D = new Vector3(0, 0, 0)
    const currentPoint3D = new Vector3(5, 5, 0)

    const result = calculateSelectionBoxProperties(
      startPoint3D,
      currentPoint3D,
      camera,
      viewportSize
    )

    // Should calculate all required properties
    expect(result.widthPx).toBeGreaterThan(0)
    expect(result.heightPx).toBeGreaterThan(0)
    expect(result.boxMinPx).toBeInstanceOf(Vector2)
    expect(result.boxMaxPx).toBeInstanceOf(Vector2)
    expect(result.startPx).toBeInstanceOf(Vector2)
    expect(result.currentPx).toBeInstanceOf(Vector2)
    expect(typeof result.isIntersectionBox).toBe('boolean')
    expect(typeof result.isDraggingUpward).toBe('boolean')
    expect(result.borderStyle).toMatch(/^(dashed|solid)$/)
    expect(result.center3D).toBeInstanceOf(Vector3)
  })

  it('should determine intersection mode for right-to-left drag', () => {
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    const viewportSize = new Vector2(800, 600)
    // Right-to-left drag: start at x=100, end at x=50
    const startPoint3D = new Vector3(10, 0, 0)
    const currentPoint3D = new Vector3(5, 0, 0)

    const result = calculateSelectionBoxProperties(
      startPoint3D,
      currentPoint3D,
      camera,
      viewportSize
    )

    // Right-to-left should use intersection mode (dashed border)
    expect(result.isIntersectionBox).toBe(true)
    expect(result.borderStyle).toBe('dashed')
  })

  it('should determine contains mode for left-to-right drag', () => {
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    const viewportSize = new Vector2(800, 600)
    // Left-to-right drag: start at x=50, end at x=100
    const startPoint3D = new Vector3(5, 0, 0)
    const currentPoint3D = new Vector3(10, 0, 0)

    const result = calculateSelectionBoxProperties(
      startPoint3D,
      currentPoint3D,
      camera,
      viewportSize
    )

    // Left-to-right should use contains mode (solid border)
    expect(result.isIntersectionBox).toBe(false)
    expect(result.borderStyle).toBe('solid')
  })

  it('should detect upward drag direction', () => {
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    const viewportSize = new Vector2(800, 600)
    // Upward drag: start at y=50, end at y=100 (higher y = upward in screen space)
    const startPoint3D = new Vector3(0, 5, 0)
    const currentPoint3D = new Vector3(0, 10, 0)

    const result = calculateSelectionBoxProperties(
      startPoint3D,
      currentPoint3D,
      camera,
      viewportSize
    )

    // Should detect upward drag
    expect(result.isDraggingUpward).toBe(true)
  })

  it('should calculate correct center point in 3D space', () => {
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    const viewportSize = new Vector2(800, 600)
    const startPoint3D = new Vector3(0, 0, 0)
    const currentPoint3D = new Vector3(10, 10, 5)

    const result = calculateSelectionBoxProperties(
      startPoint3D,
      currentPoint3D,
      camera,
      viewportSize
    )

    // Center should be midpoint: (0+10)/2, (0+10)/2, (0+5)/2 = (5, 5, 2.5)
    expect(result.center3D.x).toBeCloseTo(5, 5)
    expect(result.center3D.y).toBeCloseTo(5, 5)
    expect(result.center3D.z).toBeCloseTo(2.5, 5)
  })
})

describe('calculateLabelPositioning', () => {
  it('should calculate label position relative to box center', () => {
    const startPx = new Vector2(100, 150)
    const boxMinPx = new Vector2(50, 100)
    const boxMaxPx = new Vector2(150, 200)
    const isDraggingUpward = false

    const result = calculateLabelPositioning(
      startPx,
      boxMinPx,
      boxMaxPx,
      isDraggingUpward
    )

    // Box center should be at (100, 150)
    // Start point is at (100, 150), so offset should be (0, 0)
    expect(result.offsetX).toBeCloseTo(0, 5)
    expect(result.offsetY).toBeCloseTo(0, 5)
    expect(result.startX).toBeCloseTo(0, 5)
    expect(result.startY).toBeCloseTo(0, 5)
    // For downward drag, finalOffsetY should be negative (labels above)
    expect(result.finalOffsetY).toBeLessThan(0)
  })

  it('should adjust vertical offset for upward drag', () => {
    const startPx = new Vector2(100, 100)
    const boxMinPx = new Vector2(50, 50)
    const boxMaxPx = new Vector2(150, 150)
    const isDraggingUpward = true

    const result = calculateLabelPositioning(
      startPx,
      boxMinPx,
      boxMaxPx,
      isDraggingUpward
    )

    // For upward drag, labels should be below (positive offset)
    expect(result.finalOffsetY).toBeGreaterThan(result.offsetY)
  })

  it('should calculate correct offset when start point is not at center', () => {
    const startPx = new Vector2(50, 100)
    const boxMinPx = new Vector2(50, 100)
    const boxMaxPx = new Vector2(150, 200)
    const isDraggingUpward = false

    const result = calculateLabelPositioning(
      startPx,
      boxMinPx,
      boxMaxPx,
      isDraggingUpward
    )

    // Box center is at (100, 150), start is at (50, 100)
    // Offset should be: (50 - 100, 100 - 150) = (-50, -50)
    expect(result.offsetX).toBeCloseTo(-50, 5)
    expect(result.offsetY).toBeCloseTo(-50, 5)
    expect(result.startX).toBeCloseTo(-50, 5)
    expect(result.startY).toBeCloseTo(-50, 5)
  })
})

describe('calculateCornerLineStyles', () => {
  it('should position vertical line correctly when start point is above center', () => {
    const startX = 0
    const startY = 10 // Above center (positive y)
    const lineExtensionSize = 12
    const borderWidth = 2

    const result = calculateCornerLineStyles(
      startX,
      startY,
      lineExtensionSize,
      borderWidth
    )

    // When startY > 0, line should extend upward (bottom property set)
    expect(result.verticalLine.bottom).toBe('-14px')
    expect(result.verticalLine.top).toBeUndefined()
    // When startX = 0, should use left (since startX is not > 0)
    expect(result.verticalLine.left).toBe('-2px')
    expect(result.verticalLine.right).toBeUndefined()
  })

  it('should position vertical line correctly when start point is below center', () => {
    const startX = 0
    const startY = -10 // Below center (negative y)
    const lineExtensionSize = 12
    const borderWidth = 2

    const result = calculateCornerLineStyles(
      startX,
      startY,
      lineExtensionSize,
      borderWidth
    )

    // When startY < 0, line should extend downward (top property set)
    expect(result.verticalLine.top).toBe('-14px')
    expect(result.verticalLine.bottom).toBeUndefined()
  })

  it('should position horizontal line correctly when start point is left of center', () => {
    const startX = -10 // Left of center
    const startY = 0
    const lineExtensionSize = 12
    const borderWidth = 2

    const result = calculateCornerLineStyles(
      startX,
      startY,
      lineExtensionSize,
      borderWidth
    )

    // When startX < 0, line should extend leftward
    expect(result.horizontalLine.left).toBe('-14px')
    expect(result.horizontalLine.right).toBeUndefined()
  })

  it('should position horizontal line correctly when start point is right of center', () => {
    const startX = 10 // Right of center
    const startY = 0
    const lineExtensionSize = 12
    const borderWidth = 2

    const result = calculateCornerLineStyles(
      startX,
      startY,
      lineExtensionSize,
      borderWidth
    )

    // When startX > 0, line should extend rightward
    expect(result.horizontalLine.right).toBe('-14px')
    expect(result.horizontalLine.left).toBeUndefined()
  })

  it('should set correct line dimensions', () => {
    const startX = 0
    const startY = 0
    const lineExtensionSize = 12
    const borderWidth = 2

    const result = calculateCornerLineStyles(
      startX,
      startY,
      lineExtensionSize,
      borderWidth
    )

    // Vertical line should have height
    expect(result.verticalLine.height).toBe('12px')
    // Horizontal line should have width
    expect(result.horizontalLine.width).toBe('12px')
  })
})

describe('calculateLabelStyles', () => {
  it('should highlight intersects label in intersection mode', () => {
    const result = calculateLabelStyles(true)

    // Intersection mode: "Intersects" should be prominent
    expect(result.intersectsLabel.opacity).toBe('1')
    expect(result.intersectsLabel.fontWeight).toBe('600')
    // "Within" should be less prominent
    expect(result.containsLabel.opacity).toBe('0.4')
    expect(result.containsLabel.fontWeight).toBe('400')
  })

  it('should highlight contains label in contains mode', () => {
    const result = calculateLabelStyles(false)

    // Contains mode: "Within" should be prominent
    expect(result.containsLabel.opacity).toBe('1')
    expect(result.containsLabel.fontWeight).toBe('600')
    // "Intersects" should be less prominent
    expect(result.intersectsLabel.opacity).toBe('0.4')
    expect(result.intersectsLabel.fontWeight).toBe('400')
  })
})

describe('transformToLocalSpace', () => {
  it('should transform world position to local space when group exists', () => {
    const center3D = new Vector3(10, 20, 30)
    const sketchSceneGroup = new Group()
    sketchSceneGroup.position.set(5, 5, 5)

    const result = transformToLocalSpace(center3D, sketchSceneGroup)

    // Should transform relative to group position
    expect(result).toBeInstanceOf(Vector3)
    // The exact values depend on Three.js transformation, but should be different from input
    expect(result.x).not.toBe(center3D.x)
    expect(result.y).not.toBe(center3D.y)
    expect(result.z).not.toBe(center3D.z)
  })

  it('should return original position when group is null', () => {
    const center3D = new Vector3(10, 20, 30)

    const result = transformToLocalSpace(center3D, null)

    // Should return a copy of the original position
    expect(result).toBeInstanceOf(Vector3)
    expect(result.x).toBe(10)
    expect(result.y).toBe(20)
    expect(result.z).toBe(30)
    // Should be a new object (copy)
    expect(result).not.toBe(center3D)
  })

  it('should handle rotated group correctly', () => {
    const center3D = new Vector3(10, 0, 0)
    const sketchSceneGroup = new Group()
    sketchSceneGroup.rotation.z = Math.PI / 2 // Rotate 90 degrees

    const result = transformToLocalSpace(center3D, sketchSceneGroup)

    // Should transform according to rotation
    expect(result).toBeInstanceOf(Vector3)
    // After 90 degree rotation, x should map to -y in local space
    expect(result.y).toBeCloseTo(-10, 5)
  })
})

describe('extractTrianglesFromMesh', () => {
  it('should extract triangles from a mesh geometry and project to screen space', () => {
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    const viewportSize = new Vector2(800, 600)

    // Create a simple mesh with known geometry
    const lineMesh = createLineSegmentMesh({ segmentId: 1 })

    const triangles = extractTrianglesFromMesh(lineMesh, camera, viewportSize)

    // Should extract at least some triangles from the mesh
    expect(triangles.length).toBeGreaterThan(0)
    // Each triangle should have 3 vertices
    triangles.forEach((triangle) => {
      expect(triangle).toHaveLength(3)
      triangle.forEach((vertex) => {
        expect(vertex).toBeInstanceOf(Vector2)
      })
    })
  })
})

describe('doesTriangleIntersectBox', () => {
  it('should return true when triangle vertex is inside the box', () => {
    const triangle: [Vector2, Vector2, Vector2] = [
      new Vector2(50, 50), // Inside box
      new Vector2(200, 200),
      new Vector2(300, 300),
    ]
    const boxMin = new Vector2(0, 0)
    const boxMax = new Vector2(100, 100)

    const result = doesTriangleIntersectBox(triangle, boxMin, boxMax)

    // Triangle with vertex inside box should intersect
    expect(result).toBe(true)
  })

  it('should return true when triangle edge intersects box', () => {
    const triangle: [Vector2, Vector2, Vector2] = [
      new Vector2(-50, 50), // Outside box
      new Vector2(150, 50), // Outside box, but edge crosses through
      new Vector2(50, 150),
    ]
    const boxMin = new Vector2(0, 0)
    const boxMax = new Vector2(100, 100)

    const result = doesTriangleIntersectBox(triangle, boxMin, boxMax)

    // Triangle edge that crosses through box should intersect
    expect(result).toBe(true)
  })

  it('should return true when box is entirely inside triangle', () => {
    // Large triangle that contains the box
    // Triangle vertices form a triangle that definitely contains the box (0,0) to (50,50)
    const triangle: [Vector2, Vector2, Vector2] = [
      new Vector2(-10, -10), // Bottom-left of triangle
      new Vector2(100, -10), // Bottom-right of triangle
      new Vector2(45, 100), // Top of triangle (centered above box)
    ]
    const boxMin = new Vector2(0, 0)
    const boxMax = new Vector2(50, 50)

    const result = doesTriangleIntersectBox(triangle, boxMin, boxMax)

    // Box entirely inside triangle should intersect
    expect(result).toBe(true)
  })

  it('should return false when triangle is completely outside box', () => {
    const triangle: [Vector2, Vector2, Vector2] = [
      new Vector2(200, 200),
      new Vector2(300, 200),
      new Vector2(250, 300),
    ]
    const boxMin = new Vector2(0, 0)
    const boxMax = new Vector2(100, 100)

    const result = doesTriangleIntersectBox(triangle, boxMin, boxMax)

    // Triangle completely outside box should not intersect
    expect(result).toBe(false)
  })

  it('should return true when triangle touches box edge', () => {
    const triangle: [Vector2, Vector2, Vector2] = [
      new Vector2(100, 50), // On box edge
      new Vector2(150, 50),
      new Vector2(125, 100),
    ]
    const boxMin = new Vector2(0, 0)
    const boxMax = new Vector2(100, 100)

    const result = doesTriangleIntersectBox(triangle, boxMin, boxMax)

    // Triangle touching box edge should intersect
    expect(result).toBe(true)
  })
})

describe('doesAnyPolygonIntersectBox', () => {
  it('should return true when at least one polygon intersects', () => {
    const polygons: Array<[Vector2, Vector2, Vector2]> = [
      [new Vector2(200, 200), new Vector2(300, 200), new Vector2(250, 300)], // Outside
      [new Vector2(50, 50), new Vector2(60, 50), new Vector2(55, 60)], // Inside
      [new Vector2(500, 500), new Vector2(600, 500), new Vector2(550, 600)], // Outside
    ]
    const boxMin = new Vector2(0, 0)
    const boxMax = new Vector2(100, 100)

    const result = doesAnyPolygonIntersectBox(polygons, boxMin, boxMax)

    // Should return true because second polygon intersects
    expect(result).toBe(true)
  })

  it('should return false when no polygons intersect', () => {
    const polygons: Array<[Vector2, Vector2, Vector2]> = [
      [new Vector2(200, 200), new Vector2(300, 200), new Vector2(250, 300)],
      [new Vector2(400, 400), new Vector2(500, 400), new Vector2(450, 500)],
    ]
    const boxMin = new Vector2(0, 0)
    const boxMax = new Vector2(100, 100)

    const result = doesAnyPolygonIntersectBox(polygons, boxMin, boxMax)

    // Should return false when no polygons intersect
    expect(result).toBe(false)
  })

  it('should return false for empty array', () => {
    const polygons: Array<[Vector2, Vector2, Vector2]> = []
    const boxMin = new Vector2(0, 0)
    const boxMax = new Vector2(100, 100)

    const result = doesAnyPolygonIntersectBox(polygons, boxMin, boxMax)

    // Empty array should return false
    expect(result).toBe(false)
  })
})

describe('doesSegmentIntersectSelectionBox', () => {
  it('should return true when segment bounding box is entirely inside selection box', () => {
    const segmentMin = new Vector2(10, 10)
    const segmentMax = new Vector2(50, 50)
    const selectionMin = new Vector2(0, 0)
    const selectionMax = new Vector2(100, 100)
    const polygons: Array<[Vector2, Vector2, Vector2]> = []

    const result = doesSegmentIntersectSelectionBox(
      segmentMin,
      segmentMax,
      selectionMin,
      selectionMax,
      polygons
    )

    // Segment entirely inside should intersect (early exit, no polygon check needed)
    expect(result).toBe(true)
  })

  it('should return false when bounding boxes do not intersect', () => {
    const segmentMin = new Vector2(200, 200)
    const segmentMax = new Vector2(300, 300)
    const selectionMin = new Vector2(0, 0)
    const selectionMax = new Vector2(100, 100)
    const polygons: Array<[Vector2, Vector2, Vector2]> = []

    const result = doesSegmentIntersectSelectionBox(
      segmentMin,
      segmentMax,
      selectionMin,
      selectionMax,
      polygons
    )

    // Non-overlapping boxes should not intersect
    expect(result).toBe(false)
  })

  it('should check polygon intersection when bounding boxes overlap', () => {
    const segmentMin = new Vector2(50, 50)
    const segmentMax = new Vector2(150, 150)
    const selectionMin = new Vector2(0, 0)
    const selectionMax = new Vector2(100, 100)
    // Polygons that actually intersect the selection box
    const polygons: Array<[Vector2, Vector2, Vector2]> = [
      [new Vector2(50, 50), new Vector2(60, 50), new Vector2(55, 60)],
    ]

    const result = doesSegmentIntersectSelectionBox(
      segmentMin,
      segmentMax,
      selectionMin,
      selectionMax,
      polygons
    )

    // Should check polygons and find intersection
    expect(result).toBe(true)
  })

  it('should return false when bounding boxes overlap but no polygons intersect', () => {
    const segmentMin = new Vector2(50, 50)
    const segmentMax = new Vector2(150, 150)
    const selectionMin = new Vector2(0, 0)
    const selectionMax = new Vector2(100, 100)
    // Polygons that are in the segment but don't intersect selection box
    const polygons: Array<[Vector2, Vector2, Vector2]> = [
      [new Vector2(120, 120), new Vector2(130, 120), new Vector2(125, 130)],
    ]

    const result = doesSegmentIntersectSelectionBox(
      segmentMin,
      segmentMax,
      selectionMin,
      selectionMax,
      polygons
    )

    // Bounding boxes overlap but polygons don't intersect
    expect(result).toBe(false)
  })
})
