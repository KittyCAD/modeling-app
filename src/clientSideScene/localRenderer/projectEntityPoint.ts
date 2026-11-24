import { type BufferGeometry, type Camera, Vector3 } from 'three'

/** Points stay on the rendered geometry, including curved edges and concave faces. */
export function getEntityPoint(
  geometry: BufferGeometry,
  kind: 'edge' | 'face'
) {
  return getEntityPoints(geometry, kind).next().value
}

export function* getEntityPoints(
  geometry: BufferGeometry,
  kind: 'edge' | 'face'
): Generator<Vector3, undefined> {
  if (kind === 'edge') {
    const starts = geometry.getAttribute('instanceStart')
    const ends = geometry.getAttribute('instanceEnd')
    if (!starts || !ends || starts.count === 0) return undefined
    const segments = Array.from({ length: starts.count }, (_, i) => {
      const a = new Vector3().fromBufferAttribute(starts, i)
      const b = new Vector3().fromBufferAttribute(ends, i)
      return { a, b, length: a.distanceTo(b) }
    })
    let remaining = segments.reduce((sum, s) => sum + s.length, 0) / 2
    for (const { a, b, length } of segments) {
      if (remaining <= length) {
        yield a.lerp(b, length ? remaining / length : 0)
        return
      }
      remaining -= length
    }
    return undefined
  }
  const positions = geometry.getAttribute('position')
  if (!positions) return undefined
  const index = geometry.index
  const count = index?.count ?? positions.count
  const triangles: Array<{ center: Vector3; area: number }> = []
  const centroid = new Vector3()
  let totalArea = 0
  for (let i = 0; i + 2 < count; i += 3) {
    const vertex = (offset: number) =>
      new Vector3().fromBufferAttribute(
        positions,
        index ? index.getX(i + offset) : i + offset
      )
    const a = vertex(0),
      b = vertex(1),
      c = vertex(2)
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2
    if (area === 0) continue
    const center = a.add(b).add(c).divideScalar(3)
    triangles.push({ center, area })
    centroid.addScaledVector(center, area)
    totalArea += area
  }
  if (!totalArea) return undefined
  centroid.divideScalar(totalArea)
  // A face centroid can lie in a hole or off a curved surface. Use a nearby triangle.
  triangles.sort(
    (a, b) =>
      a.center.distanceToSquared(centroid) -
      b.center.distanceToSquared(centroid)
  )
  const first = triangles[0]
  yield first.center
  // Only try additional interiors if the representative point didn't pick the face.
  triangles.sort((a, b) => b.area - a.area)
  for (const triangle of triangles.slice(0, 8)) {
    if (triangle !== first) yield triangle.center
  }
}

export function projectEntityPoint(
  world: Vector3,
  camera: Camera,
  rect: { left: number; top: number; width: number; height: number }
) {
  if (rect.width <= 0 || rect.height <= 0) return undefined
  const view = world.clone().applyMatrix4(camera.matrixWorldInverse)
  if (view.z >= 0) return undefined
  const ndc = world.clone().project(camera)
  if (
    ![ndc.x, ndc.y, ndc.z].every(Number.isFinite) ||
    Math.abs(ndc.x) > 1 ||
    Math.abs(ndc.y) > 1 ||
    Math.abs(ndc.z) > 1
  )
    return undefined
  return {
    x: rect.left + ((ndc.x + 1) * rect.width) / 2,
    y: rect.top + ((1 - ndc.y) * rect.height) / 2,
  }
}

/** Mouse helpers click integer CSS pixels; try the closest one first. */
export function nearbyViewportPixels(
  point: { x: number; y: number },
  rect: DOMRect
) {
  const xs = [...new Set([Math.floor(point.x), Math.ceil(point.x)])]
  const ys = [...new Set([Math.floor(point.y), Math.ceil(point.y)])]
  const distance = ({ x, y }: typeof point) =>
    (x - point.x) ** 2 + (y - point.y) ** 2
  return xs
    .flatMap((x) => ys.map((y) => ({ x, y })))
    .filter(
      ({ x, y }) =>
        x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
    )
    .sort((a, b) => distance(a) - distance(b))
}
