import { isArray, isRecord } from '@src/lib/utils'
import { Box3, Material, Mesh, type Object3D, Plane, Vector3 } from 'three'

// glTF positions are in meters. Keep tolerances independent of model size.
const PLANAR_VERTEX_TOLERANCE = 1e-7
// Engine EXTRUSION_CUT_BIAS extends negative sketch-on-face extrusions by
// 0.001 mm. Treat that allowance as a rendering tie too, plus 1 nm for rounding.
// This remains fixed in meters; it must not grow with the model's size.
const COPLANAR_DISTANCE_TOLERANCE = 1.001e-6
const PLANE_NORMAL_TOLERANCE = 1e-6

type PlanarFace = {
  mesh: Mesh
  area: number
  normal: Vector3
  distance: number
  bounds: Box3
}

// Export versions use either normal/point or axes/origin for analytic planes.
// These values retain the engine's precision instead of the mesh's Float32 one.
export function exportedFacePlane(surface: unknown): Plane | undefined {
  if (
    !isRecord(surface) ||
    surface.type !== 'plane' ||
    !isRecord(surface.plane)
  )
    return
  const vector = (value: unknown) => {
    if (!isArray(value) || value.length !== 3) return
    const [x, y, z] = value
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof z !== 'number' ||
      ![x, y, z].every(Number.isFinite)
    )
      return
    return new Vector3(x, y, z)
  }
  const plane = surface.plane
  const axes = isRecord(plane.axes) ? plane.axes : undefined
  const x = vector(plane.xAxis ?? axes?.x)
  const y = vector(plane.yAxis ?? axes?.y)
  const normal = vector(plane.normal) ?? (x && y ? x.cross(y) : undefined)
  const point = vector(plane.point ?? plane.origin)
  if (!normal || !point || normal.lengthSq() === 0) return
  return new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), point)
}

// Smaller faces win depth ties so a face contained in another remains visible
// and selectable. Measure tessellated area, not triangle count or bounding-box
// area: tessellation density varies, and a circle can lie in any plane.
// Positive offsets keep regions and edges ahead of solid faces. The slope
// term stays small to limit displacement at grazing angles.
export function applyFaceDepthBias(
  root: Object3D,
  planes?: ReadonlyMap<Mesh, Plane>
) {
  for (const _step of faceDepthBiasSteps(root, planes)) {
    // Synchronous entry point for callers that do not need to yield.
  }
}

// Yield after the first frame, then keep triangle processing in short tasks so
// navigation and painting can continue while large models are being measured.
export async function applyFaceDepthBiasDeferred(
  root: Object3D,
  isCurrent: () => boolean,
  yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  planes?: ReadonlyMap<Mesh, Plane>
): Promise<boolean> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await yieldToBrowser()
  if (!isCurrent()) return false
  const steps = faceDepthBiasSteps(root, planes)
  let sliceStart = performance.now()
  while (isCurrent()) {
    const step = steps.next()
    if (step.done) return step.value
    if (performance.now() - sliceStart >= 4) {
      await yieldToBrowser()
      sliceStart = performance.now()
    }
  }
  steps.return(false)
  return false
}

function* faceDepthBiasSteps(
  root: Object3D,
  planes?: ReadonlyMap<Mesh, Plane>
): Generator<void, boolean> {
  root.updateWorldMatrix(true, true)
  const planarFaces: PlanarFace[] = []
  const triangleNormal = new Vector3()
  const edge = new Vector3()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const faces: Mesh[] = []
  root.traverse((object) => {
    if (
      object instanceof Mesh &&
      typeof object.userData.bodyMeshIndex === 'number'
    )
      faces.push(object)
  })
  for (const object of faces) {
    const positions = object.geometry.getAttribute('position')
    if (!positions) continue
    const indices = object.geometry.index
    const count = indices?.count ?? positions.count
    let area = 0
    let largestTriangle = 0
    let normal: Vector3 | undefined
    let distance = 0
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(
        positions,
        indices ? indices.getX(i) : i
      ).applyMatrix4(object.matrixWorld)
      b.fromBufferAttribute(
        positions,
        indices ? indices.getX(i + 1) : i + 1
      ).applyMatrix4(object.matrixWorld)
      c.fromBufferAttribute(
        positions,
        indices ? indices.getX(i + 2) : i + 2
      ).applyMatrix4(object.matrixWorld)
      triangleNormal.subVectors(b, a).cross(edge.subVectors(c, a))
      const doubleArea = triangleNormal.length()
      area += doubleArea / 2
      if (doubleArea > largestTriangle) {
        largestTriangle = doubleArea
        normal = triangleNormal.clone().divideScalar(doubleArea)
        distance = normal.dot(a)
      }
      if (i % 6144 === 0) yield
    }
    if (!normal || !Number.isFinite(area) || area <= 0) continue
    // Use the largest triangle for a stable candidate plane, then check every
    // vertex, including vertices in degenerate triangles before that triangle.
    const analyticPlane = planes?.get(object)
    if (analyticPlane) {
      normal = analyticPlane.normal
      distance = -analyticPlane.constant
    }
    let planar = true
    const bounds = new Box3()
    for (let i = 0; i < positions.count; i++) {
      a.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)
      bounds.expandByPoint(a)
      if (
        !Number.isFinite(a.lengthSq()) ||
        (!analyticPlane &&
          Math.abs(normal.dot(a) - distance) > PLANAR_VERTEX_TOLERANCE)
      ) {
        planar = false
        break
      }
      if (i % 2048 === 0) yield
    }
    if (planar)
      planarFaces.push({ mesh: object, area, normal, distance, bounds })
  }
  // Neighboring buckets avoid missing planes on a quantization boundary.
  // Index both orientations so opposite windings describe the same plane.
  const buckets = new Map<string, PlanarFace[][]>()
  const groups: PlanarFace[][] = []
  for (const face of planarFaces) {
    const coordinates = [face.normal.x, face.normal.y, face.normal.z].map(
      (value) => Math.floor(value / PLANE_NORMAL_TOLERANCE)
    )
    coordinates.push(Math.floor(face.distance / COPLANAR_DISTANCE_TOLERANCE))
    let match: PlanarFace[] | undefined
    for (let x = -1; x <= 1 && !match; x++)
      for (let y = -1; y <= 1 && !match; y++)
        for (let z = -1; z <= 1 && !match; z++)
          for (let d = -1; d <= 1 && !match; d++) {
            const key = [
              coordinates[0] + x,
              coordinates[1] + y,
              coordinates[2] + z,
              coordinates[3] + d,
            ].join(':')
            match = buckets.get(key)?.find(([first]) => {
              const sign = first.normal.dot(face.normal) < 0 ? -1 : 1
              const delta = first.normal
                .clone()
                .addScaledVector(face.normal, -sign)
              const distanceDelta = first.distance - sign * face.distance
              // Similar normals alone are insufficient for very large faces:
              // bound the plane-equation difference over both meshes as well.
              const agreesOver = (bounds: Box3) => {
                const center = bounds.getCenter(new Vector3())
                const halfSize = bounds
                  .getSize(new Vector3())
                  .multiplyScalar(0.5)
                return (
                  Math.abs(delta.dot(center) - distanceDelta) +
                    Math.abs(delta.x) * halfSize.x +
                    Math.abs(delta.y) * halfSize.y +
                    Math.abs(delta.z) * halfSize.z <=
                  COPLANAR_DISTANCE_TOLERANCE
                )
              }
              return (
                delta.length() <= PLANE_NORMAL_TOLERANCE &&
                Math.abs(distanceDelta) <= COPLANAR_DISTANCE_TOLERANCE &&
                agreesOver(first.bounds) &&
                agreesOver(face.bounds)
              )
            })
          }
    if (match) {
      match.push(face)
    } else {
      const group = [face]
      groups.push(group)
      for (const sign of [1, -1]) {
        const key = [face.normal.x, face.normal.y, face.normal.z].map((value) =>
          Math.floor((sign * value) / PLANE_NORMAL_TOLERANCE)
        )
        key.push(
          Math.floor((sign * face.distance) / COPLANAR_DISTANCE_TOLERANCE)
        )
        const bucketKey = key.join(':')
        const bucket = buckets.get(bucketKey) ?? []
        bucket.push(group)
        buckets.set(bucketKey, bucket)
      }
    }
    yield
  }
  // Coplanar but distant faces cannot compete for pixels. Split each plane
  // into components of overlapping bounds before assigning any depth ranks.
  const overlappingGroups: PlanarFace[][] = []
  for (const group of groups) {
    const bounds = new Box3()
    for (const face of group) bounds.union(face.bounds)
    const size = bounds.getSize(new Vector3())
    const normal = group[0].normal
    const projectionAxes: Array<'x' | 'y' | 'z'> =
      Math.abs(normal.x) >= Math.abs(normal.y) &&
      Math.abs(normal.x) >= Math.abs(normal.z)
        ? ['y', 'z']
        : Math.abs(normal.y) >= Math.abs(normal.z)
          ? ['x', 'z']
          : ['x', 'y']
    const axis =
      size[projectionAxes[0]] >= size[projectionAxes[1]]
        ? projectionAxes[0]
        : projectionAxes[1]
    const sorted = [...group].sort(
      (a, b) => a.bounds.min[axis] - b.bounds.min[axis]
    )
    const parent = sorted.map((_, index) => index)
    const find = (index: number): number => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]]
        index = parent[index]
      }
      return index
    }
    const active: number[] = []
    for (let i = 0; i < sorted.length; i++) {
      const currentBounds = sorted[i].bounds
      for (let j = active.length - 1; j >= 0; j--) {
        const previous = active[j]
        if (sorted[previous].bounds.max[axis] < currentBounds.min[axis]) {
          active.splice(j, 1)
        } else if (
          // Plane distance was checked above using analytic data when present.
          // Test overlap in the plane only: Float32 mesh rounding along its
          // normal must not reject the engine's extrusion allowance again.
          projectionAxes.every(
            (axis) =>
              Math.min(
                sorted[i].bounds.max[axis],
                sorted[previous].bounds.max[axis]
              ) -
                Math.max(
                  sorted[i].bounds.min[axis],
                  sorted[previous].bounds.min[axis]
                ) >
              PLANAR_VERTEX_TOLERANCE
          )
        ) {
          parent[find(i)] = find(previous)
        }
        yield
      }
      active.push(i)
      yield
    }
    const components = new Map<number, PlanarFace[]>()
    for (let i = 0; i < sorted.length; i++) {
      const root = find(i)
      const component = components.get(root) ?? []
      component.push(sorted[i])
      components.set(root, component)
    }
    overlappingGroups.push(...components.values())
  }
  const ranks = new Map<Mesh, number>()
  for (const group of overlappingGroups) {
    group.sort(
      (a, b) =>
        a.area - b.area ||
        b.mesh.userData.bodyMeshIndex - a.mesh.userData.bodyMeshIndex
    )
    let rank = 0
    let previous: PlanarFace | undefined
    for (const face of group) {
      if (
        previous &&
        (previous.area !== face.area ||
          previous.mesh.userData.bodyMeshIndex !==
            face.mesh.userData.bodyMeshIndex)
      )
        rank++
      // Leave singleton groups and their winning face's materials unchanged.
      if (rank > 0) ranks.set(face.mesh, rank)
      previous = face
    }
  }
  if (ranks.size === 0) return false
  const copies = new Map<Material, Map<number, Material>>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const rank = ranks.get(object)
    if (rank === undefined) return
    const biased = (source: Material) => {
      let byRank = copies.get(source)
      if (!byRank) {
        byRank = new Map()
        copies.set(source, byRank)
      }
      let material = byRank.get(rank)
      if (!material) {
        material = source.clone()
        material.polygonOffset = true
        // A small slope term covers rasterization differences between coplanar
        // triangles in angled orthographic views; constant units alone do not.
        material.polygonOffsetFactor = rank / 256
        // Leave room for interpolation differences between a large triangle
        // and the finer tessellation of a contained face.
        material.polygonOffsetUnits = rank * 16
        byRank.set(rank, material)
      }
      return material
    }
    object.material = isArray(object.material)
      ? object.material
          .filter(
            (material): material is Material => material instanceof Material
          )
          .map(biased)
      : biased(object.material)
  })
  // Untouched faces may still share the original materials. Dispose only those
  // no longer used; replacement materials keep sharing the original textures.
  const retained = new Set<Material>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    for (const material of isArray(object.material)
      ? object.material
      : [object.material]) {
      if (material instanceof Material) retained.add(material)
    }
  })
  for (const source of copies.keys())
    if (!retained.has(source)) source.dispose()
  return true
}
