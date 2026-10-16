import type {
  KITTYCAD_GLTF,
  KITTYCAD_GLTF_BREP,
  KITTYCAD_GLTF_SKETCH_REGION,
} from '@src/clientSideScene/localRenderer/KITTYCAD_GLTF'
import { sampleEdge } from '@src/clientSideScene/localRenderer/sampleEdge'
import { isErr } from '@src/lib/trap'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'

// When chaining edges, the end of one edge and the start of the next are the
// same point, but they are computed separately, so they never match exactly.
// Without a tolerance every joint, and the loop's closing point, would appear
// twice, and duplicate points can give the triangulator degenerate triangles.
// Points closer than 1 nm (1e-9 m) count as one.
const POINT_TOLERANCE = 1e-9

type RegionPlane = { origin: Vector3; xAxis: Vector3; yAxis: Vector3 }

/**
 * Meshes covering the closed regions of the exported sketches. They are never
 * drawn. They are tagged like faces, so a region is hovered, clicked and
 * highlighted the same way a face is.
 */
export function createRegionMeshes(gltf: KITTYCAD_GLTF): Mesh[] {
  const brep = gltf.userData.gltfExtensions?.KITTYCAD_boundary_representation
  const regions = gltf.userData.KITTYCAD?.regions ?? []
  if (!brep || regions.length === 0) {
    return []
  }

  const material = new MeshBasicNodeMaterial({ side: DoubleSide })
  material.visible = false
  const meshes = regions.flatMap((region) => {
    const geometry = region.regionId && createRegionGeometry(region, brep)
    if (!geometry) {
      return []
    }
    const mesh = new Mesh(geometry, material)
    mesh.name = `region_${region.regionId}`
    mesh.userData.faceUuid = region.regionId
    return [mesh]
  })
  if (meshes.length === 0) {
    material.dispose()
  }
  return meshes
}

function createRegionGeometry(
  region: KITTYCAD_GLTF_SKETCH_REGION,
  brep: KITTYCAD_GLTF_BREP
) {
  const plane: RegionPlane = {
    origin: new Vector3(...region.planeOrigin),
    xAxis: new Vector3(...region.planeXAxis),
    yAxis: new Vector3(...region.planeYAxis),
  }

  const contour = toPlane(sampleLoop(brep, region.outerLoop), plane)
  if (contour.length < 3) {
    return null
  }
  const holes = (region.holeLoops ?? [])
    .map((loop) => toPlane(sampleLoop(brep, loop), plane))
    .filter((hole) => hole.length >= 3)
  // Triangulation expects the outline counter-clockwise and holes clockwise.
  if (ShapeUtils.isClockWise(contour)) {
    contour.reverse()
  }
  for (const hole of holes) {
    if (!ShapeUtils.isClockWise(hole)) {
      hole.reverse()
    }
  }
  const triangles = ShapeUtils.triangulateShape(contour, holes)
  if (triangles.length === 0) {
    return null
  }

  const positions = fromPlane([...contour, ...holes.flat()], plane)
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3)
  )
  geometry.setIndex(triangles.flat())
  geometry.computeVertexNormals()
  return geometry
}

// The points' coordinates within the region's plane.
function toPlane(points: Vector3[], { origin, xAxis, yAxis }: RegionPlane) {
  return points.map((point) => {
    const offset = point.clone().sub(origin)
    return new Vector2(offset.dot(xAxis), offset.dot(yAxis))
  })
}

// The flattened 3D positions of points within the region's plane.
function fromPlane(points: Vector2[], { origin, xAxis, yAxis }: RegionPlane) {
  return points.flatMap(({ x, y }) =>
    origin.clone().addScaledVector(xAxis, x).addScaledVector(yAxis, y).toArray()
  )
}

// The points around one boundary loop, without repeating the closing point.
function sampleLoop(brep: KITTYCAD_GLTF_BREP, loopIndex: number) {
  const parts: Vector3[][] = []
  for (const entry of brep.loops[loopIndex]?.edges ?? []) {
    const edge = entry && brep.edges[entry[0]]
    const curve = edge && brep.curves3D[edge.curve[0]]
    if (!edge || !curve) {
      continue
    }
    const points = sampleEdge(edge, curve, brep.vertices)
    if (!isErr(points) && points.length > 0) {
      parts.push(points)
    }
  }

  // The edges follow each other around the loop, but each may be sampled in
  // either direction, so turn each one to start where the previous one ends.
  const [first, second] = parts
  if (
    second &&
    distanceToEnds(first[0], second) < distanceToEnds(first.at(-1)!, second)
  ) {
    first.reverse()
  }
  const points: Vector3[] = []
  for (const part of parts) {
    const last = points.at(-1)
    if (last && last.distanceTo(part[0]) > last.distanceTo(part.at(-1)!)) {
      part.reverse()
    }
    points.push(
      ...(last && last.distanceTo(part[0]) < POINT_TOLERANCE
        ? part.slice(1)
        : part)
    )
  }
  if (
    points.length > 1 &&
    points[0].distanceTo(points.at(-1)!) < POINT_TOLERANCE
  ) {
    points.pop()
  }
  return points
}

// How close a point is to the nearer end of a sampled edge.
function distanceToEnds(point: Vector3, edgePoints: Vector3[]) {
  return Math.min(
    point.distanceTo(edgePoints[0]),
    point.distanceTo(edgePoints.at(-1)!)
  )
}
