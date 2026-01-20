import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ImageEntry } from '@src/clientSideScene/image/ImageManager'
import type { Object3D, PlaneGeometry } from 'three'
import { Group, Mesh, MeshBasicMaterial } from 'three'
import { RectangleUI } from '@src/clientSideScene/image/RectangleUI'
import { getRotateCursor } from '@src/clientSideScene/image/cursorUtils'

const UI_BLUE = 0x3b82f6
const UI_Z_OFFSET = 0.2
const HANDLE_SIZE_PX = 6
const EDGE_HIT_THICKNESS_PX = 3
const CORNER_HIT_SIZE_PX = 5
const ROTATE_HIT_SIZE_PX = 18
const ROTATE_HIT_OFFSET_PX = 6
const HIT_AREA_OPACITY = 0.0
const HIT_AREA_COLOR = 0x00ff00
const UI_RENDER_ORDER = 1000
const UI_HANDLE_RENDER_ORDER = 1010

export const IMAGE_TRANSFORM_CORNER = 'image-transform-corner'
export const IMAGE_TRANSFORM_EDGE = 'image-transform-edge'
export const IMAGE_TRANSFORM_ROTATE = 'image-transform-rotate'

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
  private readonly _rotateHitAreas: {
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
    this._rotateHitAreas = {
      topLeft: this.createHitArea({
        type: IMAGE_TRANSFORM_ROTATE,
        target: 'top-left',
      }),
      topRight: this.createHitArea({
        type: IMAGE_TRANSFORM_ROTATE,
        target: 'top-right',
      }),
      bottomLeft: this.createHitArea({
        type: IMAGE_TRANSFORM_ROTATE,
        target: 'bottom-left',
      }),
      bottomRight: this.createHitArea({
        type: IMAGE_TRANSFORM_ROTATE,
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
    Object.values(this._rotateHitAreas).forEach((mesh) =>
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
    const rotateHitSize = ROTATE_HIT_SIZE_PX * uiScale
    const rotateOffset = ROTATE_HIT_OFFSET_PX * uiScale

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

    this._rotateHitAreas.topLeft.scale.set(rotateHitSize, rotateHitSize, 1)
    this._rotateHitAreas.topLeft.position.set(
      -halfWidth - rotateOffset,
      halfHeight + rotateOffset,
      0
    )
    this._rotateHitAreas.topRight.scale.set(rotateHitSize, rotateHitSize, 1)
    this._rotateHitAreas.topRight.position.set(
      halfWidth + rotateOffset,
      halfHeight + rotateOffset,
      0
    )
    this._rotateHitAreas.bottomLeft.scale.set(rotateHitSize, rotateHitSize, 1)
    this._rotateHitAreas.bottomLeft.position.set(
      -halfWidth - rotateOffset,
      -halfHeight - rotateOffset,
      0
    )
    this._rotateHitAreas.bottomRight.scale.set(rotateHitSize, rotateHitSize, 1)
    this._rotateHitAreas.bottomRight.position.set(
      halfWidth + rotateOffset,
      -halfHeight - rotateOffset,
      0
    )

    this._handles.topLeft.container.position.set(-halfWidth, halfHeight, 0)
    this._handles.topRight.container.position.set(halfWidth, halfHeight, 0)
    this._handles.bottomLeft.container.position.set(-halfWidth, -halfHeight, 0)
    this._handles.bottomRight.container.position.set(halfWidth, -halfHeight, 0)

    for (const handle of Object.values(this._handles)) {
      handle.setSize(handleSize, handleSize)
    }
    this.container.rotation.z = image.rotation ?? 0
  }
}

export function getImageTransformCursor(
  object: Object3D | undefined
): string | null {
  if (!object) {
    return null
  }
  const image = object.parent?.userData?.image as ImageEntry | undefined
  if (image?.locked) {
    return null
  }
  if (object.userData?.type === IMAGE_TRANSFORM_EDGE) {
    switch (object.userData.target) {
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
  if (object.userData?.type === IMAGE_TRANSFORM_CORNER) {
    switch (object.userData.target) {
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
  if (object.userData?.type === IMAGE_TRANSFORM_ROTATE) {
    if (image) {
      const rotation = image.rotation ?? 0
      const initialRotation = initialRotations[object.userData.target]
      return getRotateCursor(initialRotation - rotation)
    } else {
      return 'rotate'
    }
  }
  return null
}

const initialRotations: Record<string, number> = {
  'top-right': 0,
  'top-left': -Math.PI / 2,
  'bottom-left': Math.PI,
  'bottom-right': Math.PI / 2,
}
