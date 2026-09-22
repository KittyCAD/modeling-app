import { getLocalCameraSceneScale } from '@src/clientSideScene/cameraSceneScale'
import { createPlaneMaterials } from '@src/clientSideScene/localRenderer/planeMaterials'
import { type ResolvedTheme, Themes } from '@src/lib/theme'
import type { PlaneVisibilityMap } from '@src/machines/modelingSharedTypes'
import {
  CanvasTexture,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  Mesh,
  type Object3D,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { type Line2NodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'

const PLANE_SIZE_MM = 100
const MILLIMETERS_TO_METERS = 1 / 1000
const LABEL_FONT = '24px "Source Code VF", monospace'
const LABEL_TEXTURE_SCALE = 2
const LABEL_MM_PER_PIXEL = 0.12

// sRGB palette matching the engine; convert to linear when assigning materials.
const PLANES = [
  { key: 'xy', name: 'XY', label: 'Top', color: new Color(0.7, 0.28, 0.28) },
  { key: 'yz', name: 'YZ', label: 'Side', color: new Color(0.28, 0.7, 0.28) },
  { key: 'xz', name: 'XZ', label: 'Front', color: new Color(0.28, 0.28, 0.7) },
] satisfies {
  key: keyof PlaneVisibilityMap
  name: string
  label: string
  color: Color
}[]

type PlaneLabel = {
  context: CanvasRenderingContext2D
  texture: CanvasTexture
  text: string
  background: Color
}

/** Reference geometry, independent of the exported model and its lifetime. */
export class DefaultPlaneRenderer {
  readonly planes = new Map<
    keyof PlaneVisibilityMap,
    { group: Group; fill: Mesh }
  >()
  private readonly group = new Group()
  private readonly planeGeometry = new PlaneGeometry(
    PLANE_SIZE_MM,
    PLANE_SIZE_MM
  )
  private readonly borderGeometry = new LineSegmentsGeometry()
  private readonly materials: (MeshBasicNodeMaterial | Line2NodeMaterial)[] = []
  private readonly labels: PlaneLabel[] = []
  private readonly labelGeometries: PlaneGeometry[] = []

  constructor(theme: ResolvedTheme) {
    this.group.name = 'default-planes'
    // Author in engine coordinates (Z-up, mm), then match glTF (Y-up, meters).
    this.group.rotation.x = -Math.PI / 2
    this.updateScale(100)
    const edges = new EdgesGeometry(this.planeGeometry)
    this.borderGeometry.fromEdgesGeometry(edges)
    edges.dispose()

    for (const { key, name, label, color } of PLANES) {
      const plane = new Group()
      plane.name = name
      if (name === 'YZ') plane.rotation.set(Math.PI / 2, Math.PI / 2, 0)
      if (name === 'XZ') plane.rotation.x = Math.PI / 2

      const { fillMaterial, borderMaterial } = createPlaneMaterials(color, 0.1)
      const fill = new Mesh(this.planeGeometry, fillMaterial)
      fill.name = `${name}-fill`
      this.materials.push(fillMaterial)
      plane.add(fill)

      const border = new LineSegments2(this.borderGeometry, borderMaterial)
      border.name = `${name}-border`
      this.materials.push(borderMaterial)
      plane.add(border)

      plane.add(this.createLabel(name, borderMaterial.color, true))
      plane.add(this.createLabel(label, borderMaterial.color, false))
      this.planes.set(key, { group: plane, fill })
      this.group.add(plane)
    }
    this.setTheme(theme)
  }

  addTo(parent: Object3D) {
    parent.add(this.group)
  }

  setVisibility(visibility: PlaneVisibilityMap) {
    for (const [key, { group }] of this.planes) {
      group.visible = visibility[key]
    }
  }

  updateScale(cameraDistanceMm: number, fixedGridScale?: number) {
    this.group.scale.setScalar(
      (fixedGridScale ?? getLocalCameraSceneScale(cameraDistanceMm)) *
        MILLIMETERS_TO_METERS
    )
  }

  setTheme(theme: ResolvedTheme) {
    for (const { context, texture, text, background: labelBackground } of this
      .labels) {
      const width = context.canvas.width / LABEL_TEXTURE_SCALE
      const height = context.canvas.height / LABEL_TEXTURE_SCALE
      context.fillStyle = labelBackground.getStyle()
      context.fillRect(0, 0, width, height)
      context.fillStyle = theme === Themes.Light ? '#000000' : '#ffffff'
      context.fillText(text, width / 2, height / 2)
      texture.needsUpdate = true
    }
  }

  dispose() {
    this.planes.clear()
    this.group.removeFromParent()
    this.group.clear()
    this.planeGeometry.dispose()
    this.borderGeometry.dispose()
    this.labelGeometries.forEach((geometry) => geometry.dispose())
    this.materials.forEach((material) => material.dispose())
    this.labels.forEach(({ texture }) => texture.dispose())
  }

  private createLabel(text: string, background: Color, topLeft: boolean) {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) {
      console.warn('Unable to draw default plane label: 2D canvas unavailable')
      return new Group()
    }
    context.font = LABEL_FONT
    const width = Math.ceil(context.measureText(text).width) + 20
    const height = 32
    canvas.width = width * LABEL_TEXTURE_SCALE
    canvas.height = height * LABEL_TEXTURE_SCALE
    context.scale(LABEL_TEXTURE_SCALE, LABEL_TEXTURE_SCALE)
    context.font = LABEL_FONT
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    this.labels.push({ context, texture, text, background })

    const material = new MeshBasicNodeMaterial({
      map: texture,
      side: DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this.materials.push(material)
    const labelWidth = width * LABEL_MM_PER_PIXEL
    const labelHeight = height * LABEL_MM_PER_PIXEL
    const geometry = new PlaneGeometry(labelWidth, labelHeight)
    this.labelGeometries.push(geometry)
    const label = new Mesh(geometry, material)
    label.name = text
    const corner = topLeft ? -1 : 1
    label.position.set(
      (corner * (PLANE_SIZE_MM - labelWidth)) / 2,
      (-corner * (PLANE_SIZE_MM - labelHeight)) / 2,
      0
    )
    return label
  }
}
