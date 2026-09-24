import { LOCAL_WEBGPU_EDGE_LINE_WIDTH_PX } from '@src/clientSideScene/localRenderer/config'
import { Color, Group, Object3D } from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { Line2NodeMaterial } from 'three/webgpu'
import { KITTYCAD_GLTF } from './LocalRenderer'

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

  public buildEdges(gltf: KITTYCAD_GLTF) {
    console.log('gltf', gltf)
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
  return luminance > 0.5 ? LIGHT_THEME_EDGE_COLOR : DARK_THEME_EDGE_COLOR
}
