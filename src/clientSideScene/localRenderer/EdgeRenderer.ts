import type { LocalRenderPacketEdge } from '@src/clientSideScene/localRenderer/renderPacketBinary'
import { Color, Group, Object3D } from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { Line2NodeMaterial } from 'three/webgpu'

const EDGE_LINE_WIDTH_PX = 2
const LIGHT_THEME_EDGE_COLOR = new Color(0x1c1c1c)
const DARK_THEME_EDGE_COLOR = new Color(0xf9f9f9)

export type EdgeSegmentRange = {
  firstSegment: number
  segmentCount: number
}

export type EdgeSelectionTarget = {
  edge: LocalRenderPacketEdge
  object: Object3D
}

export class EdgeRenderer {
  readonly lines: LineSegments2

  private readonly group = new Group()
  private readonly geometry = new LineSegmentsGeometry()
  private readonly material: Line2NodeMaterial
  private segmentToEdgeIndex = new Uint32Array()
  private edgeObjects: Object3D[] = []
  private edgeSegmentRanges = new Map<string, EdgeSegmentRange>()

  constructor(backgroundColor: string, visible = true) {
    this.material = new Line2NodeMaterial({
      color: getEdgeColorForBackground(backgroundColor),
      linewidth: EDGE_LINE_WIDTH_PX,
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
    this.lines.userData.kittycadEdgeBatch = true
    this.group.name = 'edge_batch'
    this.group.visible = visible
  }

  setEdges(edges: LocalRenderPacketEdge[]) {
    this.geometry.dispose()
    this.group.clear()

    const renderableEdges = edges.filter((edge) => edge.positions.length >= 6)
    const segmentCount = renderableEdges.reduce(
      (count, edge) => count + Math.floor(edge.positions.length / 3) - 1,
      0
    )
    const segmentPositions = new Float32Array(segmentCount * 6)
    this.segmentToEdgeIndex = new Uint32Array(segmentCount)
    this.edgeObjects = []
    this.edgeSegmentRanges.clear()
    const selectionTargets: EdgeSelectionTarget[] = []

    let segmentOffset = 0
    renderableEdges.forEach((edge, edgeOffset) => {
      const firstSegment = segmentOffset
      const pointCount = Math.floor(edge.positions.length / 3)
      for (let pointOffset = 0; pointOffset < pointCount - 1; pointOffset++) {
        const sourceOffset = pointOffset * 3
        segmentPositions.set(
          edge.positions.subarray(sourceOffset, sourceOffset + 6),
          segmentOffset * 6
        )
        this.segmentToEdgeIndex[segmentOffset] = edgeOffset
        segmentOffset += 1
      }

      this.edgeSegmentRanges.set(edge.edgeId, {
        firstSegment,
        segmentCount: segmentOffset - firstSegment,
      })

      const edgeObject = new Object3D()
      edgeObject.name = `edge_${edge.edgeIndex}`
      edgeObject.userData.kittycadEdgeExtras = {
        object_id: edge.objectId,
        body_id: edge.bodyId,
        edge_id: edge.edgeId,
        edge_index: edge.edgeIndex,
      }
      this.edgeObjects.push(edgeObject)
      selectionTargets.push({ edge, object: edgeObject })
      this.group.add(edgeObject)
    })

    if (segmentCount > 0) {
      this.geometry.setPositions(segmentPositions)
      this.group.add(this.lines)
    }
    return selectionTargets
  }

  addTo(parent: Object3D) {
    if (this.segmentToEdgeIndex.length > 0) {
      parent.add(this.group)
    }
  }

  removeFromParent() {
    this.group.removeFromParent()
  }

  isLineObject(object: Object3D) {
    return object === this.lines
  }

  getEdgeObjectForSegment(segmentIndex: number) {
    const edgeOffset = this.segmentToEdgeIndex[segmentIndex]
    return edgeOffset === undefined
      ? null
      : (this.edgeObjects[edgeOffset] ?? null)
  }

  getSegmentRange(edgeId: string) {
    return this.edgeSegmentRanges.get(edgeId) ?? null
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
    this.segmentToEdgeIndex = new Uint32Array()
    this.edgeObjects = []
    this.edgeSegmentRanges.clear()
  }
}

function getEdgeColorForBackground(backgroundColor: string) {
  const background = new Color(backgroundColor)
  const luminance =
    background.r * 0.2126 + background.g * 0.7152 + background.b * 0.0722
  return luminance > 0.5 ? LIGHT_THEME_EDGE_COLOR : DARK_THEME_EDGE_COLOR
}
