import { getLocalCameraSceneScale } from '@src/clientSideScene/cameraSceneScale'
import { createPlaneMaterials } from '@src/clientSideScene/localRenderer/planeMaterials'
import type { ArtifactGraph } from '@src/lang/wasm'
import { type ResolvedTheme, Themes } from '@src/lib/theme'
import type { PlaneVisibilityMap } from '@src/machines/modelingSharedTypes'
import {
  CanvasTexture,
  Color,
  DoubleSide,
  EdgesGeometry,
  Euler,
  Group,
  Matrix4,
  Mesh,
  type Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
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
] as const

type PlaneLabel = {
  context: CanvasRenderingContext2D
  texture: CanvasTexture
  text: string
  background: Color
}

type Plane = {
  group: Group
  mesh: Mesh
  transform: Matrix4
  size: number
  defaultPlane?: (typeof PLANES)[number]
}

export class PlaneRenderer {
  readonly planes = new Map<string, Plane>()
  private readonly group = new Group()
  private readonly planeGeometry = new PlaneGeometry(
    PLANE_SIZE_MM,
    PLANE_SIZE_MM
  )
  private readonly borderGeometry = new LineSegmentsGeometry()
  private readonly materials: (MeshBasicNodeMaterial | Line2NodeMaterial)[] = []
  private readonly labels: PlaneLabel[] = []
  private readonly labelGeometries: PlaneGeometry[] = []
  private readonly offsetMaterials = createPlaneMaterials(
    new Color(0.6, 0.6, 0.6),
    0.3
  )
  private scale = 1

  constructor(private theme: ResolvedTheme) {
    this.group.name = 'reference-planes'
    // Author in engine coordinates (Z-up, mm), then match glTF (Y-up, meters).
    this.group.rotation.x = -Math.PI / 2
    this.group.scale.setScalar(MILLIMETERS_TO_METERS)
    const edges = new EdgesGeometry(this.planeGeometry)
    this.borderGeometry.fromEdgesGeometry(edges)
    edges.dispose()
    this.materials.push(...Object.values(this.offsetMaterials))
  }

  updateDefaultPlanes(ids: Record<keyof PlaneVisibilityMap, string> | null) {
    if (!ids) return
    // A new engine session can change UUIDs without changing the plane visuals.
    for (const [id, plane] of this.planes) {
      if (!plane.defaultPlane || ids[plane.defaultPlane.key] === id) continue
      this.planes.delete(id)
      plane.mesh.name = ids[plane.defaultPlane.key]
      this.planes.set(plane.mesh.name, plane)
    }
    for (const definition of PLANES) {
      const { key, name, label, color } = definition
      if (this.planes.has(ids[key])) continue
      const rotation = new Euler()
      if (key === 'yz') rotation.set(Math.PI / 2, Math.PI / 2, 0)
      if (key === 'xz') rotation.x = Math.PI / 2
      const materials = createPlaneMaterials(color, 0.1)
      this.materials.push(...Object.values(materials))
      const plane = this.addPlane(
        ids[key],
        new Matrix4().makeRotationFromEuler(rotation),
        PLANE_SIZE_MM,
        materials,
        definition
      )
      plane.group.name = name
      plane.group.add(
        this.createLabel(name, materials.borderMaterial.color, true)
      )
      plane.group.add(
        this.createLabel(label, materials.borderMaterial.color, false)
      )
      this.setTheme(this.theme)
    }
    this.applyScale()
  }

  updateOffsetPlanes(artifacts: ArtifactGraph) {
    for (const [id, plane] of this.planes) {
      if (plane.defaultPlane) continue
      plane.group.removeFromParent()
      this.planes.delete(id)
    }
    for (const artifact of artifacts.values()) {
      if (
        artifact.type !== 'plane' ||
        artifact.hidden ||
        !artifact.planeInfo ||
        artifact.size == null
      )
        continue
      const { origin, xAxis, yAxis, zAxis } = artifact.planeInfo
      const transform = new Matrix4()
        .makeBasis(
          new Vector3(xAxis.x, xAxis.y, xAxis.z),
          new Vector3(yAxis.x, yAxis.y, yAxis.z),
          new Vector3(zAxis.x, zAxis.y, zAxis.z)
        )
        .setPosition(origin.x, origin.y, origin.z)
      this.addPlane(artifact.id, transform, artifact.size, this.offsetMaterials)
    }
    this.applyScale()
  }

  private addPlane(
    id: string,
    transform: Matrix4,
    size: number,
    materials: ReturnType<typeof createPlaneMaterials>,
    defaultPlane?: Plane['defaultPlane']
  ) {
    const group = new Group()
    group.name = id
    group.matrixAutoUpdate = false
    const mesh = new Mesh(this.planeGeometry, materials.fillMaterial)
    // Picking returns this mesh; its name is the engine entity UUID for either kind of plane.
    mesh.name = id
    const border = new LineSegments2(
      this.borderGeometry,
      materials.borderMaterial
    )
    border.name = `${defaultPlane?.name ?? id}-border`
    group.add(mesh, border)
    const plane = { group, mesh, transform, size, defaultPlane }
    this.planes.set(id, plane)
    this.group.add(group)
    return plane
  }

  addTo(parent: Object3D) {
    parent.add(this.group)
  }

  setDefaultVisibility(visibility: PlaneVisibilityMap) {
    for (const { defaultPlane, group } of this.planes.values()) {
      if (defaultPlane) group.visible = visibility[defaultPlane.key]
    }
  }

  updateScale(cameraDistanceMm: number, fixedGridScale?: number) {
    this.scale = fixedGridScale ?? getLocalCameraSceneScale(cameraDistanceMm)
    this.applyScale()
  }

  private applyScale() {
    const scale = new Vector3()
    for (const { group, transform, size } of this.planes.values()) {
      // Scale dimensions and labels, never the plane's world-space origin.
      group.matrix
        .copy(transform)
        .scale(scale.setScalar((this.scale * size) / PLANE_SIZE_MM))
      group.matrixWorldNeedsUpdate = true
    }
  }

  setTheme(theme: ResolvedTheme) {
    this.theme = theme
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
