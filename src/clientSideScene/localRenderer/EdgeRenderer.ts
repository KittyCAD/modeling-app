import { LOCAL_WEBGPU_EDGE_LINE_WIDTH_PX } from '@src/clientSideScene/localRenderer/config'
import { Color, Group, InstancedBufferAttribute, type Object3D } from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { Line2NodeMaterial } from 'three/webgpu'
import type {
  KITTYCAD_GLTF,
  KITTYCAD_GLTF_BREP,
} from '@src/clientSideScene/localRenderer/KITTYCAD_GLTF'
import { sampleEdge } from '@src/clientSideScene/localRenderer/sampleEdge'
import { type ResolvedTheme, Themes } from '@src/lib/theme'
import { isErr } from '@src/lib/trap'

// The engine draws edges in this colour in both themes: see edgeColor in theme.ts.
const EDGE_COLOR = new Color(0x1c1c1c)

// Sketch lines contrast with the background.
export function getSketchLineColor(theme: ResolvedTheme) {
  return new Color(theme === Themes.Light ? 0x1c1c1c : 0xf2f3f5)
}

export type EdgeSelectionTarget = {
  object: LineSegments2
  ranges: Array<{ firstSegment: number; segmentCount: number }>
}

// Per segment: 1 + the index of its target in getSelectionTargets(), or 0 if it
// has none. IntegerIdPicker draws EdgeRenderer.lines with it.
export const SELECTION_INDEX_ATTRIBUTE = 'selectionIndex'

// A B-rep edge to draw, and the ID it is picked and highlighted by.
export type DrawnEdge = { index: number; uuid?: string }

// Sketch segments and region boundaries are B-rep edges too, but they are not
// edges of a body.
function getSketchEdgeIndices(
  gltf: KITTYCAD_GLTF,
  brep: KITTYCAD_GLTF_BREP
): Set<number> {
  const { sketches = [], regions = [] } = gltf.userData.KITTYCAD ?? {}
  const indices = new Set(sketches.map(({ edge }) => edge))
  for (const region of regions) {
    for (const loop of [region.outerLoop, ...(region.holeLoops ?? [])]) {
      for (const entry of brep.loops[loop]?.edges ?? []) {
        if (entry) {
          indices.add(entry[0])
        }
      }
    }
  }
  return indices
}

export function getBodyEdges(gltf: KITTYCAD_GLTF): DrawnEdge[] {
  const brep = gltf.userData.gltfExtensions?.KITTYCAD_boundary_representation
  if (!brep) {
    return []
  }
  const sketchEdges = getSketchEdgeIndices(gltf, brep)
  return brep.edges.flatMap((edge, index) =>
    sketchEdges.has(index) ? [] : [{ index, uuid: edge.extras?.KITTYCAD?.uuid }]
  )
}

export function getSketchSegmentEdges(gltf: KITTYCAD_GLTF): DrawnEdge[] {
  return (gltf.userData.KITTYCAD?.sketches ?? []).map(
    ({ edge, segmentId }) => ({ index: edge, uuid: segmentId })
  )
}

export class EdgeRenderer {
  readonly lines: LineSegments2

  private readonly group = new Group()
  private readonly material: Line2NodeMaterial
  private readonly selectionMaterial = new Line2NodeMaterial()
  private selectionTargets: EdgeSelectionTarget[] = []

  constructor(
    visible = true,
    color = EDGE_COLOR,
    linewidth = LOCAL_WEBGPU_EDGE_LINE_WIDTH_PX
  ) {
    this.material = new Line2NodeMaterial({ color, linewidth })
    this.material.worldUnits = false
    this.material.transparent = false
    this.material.opacity = 1
    this.material.polygonOffset = true
    this.material.polygonOffsetFactor = -1
    this.material.polygonOffsetUnits = -1

    this.lines = new LineSegments2(this.createGeometry([]), this.material)
    this.lines.name = 'edges'
    this.lines.renderOrder = 2
    this.group.name = 'edge_batch'
    this.group.visible = visible
    this.selectionMaterial.visible = false
  }

  getSelectionTargets() {
    return this.selectionTargets
  }

  // TODO defer building if edges are not visible
  public buildEdges(gltf: KITTYCAD_GLTF, edges: DrawnEdge[]) {
    const brep = gltf.userData.gltfExtensions?.KITTYCAD_boundary_representation
    if (!brep) {
      // assignFaceUuids has already warned. Leave no edges from an earlier model.
      this.clearSelectionTargets()
      this.setSegments([])
      return
    }
    const positions: number[] = []
    const positionsByUuid = new Map<string, number[]>()
    const rangesByUuid = new Map<string, EdgeSelectionTarget['ranges']>()
    this.clearSelectionTargets()
    for (const { index, uuid } of edges) {
      const edge = brep.edges[index]
      const curve = edge && brep.curves3D[edge.curve[0]]
      if (curve) {
        const points = sampleEdge(edge, curve, brep.vertices)
        if (isErr(points)) {
          console.error(`Edge ${index}: ${points.message}`)
          continue
        }
        // Convert a polyline into independent segment pairs.
        const firstSegment = positions.length / 6
        const edgePositions: number[] = []
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1]
          const b = points[i]
          edgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z)
        }
        positions.push(...edgePositions)
        if (uuid && edgePositions.length > 0) {
          const uuidPositions = positionsByUuid.get(uuid) ?? []
          uuidPositions.push(...edgePositions)
          positionsByUuid.set(uuid, uuidPositions)
          const ranges = rangesByUuid.get(uuid) ?? []
          ranges.push({
            firstSegment,
            segmentCount: edgePositions.length / 6,
          })
          rangesByUuid.set(uuid, ranges)
        }
      } else {
        console.error(`Missing curve for edge ${index}`)
      }
    }
    for (const [uuid, edgePositions] of positionsByUuid) {
      const geometry = new LineSegmentsGeometry()
      geometry.setPositions(edgePositions)
      const object = new LineSegments2(geometry, this.selectionMaterial)
      object.userData.edgeUuid = uuid
      object.frustumCulled = false
      this.group.add(object)
      this.selectionTargets.push({
        object,
        ranges: rangesByUuid.get(uuid) ?? [],
      })
    }
    this.setSegments(positions)
  }

  // A new geometry on every rebuild, so the old one can be disposed and its GPU
  // buffers freed now. Replacing attributes with setPositions would leave the old
  // buffers until garbage collection: three only disposes a geometry's current
  // attributes.
  private setSegments(positions: number[]) {
    const geometry = this.createGeometry(positions)
    this.lines.geometry.dispose()
    this.lines.geometry = geometry
  }

  // Call after selectionTargets is up to date.
  private createGeometry(positions: number[]) {
    const selectionIndices = new Uint32Array(positions.length / 6)
    this.selectionTargets.forEach(({ ranges }, index) => {
      for (const { firstSegment, segmentCount } of ranges) {
        selectionIndices.fill(
          index + 1,
          firstSegment,
          firstSegment + segmentCount
        )
      }
    })
    const geometry = new LineSegmentsGeometry().setPositions(positions)
    geometry.setAttribute(
      SELECTION_INDEX_ATTRIBUTE,
      new InstancedBufferAttribute(selectionIndices, 1)
    )
    return geometry
  }

  addTo(parent: Object3D) {
    this.group.add(this.lines)
    parent.add(this.group)
  }

  removeFromParent() {
    this.group.removeFromParent()
    // The picker draws lines from this geometry, so leave no edges behind.
    this.clearSelectionTargets()
    this.setSegments([])
  }

  private clearSelectionTargets() {
    for (const target of this.selectionTargets) {
      target.object.removeFromParent()
      target.object.geometry.dispose()
    }
    this.selectionTargets = []
  }

  setVisible(visible: boolean) {
    this.group.visible = visible
  }

  setColor(color: Color) {
    this.material.color.copy(color)
  }

  dispose() {
    this.removeFromParent()
    this.group.clear()
    this.lines.geometry.dispose()
    this.material.dispose()
    this.selectionMaterial.dispose()
  }
}
