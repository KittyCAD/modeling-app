import { isArray } from '@src/lib/utils'
import { Material, Mesh, type Object3D, Vector3 } from 'three'

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
    if (step.done) return true
    if (performance.now() - sliceStart >= 4) {
      await yieldToBrowser()
      sliceStart = performance.now()
    }
  }
  steps.return()
  return false
}

function* faceDepthBiasSteps(root: Object3D): Generator<void, void> {
  root.updateWorldMatrix(true, true)
  const areas = new Map<Mesh, number>()
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
      area += b.sub(a).cross(c.sub(a)).length() / 2
      if (i % 6144 === 0) yield
    }
    if (Number.isFinite(area) && area > 0) areas.set(object, area)
  }
  // Mesh order only breaks equal-area ties; it must never hide a smaller face.
  const ordered = [...areas.keys()].sort(
    (a, b) =>
      (areas.get(a) ?? 0) - (areas.get(b) ?? 0) ||
      b.userData.bodyMeshIndex - a.userData.bodyMeshIndex
  )
  const ranks = new Map<Mesh, number>()
  let rank = 0
  let previous: Mesh | undefined
  for (const face of ordered) {
    if (
      previous &&
      (areas.get(previous) !== areas.get(face) ||
        previous.userData.bodyMeshIndex !== face.userData.bodyMeshIndex)
    )
      rank++
    ranks.set(face, rank)
    previous = face
  }
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
  // The replacement materials still reference the original textures.
  for (const source of copies.keys()) source.dispose()
}
