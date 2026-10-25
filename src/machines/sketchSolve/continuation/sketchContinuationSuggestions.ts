import type { ApiObject, SegmentCtor } from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import {
  getLinePoints,
  isConstruction,
  isLineSegment,
  isOwnedLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'

type Point = readonly [number, number]

export type SketchContinuationSuggestion = {
  id: string
  label: string
  description: string
  segment: SegmentCtor
  preview: { x: number; y: number; radius: number }
}

function near(a: number, b: number, tolerance: number) {
  return Math.abs(a - b) <= tolerance
}

function isSquareProfile(lines: readonly (readonly [Point, Point])[]) {
  if (lines.length !== 4) return null
  const points = lines.flatMap(([start, end]) => [start, end])
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = maxX - minX
  const height = maxY - minY
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width / height < 0.8 ||
    width / height > 1.25
  ) {
    return null
  }
  const tolerance = Math.min(width, height) * 0.025
  const corners: Point[] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ]
  const edgeKeys = new Set<string>()
  for (const [start, end] of lines) {
    const cornerIndex = (point: Point) =>
      corners.findIndex(
        (corner) =>
          near(point[0], corner[0], tolerance) &&
          near(point[1], corner[1], tolerance)
      )
    const first = cornerIndex(start)
    const second = cornerIndex(end)
    if (
      first < 0 ||
      second < 0 ||
      ((first + 1) % 4 !== second && (second + 1) % 4 !== first)
    ) {
      return null
    }
    edgeKeys.add([first, second].sort().join('-'))
  }
  return edgeKeys.size === 4 ? { minX, minY, width, height } : null
}

function circle(
  center: Point,
  radius: number,
  units: NumericSuffix
): SegmentCtor {
  return {
    type: 'Circle',
    center: {
      x: { type: 'Var', value: center[0], units },
      y: { type: 'Var', value: center[1], units },
    },
    start: {
      x: { type: 'Var', value: center[0] + radius, units },
      y: { type: 'Var', value: center[1], units },
    },
  }
}

/** First continuation experiment: offer explicit, reversible edits for a square. */
export function suggestSketchContinuations(
  sketchId: number,
  objects: readonly ApiObject[],
  units: NumericSuffix
): SketchContinuationSuggestion[] {
  const sketch = objects[sketchId]
  if (sketch?.kind.type !== 'Sketch') return []
  const geometry = sketch.kind.segments
    .map((id) => objects[id])
    .filter((object) => object && !isPointSegment(object))
  if (
    geometry.length !== 4 ||
    !geometry.every(isLineSegment) ||
    geometry.some(
      (object) => isConstruction(object) || isOwnedLineSegment(object)
    )
  ) {
    return []
  }
  const lines: (readonly [Point, Point])[] = []
  for (const line of geometry) {
    const points = getLinePoints(line, [...objects])
    if (!points) return []
    lines.push(points)
  }
  const square = isSquareProfile(lines)
  if (!square) return []

  const size = Math.min(square.width, square.height)
  const center: Point = [
    square.minX + square.width / 2,
    square.minY + square.height / 2,
  ]
  const offset: Point = [
    square.minX + square.width * 0.25,
    square.minY + square.height * 0.25,
  ]
  return [
    {
      id: 'centered-circle',
      label: 'Add centered circle',
      description: 'A circle at the middle of the square',
      segment: circle(center, size * 0.2, units),
      preview: { x: 50, y: 50, radius: 16 },
    },
    {
      id: 'offset-circle',
      label: 'Add offset circle',
      description: 'A smaller circle near one corner',
      segment: circle(offset, size * 0.1, units),
      preview: { x: 30, y: 70, radius: 8 },
    },
  ]
}
