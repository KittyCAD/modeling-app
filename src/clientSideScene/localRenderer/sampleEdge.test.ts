import { expect, it } from 'vitest'
import { sampleEdge } from '@src/clientSideScene/localRenderer/sampleEdge'
import fixture from '@src/clientSideScene/localRenderer/helix-four-turn.fixture.json'
import type {
  KITTYCAD_GLTF_CURVE3D,
  KITTYCAD_GLTF_EDGE,
} from '@src/clientSideScene/localRenderer/KITTYCAD_GLTF'

it.each([
  [0, 16],
  [4, 8],
  [8, 4],
])('preserves an exported helix over domain [%s, %s]', (t0, t1) => {
  const points = sampleEdge(
    { ...fixture.edge, t: [t0, t1] } as KITTYCAD_GLTF_EDGE,
    fixture.curve as KITTYCAD_GLTF_CURVE3D,
    fixture.vertices as [number, number, number][]
  )
  if (points instanceof Error) throw points
  // This helix runs along X: its 5 mm radius must survive sampling in Y/Z.
  const ys = points.map((p) => p.y)
  const zs = points.map((p) => p.z)
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.01, 5)
  expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.01, 5)
  for (const [point, t] of [
    [points[0], t0],
    [points[points.length - 1], t1],
  ] as const) {
    expect(point.x).toBeCloseTo(0.02 + (0.01 * t) / 16, 8)
    expect(point.y).toBeCloseTo(0.035, 8)
    expect(point.z).toBeCloseTo(-0.03, 8)
  }
})

it('keeps the chord tolerance on a 128-turn helix', () => {
  const repeats = 32
  const original = fixture.curve.nurbs.controlPoints
  const controls = Array.from({ length: repeats }, (_, repeat) =>
    original.slice(0, -1).map(([x, y, z]) => [x + repeat * 0.01, y, z])
  ).flat()
  const [x, y, z] = original[original.length - 1]
  controls.push([x + (repeats - 1) * 0.01, y, z])
  const spans = 16 * repeats
  const knots = [
    0,
    ...Array.from({ length: spans + 1 }, (_, i) => [i, i, i]).flat(),
    spans,
  ]
  const curve = {
    ...fixture.curve,
    nurbs: {
      ...fixture.curve.nurbs,
      controlPoints: controls,
      knotVector: knots,
    },
  }
  const points = sampleEdge(
    { ...fixture.edge, t: [0, spans] } as KITTYCAD_GLTF_EDGE,
    curve as KITTYCAD_GLTF_CURVE3D,
    [fixture.vertices[0], controls[controls.length - 1]] as [
      number,
      number,
      number,
    ][]
  )
  if (points instanceof Error) throw points
  expect(points.length).toBeGreaterThan(513)
  for (let i = 1; i < points.length; i++) {
    const middle = points[i - 1].clone().add(points[i]).multiplyScalar(0.5)
    const radius = Math.hypot(middle.y - 0.04, middle.z + 0.03)
    expect(0.005 - radius).toBeLessThanOrEqual(0.002 / 1000)
  }
})
