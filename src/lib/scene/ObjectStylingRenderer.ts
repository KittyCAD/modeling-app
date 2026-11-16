import {
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  SRGBColorSpace,
  type Object3D,
  type Scene,
} from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { EntityStyle } from '@src/lib/scene/entityStyling'

export interface ObjectStyleGroup {
  readonly id: symbol
  readonly style: EntityStyle
  readonly targets: readonly Mesh[]
}
interface Overlay {
  source: Mesh
  mesh: Mesh
  material: LineMaterial | MeshBasicMaterial
  style: EntityStyle
}

/** WebGL presentation of opaque styling groups. Geometry is borrowed; only overlay objects/materials are owned. */
export class ObjectStylingRenderer {
  private readonly root = new Group()
  private readonly overlays = new Map<string, Overlay>()
  private readonly inverse = new Matrix4()
  constructor(scene: Scene) {
    this.root.name = 'entity-styling'
    scene.add(this.root)
  }
  setGroups(groups: readonly ObjectStyleGroup[]) {
    const winners = new Map<string, { source: Mesh; style: EntityStyle }>()
    for (const group of [...groups].sort(
      (a, b) => a.style.priority - b.style.priority
    ))
      for (const source of group.targets)
        winners.set(source.uuid, { source, style: group.style })
    for (const [key, overlay] of this.overlays)
      if (!winners.has(key)) {
        overlay.mesh.removeFromParent()
        overlay.material.dispose()
        this.overlays.delete(key)
      }
    for (const [key, { source, style }] of winners) {
      let overlay = this.overlays.get(key)
      if (!overlay) {
        const material = isWideLine(source)
          ? source.material.clone()
          : new MeshBasicMaterial()
        const mesh = isWideLine(source)
          ? new LineSegments2(source.geometry, material as LineMaterial)
          : new Mesh(source.geometry, material)
        mesh.matrixAutoUpdate = false
        mesh.frustumCulled = source.frustumCulled
        mesh.raycast = () => {}
        mesh.layers.mask = source.layers.mask
        this.root.add(mesh)
        overlay = { source, mesh, material, style }
        this.overlays.set(key, overlay)
      }
      overlay.mesh.geometry = source.geometry
      overlay.style = style
      overlay.material.color.setRGB(...style.color, SRGBColorSpace)
      overlay.material.vertexColors = false
      overlay.material.opacity = isWideLine(source)
        ? style.outlineOpacity
        : style.fillOpacity
      overlay.material.transparent = true
      overlay.material.blending = NormalBlending
      overlay.material.depthTest = false
      overlay.material.depthWrite = false
      overlay.material.toneMapped = false
      if (isWideLineMaterial(overlay.material))
        overlay.material.linewidth = style.lineWidth
    }
    this.update()
  }
  update() {
    this.root.updateWorldMatrix(true, false)
    this.inverse.copy(this.root.matrixWorld).invert()
    for (const { source, mesh, material } of this.overlays.values()) {
      source.updateWorldMatrix(true, false)
      mesh.matrix.multiplyMatrices(this.inverse, source.matrixWorld)
      mesh.renderOrder = source.renderOrder + 0.01
      mesh.visible = true
      for (let parent: Object3D | null = source; parent; parent = parent.parent)
        if (!parent.visible) mesh.visible = false
      if (isWideLineMaterial(material) && isWideLine(source))
        material.resolution.copy(source.material.resolution)
    }
  }
  dispose() {
    for (const overlay of this.overlays.values()) overlay.material.dispose()
    this.overlays.clear()
    this.root.clear()
    this.root.removeFromParent()
  }
}

// Constructor identity differs across independently bundled Three modules. The branded flags
// preserve fat-line geometry/material handling instead of rendering its instanced quads as fills.
function isWideLine(object: Mesh): object is LineSegments2 {
  return 'isLineSegments2' in object && object.isLineSegments2 === true
}
function isWideLineMaterial(
  material: LineMaterial | MeshBasicMaterial
): material is LineMaterial {
  return 'isLineMaterial' in material && material.isLineMaterial === true
}
