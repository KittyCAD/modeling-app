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
  expect(points.length).toBeLessThanOrEqual(513)
  for (const [point, t] of [
    [points[0], t0],
    [points[points.length - 1], t1],
  ] as const) {
    expect(point.x).toBeCloseTo(0.02 + (0.01 * t) / 16, 8)
    expect(point.y).toBeCloseTo(0.035, 8)
    expect(point.z).toBeCloseTo(-0.03, 8)
  }
})
