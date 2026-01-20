import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ImageEntry } from '@src/clientSideScene/image/ImageManager'
import type { PlaneGeometry } from 'three'
import { Group, Mesh, MeshBasicMaterial } from 'three'
import { RectangleUI } from '@src/clientSideScene/image/RectangleUI'

const UI_BLUE = 0x3b82f6
const UI_Z_OFFSET = 0.2
const HANDLE_SIZE_PX = 6
const EDGE_HIT_THICKNESS_PX = 3
const CORNER_HIT_SIZE_PX = 5
const HIT_AREA_OPACITY = 0.0
const HIT_AREA_COLOR = 0x00ff00
const UI_RENDER_ORDER = 1000
const UI_HANDLE_RENDER_ORDER = 1010

export const IMAGE_TRANSFORM_CORNER = 'image-transform-corner'
export const IMAGE_TRANSFORM_EDGE = 'image-transform-edge'

export class ImageTransformUI {
  public readonly container: Group

  private readonly _sceneInfra: SceneInfra
  private readonly _hitAreaMaterial: MeshBasicMaterial
  private readonly _edgeHitAreas: {
    top: Mesh<PlaneGeometry, MeshBasicMaterial>
    right: Mesh<PlaneGeometry, MeshBasicMaterial>
    bottom: Mesh<PlaneGeometry, MeshBasicMaterial>
    left: Mesh<PlaneGeometry, MeshBasicMaterial>
  }
  private readonly _cornerHitAreas: {
    topLeft: Mesh<PlaneGeometry, MeshBasicMaterial>
    topRight: Mesh<PlaneGeometry, MeshBasicMaterial>
    bottomLeft: Mesh<PlaneGeometry, MeshBasicMaterial>
    bottomRight: Mesh<PlaneGeometry, MeshBasicMaterial>
  }
  private readonly _handles: {
    topLeft: RectangleUI
    topRight: RectangleUI
    bottomLeft: RectangleUI
    bottomRight: RectangleUI
  }

  private readonly _fill: RectangleUI

  constructor(sceneInfra: SceneInfra) {
    this._sceneInfra = sceneInfra
    this.container = new Group()
    this.container.layers.set(SKETCH_LAYER)
    this.container.position.z = UI_Z_OFFSET

    this._handles = {
      topLeft: this.createCornerHandle(),
      topRight: this.createCornerHandle(),
      bottomLeft: this.createCornerHandle(),
      bottomRight: this.createCornerHandle(),
    }
    this._fill = new RectangleUI({
      strokeColor: UI_BLUE,
      strokeWidth: 1,
    })
    this._fill.setRenderOrder(UI_RENDER_ORDER)
    this._hitAreaMaterial = new MeshBasicMaterial({
      color: HIT_AREA_COLOR,
      transparent: true,
      opacity: HIT_AREA_OPACITY,
      depthTest: false,
      depthWrite: false,
    })

    this._edgeHitAreas = {
      top: this.createHitArea({
        type: IMAGE_TRANSFORM_EDGE,
        target: 'top',
      }),
      right: this.createHitArea({
        type: IMAGE_TRANSFORM_EDGE,
        target: 'right',
      }),
      bottom: this.createHitArea({
        type: IMAGE_TRANSFORM_EDGE,
        target: 'bottom',
      }),
      left: this.createHitArea({
        type: IMAGE_TRANSFORM_EDGE,
        target: 'left',
      }),
    }
    this._cornerHitAreas = {
      topLeft: this.createHitArea({
        type: IMAGE_TRANSFORM_CORNER,
        target: 'top-left',
      }),
      topRight: this.createHitArea({
        type: IMAGE_TRANSFORM_CORNER,
        target: 'top-right',
      }),
      bottomLeft: this.createHitArea({
        type: IMAGE_TRANSFORM_CORNER,
        target: 'bottom-left',
      }),
      bottomRight: this.createHitArea({
        type: IMAGE_TRANSFORM_CORNER,
        target: 'bottom-right',
      }),
    }

    this.container.add(this._fill.container)
    Object.values(this._edgeHitAreas).forEach((mesh) =>
      this.container.add(mesh)
    )
    for (const handle of Object.values(this._handles)) {
      handle.setRenderOrder(UI_HANDLE_RENDER_ORDER)
      this.container.add(handle.container)
    }
    Object.values(this._cornerHitAreas).forEach((mesh) =>
      this.container.add(mesh)
    )
  }

  private createCornerHandle() {
    return new RectangleUI({
      fillColor: 0xffffff,
      fillOpacity: 1,
      strokeColor: UI_BLUE,
      strokeWidth: 1,
    })
  }

  private createHitArea(userData: Record<string, unknown>) {
    const mesh = new Mesh(
      this._sceneInfra.imageRenderer.planeGeometry,
      this._hitAreaMaterial
    )
    mesh.renderOrder = UI_HANDLE_RENDER_ORDER + 1
    mesh.userData = {
      ...userData,
    }
    mesh.layers.set(SKETCH_LAYER)
    return mesh
  }

  public update(image: ImageEntry) {
    const { width, height, x, y, visible } = image
    this.container.userData.image = image
    this.container.visible = visible
    this.container.position.set(x, y, UI_Z_OFFSET)

    const halfWidth = width * 0.5
    const halfHeight = height * 0.5
    const uiScale =
      this._sceneInfra.getClientSceneScaleFactor(this.container) *
      window.devicePixelRatio
    const handleSize = HANDLE_SIZE_PX * uiScale
    const edgeThickness = EDGE_HIT_THICKNESS_PX * uiScale
    const cornerHitSize = CORNER_HIT_SIZE_PX * uiScale

    this._fill.setSize(width, height)

    this._edgeHitAreas.top.scale.set(width, edgeThickness, 1)
    this._edgeHitAreas.top.position.set(0, halfHeight, 0)
    this._edgeHitAreas.bottom.scale.set(width, edgeThickness, 1)
    this._edgeHitAreas.bottom.position.set(0, -halfHeight, 0)
    this._edgeHitAreas.left.scale.set(edgeThickness, height, 1)
    this._edgeHitAreas.left.position.set(-halfWidth, 0, 0)
    this._edgeHitAreas.right.scale.set(edgeThickness, height, 1)
    this._edgeHitAreas.right.position.set(halfWidth, 0, 0)

    this._cornerHitAreas.topLeft.scale.set(cornerHitSize, cornerHitSize, 1)
    this._cornerHitAreas.topLeft.position.set(-halfWidth, halfHeight, 0)
    this._cornerHitAreas.topRight.scale.set(cornerHitSize, cornerHitSize, 1)
    this._cornerHitAreas.topRight.position.set(halfWidth, halfHeight, 0)
    this._cornerHitAreas.bottomLeft.scale.set(cornerHitSize, cornerHitSize, 1)
    this._cornerHitAreas.bottomLeft.position.set(-halfWidth, -halfHeight, 0)
    this._cornerHitAreas.bottomRight.scale.set(cornerHitSize, cornerHitSize, 1)
    this._cornerHitAreas.bottomRight.position.set(halfWidth, -halfHeight, 0)

    this._handles.topLeft.container.position.set(-halfWidth, halfHeight, 0)
    this._handles.topRight.container.position.set(halfWidth, halfHeight, 0)
    this._handles.bottomLeft.container.position.set(-halfWidth, -halfHeight, 0)
    this._handles.bottomRight.container.position.set(halfWidth, -halfHeight, 0)

    for (const handle of Object.values(this._handles)) {
      handle.setSize(handleSize, handleSize)
    }
  }
}

export function getImageTransformCursor(object: unknown): string | null {
  if (!object || typeof object !== 'object') {
    return null
  }
  const target = object as {
    userData?: { type?: string; target?: string }
  }
  if (target.userData?.type === IMAGE_TRANSFORM_EDGE) {
    switch (target.userData.target) {
      case 'left':
      case 'right':
        return 'ew-resize'
      case 'top':
      case 'bottom':
        return 'ns-resize'
      default:
        return null
    }
  }
  if (target.userData?.type === IMAGE_TRANSFORM_CORNER) {
    switch (target.userData.target) {
      case 'top-left':
      case 'bottom-right':
        return 'nwse-resize'
      case 'top-right':
      case 'bottom-left':
        return 'nesw-resize'
      default:
        return null
    }
  }
  return null
}
