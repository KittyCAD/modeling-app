import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type {
  ImageEntry,
  ImageManager,
} from '@src/clientSideScene/image/ImageManager'
import { IMAGE_RENDERER_GROUP } from '@src/clientSideScene/image/imageConstants'
import type { Coords2d } from '@src/lang/util'
import { Vector2 } from 'three'
import {
  IMAGE_TRANSFORM_CORNER,
  IMAGE_TRANSFORM_EDGE,
  IMAGE_TRANSFORM_ROTATE,
  ImageTransformUI,
} from '@src/clientSideScene/image/ImageTransformUI'

type DraggingInfo = {
  image: ImageEntry
  imagePosAtStartDrag: Coords2d
  mousePosAtStartDrag: Coords2d
  moved: boolean
}

type ResizeTarget =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

type ResizingInfo = {
  image: ImageEntry
  target: ResizeTarget
  start: {
    x: number
    y: number
    width: number
    height: number
    rotation: number
  }
  aspectRatio: number
  lastPointer?: Vector2
}

type RotatingInfo = {
  image: ImageEntry
  startRotation: number
  startAngle: number
  center: Vector2
  lastPointer?: Vector2
}

type ModifierState = {
  lockAspect: boolean
  center: boolean
  snapRotation: boolean
}

export class ImageTransformHandler {
  private readonly _imageManager: ImageManager
  private readonly _sceneInfra: SceneInfra

  private _dragging: DraggingInfo | undefined
  private _resizing: ResizingInfo | undefined
  private _rotating: RotatingInfo | undefined
  private _modifierState: ModifierState = {
    lockAspect: true,
    center: false,
    snapRotation: false,
  }

  private _ui: ImageTransformUI | undefined

  constructor(imageManager: ImageManager, sceneInfra: SceneInfra) {
    this._imageManager = imageManager
    this._sceneInfra = sceneInfra

    this._sceneInfra.selectedSignal.subscribe(this.updateSelection)
    this._sceneInfra.camControls.cameraChange.add(this.updateUI)
    this._sceneInfra.baseUnitChange.add(this.updateUI)
    globalThis.addEventListener('keydown', this.onModifierChange)
    globalThis.addEventListener('keyup', this.onModifierChange)
    globalThis.addEventListener('blur', this.onModifierReset)

    imageManager.selected.subscribe(this.onSelectionChange)

    this.updateSelection()
  }

  private readonly updateSelection = () => {
    const selected = this._sceneInfra.selected
    if (!selected) {
      this._dragging = undefined
      this._resizing = undefined
      this._rotating = undefined
    }
  }

  public startDrag(
    selected: SceneInfra['selected'],
    intersectionPoint: Vector2 | undefined
  ) {
    const image = (selected?.object.userData.image ||
      selected?.object.parent?.userData.image) as ImageEntry | undefined
    if (image?.locked) {
      return false
    }
    if (intersectionPoint) {
      const isReferenceImage =
        selected?.object.parent?.name === IMAGE_RENDERER_GROUP
      if (isReferenceImage && image) {
        // Start dragging the image
        this._dragging = {
          image,
          imagePosAtStartDrag: [image.x, image.y],
          mousePosAtStartDrag: [intersectionPoint.x, intersectionPoint.y],
          moved: false,
        }
        this._imageManager.setSelected(image)
        return true
      } else {
        if (image) {
          // Start dragging one of the transform handles
          const resizing =
            selected?.object.userData.type === IMAGE_TRANSFORM_EDGE ||
            selected?.object.userData.type === IMAGE_TRANSFORM_CORNER
          const rotating =
            selected?.object.userData.type === IMAGE_TRANSFORM_ROTATE
          if (resizing) {
            const target = selected?.object.userData.target as
              | ResizeTarget
              | undefined
            if (!target) {
              return false
            }
            this._resizing = {
              image,
              target,
              start: {
                x: image.x,
                y: image.y,
                width: image.width,
                height: image.height,
                rotation: image.rotation ?? 0,
              },
              aspectRatio: image.width / image.height,
              lastPointer: intersectionPoint.clone(),
            }
            this._dragging = undefined
            this._rotating = undefined
            this._imageManager.setSelected(image)
            this.applyResize(intersectionPoint)
            return true
          }
          if (rotating) {
            const center = new Vector2(image.x, image.y)
            const startAngle = Math.atan2(
              intersectionPoint.y - center.y,
              intersectionPoint.x - center.x
            )
            this._rotating = {
              image,
              startRotation: image.rotation ?? 0,
              startAngle,
              center,
              lastPointer: intersectionPoint.clone(),
            }
            this._dragging = undefined
            this._resizing = undefined
            this._imageManager.setSelected(image)
            this.applyRotation(intersectionPoint)
            return true
          }
        }
      }
    }
    return false
  }

  public processDrag(
    selected: SceneInfra['selected'],
    intersectionPoint: Vector2 | undefined
  ) {
    if (intersectionPoint) {
      if (this._dragging) {
        const diff = intersectionPoint
          .clone()
          .sub(new Vector2(...this._dragging.mousePosAtStartDrag))
        const x = this._dragging.imagePosAtStartDrag[0] + diff.x
        const y = this._dragging.imagePosAtStartDrag[1] + diff.y
        selected?.object.position.set(x, y, selected.object.position.z)

        this._dragging.image.x = x
        this._dragging.image.y = y
        this._dragging.moved = true
        this.updateUI()

        return true
      } else if (this._resizing) {
        this._resizing.lastPointer = intersectionPoint.clone()
        this.applyResize(intersectionPoint)
        return true
      } else if (this._rotating) {
        this._rotating.lastPointer = intersectionPoint.clone()
        this.applyRotation(intersectionPoint)
        return true
      }
    }
    return false
  }

  public processDragEnd() {
    if (this._dragging || this._resizing || this._rotating) {
      const image =
        this._dragging?.image ?? this._resizing?.image ?? this._rotating?.image
      this._imageManager.setSelected(image)
      this._dragging = undefined
      this._resizing = undefined
      this._rotating = undefined
      void this._imageManager.saveToFile()
      return true
    } else {
      this._imageManager.setSelected(undefined)
      return false
    }
  }

  private readonly onSelectionChange = (selected: ImageEntry | undefined) => {
    if (selected) {
      this.attachUI()
      this.updateUI()
    } else {
      this.detachUI()
    }
  }

  private attachUI() {
    this._ui ??= new ImageTransformUI(this._sceneInfra)
    this._sceneInfra.imageRenderer.group.add(this._ui.container)
  }

  private detachUI() {
    if (this._ui?.container.parent) {
      this._ui.container.parent.remove(this._ui.container)
    }
  }

  private readonly updateUI = () => {
    const selected = this._imageManager.selected.value
    if (!selected || !this._ui) {
      return
    }
    this._ui.update(selected)
  }

  private readonly onModifierChange = (event: KeyboardEvent) => {
    const newModifiers: ModifierState = {
      lockAspect: !event.ctrlKey,
      center: event.altKey,
      snapRotation: event.shiftKey,
    }
    const changed =
      newModifiers.lockAspect !== this._modifierState.lockAspect ||
      newModifiers.center !== this._modifierState.center ||
      newModifiers.snapRotation !== this._modifierState.snapRotation
    this._modifierState = newModifiers
    if (!changed) {
      return
    }
    if (this._resizing?.lastPointer) {
      this.applyResize(this._resizing.lastPointer)
    }
    if (this._rotating?.lastPointer) {
      this.applyRotation(this._rotating.lastPointer)
    }
  }

  private readonly onModifierReset = () => {
    const changed =
      !this._modifierState.lockAspect ||
      this._modifierState.center ||
      this._modifierState.snapRotation
    this._modifierState = {
      lockAspect: true,
      center: false,
      snapRotation: false,
    }
    if (!changed) {
      return
    }
    if (this._resizing?.lastPointer) {
      this.applyResize(this._resizing.lastPointer)
    }
    if (this._rotating?.lastPointer) {
      this.applyRotation(this._rotating.lastPointer)
    }
  }

  private applyResize(pointer: Vector2) {
    if (!this._resizing) {
      return
    }
    const { image, target, start, aspectRatio } = this._resizing
    const axes = this.getResizeAxes(target)
    const halfWidth = start.width * 0.5
    const halfHeight = start.height * 0.5
    const minSize = 0.0001
    const center = new Vector2(start.x, start.y)
    const localPointer = pointer
      .clone()
      .sub(center)
      .rotateAround(new Vector2(0, 0), -start.rotation)

    let newWidth = start.width
    let newHeight = start.height
    let newX = 0
    let newY = 0

    if (this._modifierState.center) {
      if (axes.x !== 0) {
        newWidth = Math.max(minSize, Math.abs(localPointer.x) * 2)
      }
      if (axes.y !== 0) {
        newHeight = Math.max(minSize, Math.abs(localPointer.y) * 2)
      }
    } else {
      if (axes.x !== 0) {
        const anchorX = -axes.x * halfWidth
        newWidth = Math.max(minSize, Math.abs(localPointer.x - anchorX))
        newX = (localPointer.x + anchorX) * 0.5
      }
      if (axes.y !== 0) {
        const anchorY = -axes.y * halfHeight
        newHeight = Math.max(minSize, Math.abs(localPointer.y - anchorY))
        newY = (localPointer.y + anchorY) * 0.5
      }
    }

    if (this._modifierState.lockAspect && aspectRatio > 0) {
      if (axes.x !== 0 && axes.y !== 0) {
        const widthScale = newWidth / start.width
        const heightScale = newHeight / start.height
        const scale = Math.max(widthScale, heightScale)
        newWidth = Math.max(minSize, start.width * scale)
        newHeight = Math.max(minSize, start.height * scale)
        if (!this._modifierState.center) {
          const anchorX = -axes.x * halfWidth
          const anchorY = -axes.y * halfHeight
          newX = anchorX + axes.x * newWidth * 0.5
          newY = anchorY + axes.y * newHeight * 0.5
        }
      } else if (axes.x !== 0) {
        const scale = newWidth / start.width
        newHeight = Math.max(minSize, start.height * scale)
        if (!this._modifierState.center) {
          newY = 0
        }
      } else if (axes.y !== 0) {
        const scale = newHeight / start.height
        newWidth = Math.max(minSize, start.width * scale)
        if (!this._modifierState.center) {
          newX = 0
        }
      }
    } else if (!this._modifierState.center) {
      if (axes.x === 0) {
        newX = 0
      }
      if (axes.y === 0) {
        newY = 0
      }
    }

    const centerOffset = new Vector2(newX, newY).rotateAround(
      new Vector2(0, 0),
      start.rotation
    )
    const nextCenter = center.clone().add(centerOffset)

    image.x = nextCenter.x
    image.y = nextCenter.y
    image.width = newWidth
    image.height = newHeight
    this.updateImageMesh(image)
    this.updateUI()
  }

  private applyRotation(pointer: Vector2) {
    if (!this._rotating) {
      return
    }
    const { image, startRotation, startAngle, center } = this._rotating
    const angle = Math.atan2(pointer.y - center.y, pointer.x - center.x)
    let nextRotation = startRotation + (angle - startAngle)
    if (this._modifierState.snapRotation) {
      const snap = (5 * Math.PI) / 180
      nextRotation = Math.round(nextRotation / snap) * snap
    }
    image.rotation = nextRotation
    this.updateImageMesh(image)
    this.updateUI()
  }

  private updateImageMesh(image: ImageEntry) {
    const mesh = this._sceneInfra.scene.getObjectByName(
      `ReferenceImage_${image.fileName}`
    )
    if (!mesh) {
      return
    }
    mesh.position.set(image.x, image.y, mesh.position.z)
    mesh.scale.set(image.width, image.height, 1)
    mesh.rotation.z = image.rotation ?? 0
  }

  private getResizeAxes(target: ResizeTarget): {
    x: -1 | 0 | 1
    y: -1 | 0 | 1
  } {
    switch (target) {
      case 'left':
        return { x: -1, y: 0 }
      case 'right':
        return { x: 1, y: 0 }
      case 'top':
        return { x: 0, y: 1 }
      case 'bottom':
        return { x: 0, y: -1 }
      case 'top-left':
        return { x: -1, y: 1 }
      case 'top-right':
        return { x: 1, y: 1 }
      case 'bottom-left':
        return { x: -1, y: -1 }
      case 'bottom-right':
        return { x: 1, y: -1 }
    }
  }

  // TODO not yet called from anywhere
  public dispose() {
    globalThis.removeEventListener('keydown', this.onModifierChange)
    globalThis.removeEventListener('keyup', this.onModifierChange)
    globalThis.removeEventListener('blur', this.onModifierReset)
  }
}
