import { getLocalCameraSceneScale } from '@src/clientSideScene/cameraSceneScale'
import { createPlaneMaterials } from '@src/clientSideScene/localRenderer/planeMaterials'
import type { ArtifactGraph } from '@src/lang/wasm'
import {
  Color,
  EdgesGeometry,
  Group,
  Mesh,
  type Object3D,
  PlaneGeometry,
  Vector3,
} from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'

export class OffsetPlaneRenderer {
  private readonly group = new Group()
  private readonly planeGeometry = new PlaneGeometry(1, 1)
  private readonly borderGeometry = new LineSegmentsGeometry()
  private readonly materials = createPlaneMaterials(
    new Color(0.6, 0.6, 0.6),
    0.3
  )
  public readonly planes: { artifactId: string, group: Group; mesh: Mesh, size: number }[] = []
  private scale = 1

  constructor() {
    this.group.name = 'offset-planes'
    // Convert engine coordinates (Z-up, mm) to glTF (Y-up, meters).
    this.group.rotation.x = -Math.PI / 2
    this.group.scale.setScalar(1 / 1000)
    const edges = new EdgesGeometry(this.planeGeometry)
    this.borderGeometry.fromEdgesGeometry(edges)
    edges.dispose()
  }

  addTo(parent: Object3D) {
    parent.add(this.group)
  }

  update(artifacts: ArtifactGraph) {
    this.group.clear()
    this.planes.length = 0
    for (const artifact of artifacts.values()) {
      if (
        artifact.type !== 'plane' ||
        artifact.hidden ||
        !artifact.planeInfo ||
        artifact.size == null
      )
        continue

      const { origin, xAxis, yAxis, zAxis } = artifact.planeInfo
      const plane = new Group()
      plane.name = artifact.id
      plane.matrixAutoUpdate = false
      plane.matrix
        .makeBasis(
          new Vector3(xAxis.x, xAxis.y, xAxis.z),
          new Vector3(yAxis.x, yAxis.y, yAxis.z),
          new Vector3(zAxis.x, zAxis.y, zAxis.z)
        )
        .setPosition(origin.x, origin.y, origin.z)
        const mesh = new Mesh(this.planeGeometry, this.materials.fillMaterial)
      plane.add(mesh)
      plane.add(
        new LineSegments2(this.borderGeometry, this.materials.borderMaterial)
      )
      this.planes.push({ artifactId: artifact.id, group: plane, mesh, size: artifact.size })
      this.group.add(plane)
    }
    this.applyScale()
  }

  updateScale(cameraDistanceMm: number, fixedGridScale?: number) {
    this.scale = fixedGridScale ?? getLocalCameraSceneScale(cameraDistanceMm)
    this.applyScale()
  }

  private applyScale() {
    for (const { group, size } of this.planes) {
      // Scale the quad and border, never the plane's world-space origin.
      for (const child of group.children)
        child.scale.setScalar(size * this.scale)
    }
  }

  dispose() {
    this.group.removeFromParent()
    this.group.clear()
    this.planes.length = 0
    this.planeGeometry.dispose()
    this.borderGeometry.dispose()
    this.materials.fillMaterial.dispose()
    this.materials.borderMaterial.dispose()
  }
}
