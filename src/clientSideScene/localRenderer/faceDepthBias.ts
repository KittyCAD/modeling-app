import { isArray } from '@src/lib/utils'
import { Box3, Material, Mesh, type Object3D, Vector3 } from 'three'

// glTF positions are in meters. Keep the distance tolerance independent of model
// size so a large assembly cannot make separate nearby surfaces coplanar.
const PLANE_DISTANCE_TOLERANCE = 1e-7
const PLANE_NORMAL_TOLERANCE = 1e-6

type PlanarFace = {
  mesh: Mesh
  area: number
  normal: Vector3
  distance: number
  bounds: Box3
}

// Smaller faces win depth ties so a face contained in another remains visible
// and selectable. Measure tessellated area, not triangle count or bounding-box
// area: tessellation density varies, and a circle can lie in any plane.
// Positive, constant offsets keep regions and edges ahead of solid faces and
// avoid large slope-dependent offsets at grazing angles.
export function applyFaceDepthBias(root: Object3D) {
  for (const _step of faceDepthBiasSteps(root)) {
    // Synchronous entry point for callers that do not need to yield.
  }
}

// Yield after the first frame, then keep triangle processing in short tasks so
// navigation and painting can continue while large models are being measured.
export async function applyFaceDepthBiasDeferred(
  root: Object3D,
  isCurrent: () => boolean,
  yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
): Promise<boolean> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await yieldToBrowser()
  if (!isCurrent()) return false
  const steps = faceDepthBiasSteps(root)
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

function* faceDepthBiasSteps(root: Object3D): Generator<void, boolean> {
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
    let planar = true
    const bounds = new Box3()
    for (let i = 0; i < positions.count; i++) {
      a.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)
      bounds.expandByPoint(a)
      if (
        !Number.isFinite(a.lengthSq()) ||
        Math.abs(normal.dot(a) - distance) > PLANE_DISTANCE_TOLERANCE
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
    coordinates.push(Math.floor(face.distance / PLANE_DISTANCE_TOLERANCE))
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
                  PLANE_DISTANCE_TOLERANCE
                )
              }
              return (
                delta.length() <= PLANE_NORMAL_TOLERANCE &&
                Math.abs(distanceDelta) <= PLANE_DISTANCE_TOLERANCE &&
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
        key.push(Math.floor((sign * face.distance) / PLANE_DISTANCE_TOLERANCE))
        const bucketKey = key.join(':')
        const bucket = buckets.get(bucketKey) ?? []
        bucket.push(group)
        buckets.set(bucketKey, bucket)
      }
    }
    yield
  }
  const ranks = new Map<Mesh, number>()
  for (const group of groups) {
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
        material.polygonOffsetFactor = 0
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
