import type { KIITYCAD_GLTF_VERTEX, KITTYCAD_GLTF_CURVE3D, KITTYCAD_GLTF_EDGE } from './KITTYCAD_GLTF'
import { Vector3, Vector4 } from 'three'
import { calcBSplinePoint } from 'three/examples/jsm/curves/NURBSUtils.js'


type Evaluate = (t: number) => Vector3

// sampling.rs uses 0.002 after scaling metres by 1,000.
const CHORD_ERROR = 0.002 / 1_000
const MAX_SEGMENTS = 512
const MAX_DEPTH = 10

function lerp(a: number, b: number, t: number): number {
  return (1 - t) * a + t * b
}

export function sampleEdge(
  edge: KITTYCAD_GLTF_EDGE,
  curve: KITTYCAD_GLTF_CURVE3D,
  vertices: KIITYCAD_GLTF_VERTEX[]
): Vector3[] | Error {
  const [t0, t1] = edge.t

  if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
    return new Error('Non-finite curve parameter interval')
  }

  let points: Vector3[]

  switch (curve.type) {
    case 'line': {
      if (!edge.closed) {
        const start = vertices[edge.start]
        const end = vertices[edge.end]

        if (!start || !end) {
          return new Error('Missing line endpoints')
        }

        // Topological endpoints already follow the edge orientation.
        points = [
          new Vector3().fromArray(start),
          new Vector3().fromArray(end),
        ]
      } else {
        const origin = new Vector3().fromArray(
          curve.line.origin ?? [0, 0, 0]
        )
        const direction = new Vector3().fromArray(curve.line.direction)

        points = [t0, t1].map((t) =>
          origin.clone().addScaledVector(direction, t)
        )
      }
      break
    }

    case 'circle': {
      const circle = curve.circle

      if (!Number.isFinite(circle.radius)) {
        return new Error('Invalid circle radius')
      }

      const origin = new Vector3().fromArray(
        circle.origin ?? [0, 0, 0]
      )
      const x = new Vector3().fromArray(circle.xAxis ?? [1, 0, 0])
      const y = new Vector3().fromArray(circle.yAxis ?? [0, 1, 0])

      const evaluate: Evaluate = (t) =>
        origin
          .clone()
          .addScaledVector(x, circle.radius * Math.cos(t))
          .addScaledVector(y, circle.radius * Math.sin(t))

      points = sampleUniformly(
        evaluate,
        t0,
        t1,
        circleSegmentCount(circle.radius, t1 - t0)
      )
      break
    }

    case 'nurbs': {
      const {
        order,
        controlPoints,
        knotVector: knots,
        weights,
      } = curve.nurbs
      const count = controlPoints.length

      if (
        !Number.isInteger(order) ||
        order < 2 ||
        order > count ||
        knots.length !== count + order
      ) {
        return new Error('Invalid NURBS order or knot count')
      }

      if (
        knots.some(
          (k, i) =>
            !Number.isFinite(k) || (i > 0 && k < knots[i - 1])
        )
      ) {
        return new Error('NURBS knots must be finite and nondecreasing')
      }

      if (
        weights?.length &&
        (weights.length !== count ||
          weights.some((w) => !Number.isFinite(w)))
      ) {
        return new Error('Invalid NURBS weights')
      }

      const degree = order - 1
      const minimum = knots[degree]
      const maximum = knots[count]

      if (
        minimum >= maximum ||
        Math.min(t0, t1) < minimum ||
        Math.max(t0, t1) > maximum
      ) {
        return new Error('Edge interval is outside the NURBS knot domain')
      }

      // Supply Cartesian coordinates plus weight; Three applies the weights.
      const controls = controlPoints.map(
        ([x, y, z], i) => new Vector4(x, y, z, weights?.[i] ?? 1)
      )

      const evaluate: Evaluate = (t) => {
        // Original knot parameter, not normalized [0, 1].
        const p = calcBSplinePoint(degree, knots, controls, t)
        return new Vector3(p.x / p.w, p.y / p.w, p.z / p.w)
      }

      const start = evaluate(t0)
      const end = evaluate(t1)

      points = [start]
      subdivide(evaluate, t0, start, t1, end, 0, points)

      if (points.length > MAX_SEGMENTS + 1) {
        points = sampleUniformly(evaluate, t0, t1, MAX_SEGMENTS)
      }
      break
    }

    default:
      return new Error('Unsupported curve type')
  }

  if (
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.z)
    )
  ) {
    return new Error('Curve produced a non-finite position')
  }

  // Orientation changes traversal, not the parameter interval.
  if (curve.type !== 'line' && edge.curve[1] === -1) {
    points.reverse()
  }

  return points
}

function circleSegmentCount(radius: number, sweep: number): number {
  radius = Math.abs(radius)
  sweep = Math.abs(sweep)

  if (radius <= Number.EPSILON || sweep <= Number.EPSILON) {
    return 2
  }

  // Sagitta: error = radius * (1 - cos(segmentAngle / 2)).
  const maxAngle =
    CHORD_ERROR >= radius
      ? Math.PI
      : 2 * Math.acos(
          Math.max(-1, Math.min(1, 1 - CHORD_ERROR / radius))
        )

  const minimum = sweep >= 2 * Math.PI * 0.99 ? 8 : 2

  return Math.min(
    MAX_SEGMENTS,
    Math.max(minimum, Math.ceil(sweep / Math.max(maxAngle, 1e-6)))
  )
}

function sampleUniformly(
  evaluate: Evaluate,
  t0: number,
  t1: number,
  count: number
): Vector3[] {
  return Array.from({ length: count + 1 }, (_, i) =>
    evaluate(lerp(t0, t1, i / count))
  )
}

function distanceToSegment(
  p: Vector3,
  a: Vector3,
  b: Vector3
): number {
  const ab = b.clone().sub(a)
  const lengthSquared = ab.lengthSq()

  if (lengthSquared === 0) {
    return p.distanceTo(a)
  }

  const t = Math.max(
    0,
    Math.min(1, p.clone().sub(a).dot(ab) / lengthSquared)
  )

  return p.distanceTo(a.clone().addScaledVector(ab, t))
}

function subdivide(
  evaluate: Evaluate,
  t0: number,
  a: Vector3,
  t1: number,
  b: Vector3,
  depth: number,
  points: Vector3[]
): void {
  const tm = lerp(t0, t1, 0.5)
  const middle = evaluate(tm)

  // Quarter points catch bends that a midpoint-only check can miss.
  const error = Math.max(
    distanceToSegment(evaluate(lerp(t0, t1, 0.25)), a, b),
    distanceToSegment(middle, a, b),
    distanceToSegment(evaluate(lerp(t0, t1, 0.75)), a, b)
  )

  if (error <= CHORD_ERROR || depth >= MAX_DEPTH) {
    points.push(b)
    return
  }

  subdivide(evaluate, t0, a, tm, middle, depth + 1, points)
  subdivide(evaluate, tm, middle, t1, b, depth + 1, points)
}