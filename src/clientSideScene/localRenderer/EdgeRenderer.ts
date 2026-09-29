import { LOCAL_WEBGPU_EDGE_LINE_WIDTH_PX } from '@src/clientSideScene/localRenderer/config'
import { Color, Group, Object3D } from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { Line2NodeMaterial } from 'three/webgpu'
import { KITTYCAD_GLTF } from './KITTYCAD_GLTF'

const LIGHT_THEME_EDGE_COLOR = new Color(0x1c1c1c)
const DARK_THEME_EDGE_COLOR = new Color(0xf9f9f9)

export class EdgeRenderer {
  readonly lines: LineSegments2

  private readonly group = new Group()
  private readonly geometry = new LineSegmentsGeometry()
  private readonly material: Line2NodeMaterial

  constructor(backgroundColor: string, visible = true) {
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
  }

  // TODO defer building if edges are not visible
  public buildEdges(gltf: KITTYCAD_GLTF) {
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
    for (const edge of brep.edges) {
      const curve = brep.curves3D[edge.curve[0]]
      if (curve) {
        if (curve.type === 'line') {
          if (edge.closed) {
            const { origin, direction } = curve.line
            for (const t of edge.t) {
              positions.push(
                origin[0] + direction[0] * t,
                origin[1] + direction[1] * t,
                origin[2] + direction[2] * t
              )
            }
          } else {
            const start = brep.vertices[edge.start]
            const end = brep.vertices[edge.end]
            positions.push(...start, ...end)
          }
        }
      }
    }
    this.geometry.setPositions(positions)
    //console.log('gltf', gltf, positions)
  }

  addTo(parent: Object3D) {
    this.group.add(this.lines)
    parent.add(this.group)
  }

  removeFromParent() {
    this.group.removeFromParent()
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
  }
}

function getEdgeColorForBackground(backgroundColor: string) {
  const background = new Color(backgroundColor)
  const luminance =
    background.r * 0.2126 + background.g * 0.7152 + background.b * 0.0722
  return luminance < 0.5 ? LIGHT_THEME_EDGE_COLOR : DARK_THEME_EDGE_COLOR
}
