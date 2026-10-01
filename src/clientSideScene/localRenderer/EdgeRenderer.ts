import { LOCAL_WEBGPU_EDGE_LINE_WIDTH_PX } from '@src/clientSideScene/localRenderer/config'
import { Color, Group, Object3D } from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { Line2NodeMaterial } from 'three/webgpu'
import { KITTYCAD_GLTF } from './KITTYCAD_GLTF'
import { sampleEdge } from './sampleEdge'
import { isErr } from '@src/lib/trap'

const LIGHT_THEME_EDGE_COLOR = new Color(0x1c1c1c)
const DARK_THEME_EDGE_COLOR = new Color(0xf9f9f9)

export type EdgeSelectionTarget = {
  object: LineSegments2
  ranges: Array<{ firstSegment: number; segmentCount: number }>
}

export class EdgeRenderer {
  readonly lines: LineSegments2

  private readonly group = new Group()
  private readonly geometry = new LineSegmentsGeometry()
  private readonly material: Line2NodeMaterial
  private readonly selectionMaterial = new Line2NodeMaterial()
  private selectionTargets: EdgeSelectionTarget[] = []

  constructor(backgroundColor: string, visible = true) {
    this.geometry.setPositions([])
    this.material = new Line2NodeMaterial({
      color: getEdgeColorForBackground(backgroundColor),
      linewidth: LOCAL_WEBGPU_EDGE_LINE_WIDTH_PX,
    })
    this.material.worldUnits = false
    this.material.transparent = false
    this.material.opacity = 1
    this.material.polygonOffset = true
    this.material.polygonOffsetFactor = -1
    this.material.polygonOffsetUnits = -1

    this.lines = new LineSegments2(this.geometry, this.material)
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
  public buildEdges(gltf: KITTYCAD_GLTF) {
    console.log('>>>', gltf)
    const brep = gltf.userData.gltfExtensions.KITTYCAD_boundary_representation
    // for (const solid of brep.solids) {
    //   for (const [shellIndex, _] of solid.shells) {
    //     const shell = brep.shells[shellIndex]
    //     for (const [faceIndex, _] of shell.faces) {
    //       const face = brep.faces[faceIndex]
    //       for (const [loopIndex, _] of face.loops) {
    //         const loop = brep.loops[loopIndex]
    //         for (const [edgeIndex, _] of loop.edges) {
    //           const edge = brep.edges[edgeIndex]
    //         }
    //       }
    //     }
    //   }
    // }
    const positions: number[] = []
    const positionsByUuid = new Map<string, number[]>()
    const rangesByUuid = new Map<string, EdgeSelectionTarget['ranges']>()
    this.clearSelectionTargets()
    for (const edge of brep.edges) {
      const curve = brep.curves3D[edge.curve[0]]
      if (curve) {
        const points = sampleEdge(edge, curve, brep.vertices)
        if (isErr(points)) {
          //console.error(`Edge ${index}: ${points.message}`)
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
        const uuid = edge.extras?.KITTYCAD?.uuid
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
        console.error(`Missing edge ${edge.curve[0]}`)
      }
    }
    this.geometry.setPositions(positions)
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
  }

  addTo(parent: Object3D) {
    this.group.add(this.lines)
    parent.add(this.group)
  }

  removeFromParent() {
    this.group.removeFromParent()
    this.clearSelectionTargets()
  }

  private clearSelectionTargets() {
    for (const target of this.selectionTargets) {
      target.object.removeFromParent()
      target.object.geometry.dispose()
    }
    this.selectionTargets = []
  }

  setBackgroundColor(backgroundColor: string) {
    this.material.color.copy(getEdgeColorForBackground(backgroundColor))
  }

  setVisible(visible: boolean) {
    this.group.visible = visible
  }

  dispose() {
    this.removeFromParent()
    this.group.clear()
    this.geometry.dispose()
    this.material.dispose()
    this.selectionMaterial.dispose()
  }
}

function getEdgeColorForBackground(backgroundColor: string) {
  const background = new Color(backgroundColor)
  const luminance =
    background.r * 0.2126 + background.g * 0.7152 + background.b * 0.0722
  return luminance < 0.5 ? LIGHT_THEME_EDGE_COLOR : DARK_THEME_EDGE_COLOR
}
