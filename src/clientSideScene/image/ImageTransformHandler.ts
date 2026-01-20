import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type {
  ImageEntry,
  ImageManager,
} from '@src/clientSideScene/image/ImageManager'
import { IMAGE_RENDERER_GROUP } from '@src/clientSideScene/image/ImageRenderer'
import type { Coords2d } from '@src/lang/util'
import { Vector2 } from 'three'
import {
  IMAGE_TRANSFORM_CORNER,
  IMAGE_TRANSFORM_EDGE,
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
  }
  aspectRatio: number
  lastPointer?: Vector2
}

type ResizeModifiers = {
  lockAspect: boolean
  center: boolean
}

export class ImageTransformHandler {
  private readonly _imageManager: ImageManager
  private readonly _sceneInfra: SceneInfra

  private _selected: ImageEntry | undefined
  private _dragging: DraggingInfo | undefined
  private _resizing: ResizingInfo | undefined
  private _resizeModifiers: ResizeModifiers = {
    lockAspect: true,
    center: false,
  }

  private _ui: ImageTransformUI | undefined

  constructor(imageManager: ImageManager, sceneInfra: SceneInfra) {
    this._imageManager = imageManager
    this._sceneInfra = sceneInfra

    this._sceneInfra.selectedSignal.subscribe(this.updateSelection)
    this._sceneInfra.camControls.cameraChange.add(this.updateUI)
    this._sceneInfra.baseUnitChange.add(this.updateUI)
    globalThis.addEventListener('keydown', this.onResizeModifierChange)
    globalThis.addEventListener('keyup', this.onResizeModifierChange)
    globalThis.addEventListener('blur', this.onResizeModifierReset)

    this.updateSelection()
  }

  private readonly updateSelection = () => {
    const selected = this._sceneInfra.selected
    if (!selected) {
      this._dragging = undefined
      this._resizing = undefined
    }
  }

  public startDrag(
    selected: SceneInfra['selected'],
    intersectionPoint: Vector2 | undefined
  ) {
    if (intersectionPoint) {
      const isReferenceImage =
        selected?.object.parent?.name === IMAGE_RENDERER_GROUP
      if (isReferenceImage) {
        // Start dragging the image
        const image = selected.object.userData.image as ImageEntry
        this._dragging = {
          image,
          imagePosAtStartDrag: [image.x, image.y],
          mousePosAtStartDrag: [intersectionPoint.x, intersectionPoint.y],
          moved: false,
        }
        this.setSelected(image)
        return true
      } else {
        const image = selected?.object.parent?.userData.image as ImageEntry
        if (image) {
          // Start dragging one of the resize handles
          const resizing =
            selected?.object.userData.type === IMAGE_TRANSFORM_EDGE ||
            selected?.object.userData.type === IMAGE_TRANSFORM_CORNER
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
              },
              aspectRatio: image.width / image.height,
              lastPointer: intersectionPoint.clone(),
            }
            this._dragging = undefined
            this.setSelected(image)
            this.applyResize(intersectionPoint)
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
        selected?.object.position.set(x, y, 1)

        this._dragging.image.x = x
        this._dragging.image.y = y
        this._dragging.moved = true
        this.updateUI()

        return true
      } else if (this._resizing) {
        this._resizing.lastPointer = intersectionPoint.clone()
        this.applyResize(intersectionPoint)
        return true
      }
    }
    return false
  }

  public processDragEnd() {
    if (this._dragging || this._resizing) {
      const image = this._dragging?.image ?? this._resizing?.image
      this.setSelected(image)
      this._dragging = undefined
      this._resizing = undefined
      void this._imageManager.saveToFile()
      return true
    } else {
      this.setSelected(undefined)
      return false
    }
  }

  private setSelected(value: ImageEntry | undefined) {
    if (this._selected !== value) {
      this._selected = value
      if (this._selected) {
        this.attachUI()
        this.updateUI()
      } else {
        this.detachUI()
      }
    }
  }

  private attachUI() {
    this._ui ??= new ImageTransformUI(this._sceneInfra)
    this._sceneInfra.scene.add(this._ui.container)
  }

  private detachUI() {
    if (this._ui) {
      const parent = this._ui.container.parent
      if (parent) {
        parent.remove(this._ui.container)
      }
    }
  }

  private readonly updateUI = () => {
    if (!this._selected || !this._ui) {
      return
    }
    this._ui.update(this._selected)
  }

  private readonly onResizeModifierChange = (event: KeyboardEvent) => {
    const newModifiers: ResizeModifiers = {
      lockAspect: !event.ctrlKey,
      center: event.altKey,
    }
    const changed =
      newModifiers.lockAspect !== this._resizeModifiers.lockAspect ||
      newModifiers.center !== this._resizeModifiers.center
    this._resizeModifiers = newModifiers
    if (changed && this._resizing?.lastPointer) {
      this.applyResize(this._resizing.lastPointer)
    }
  }

  private readonly onResizeModifierReset = () => {
    const changed =
      !this._resizeModifiers.lockAspect || this._resizeModifiers.center
    this._resizeModifiers = {
      lockAspect: true,
      center: false,
    }
    if (changed && this._resizing?.lastPointer) {
      this.applyResize(this._resizing.lastPointer)
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

    let newWidth = start.width
    let newHeight = start.height
    let newX = start.x
    let newY = start.y

    if (this._resizeModifiers.center) {
      if (axes.x !== 0) {
        newWidth = Math.max(minSize, Math.abs(pointer.x - start.x) * 2)
      }
      if (axes.y !== 0) {
        newHeight = Math.max(minSize, Math.abs(pointer.y - start.y) * 2)
      }
    } else {
      if (axes.x !== 0) {
        const anchorX = start.x - axes.x * halfWidth
        newWidth = Math.max(minSize, Math.abs(pointer.x - anchorX))
        newX = (pointer.x + anchorX) * 0.5
      }
      if (axes.y !== 0) {
        const anchorY = start.y - axes.y * halfHeight
        newHeight = Math.max(minSize, Math.abs(pointer.y - anchorY))
        newY = (pointer.y + anchorY) * 0.5
      }
    }

    if (this._resizeModifiers.lockAspect && aspectRatio > 0) {
      if (axes.x !== 0 && axes.y !== 0) {
        const widthScale = newWidth / start.width
        const heightScale = newHeight / start.height
        const scale = Math.max(widthScale, heightScale)
        newWidth = Math.max(minSize, start.width * scale)
        newHeight = Math.max(minSize, start.height * scale)
        if (!this._resizeModifiers.center) {
          const anchorX = start.x - axes.x * halfWidth
          const anchorY = start.y - axes.y * halfHeight
          newX = anchorX + axes.x * newWidth * 0.5
          newY = anchorY + axes.y * newHeight * 0.5
        }
      } else if (axes.x !== 0) {
        const scale = newWidth / start.width
        newHeight = Math.max(minSize, start.height * scale)
        if (!this._resizeModifiers.center) {
          newY = start.y
        }
      } else if (axes.y !== 0) {
        const scale = newHeight / start.height
        newWidth = Math.max(minSize, start.width * scale)
        if (!this._resizeModifiers.center) {
          newX = start.x
        }
      }
    } else {
      if (!this._resizeModifiers.center) {
        if (axes.x === 0) {
          newX = start.x
        }
        if (axes.y === 0) {
          newY = start.y
        }
      }
    }

    image.x = newX
    image.y = newY
    image.width = newWidth
    image.height = newHeight
    this.updateImageMesh(image)
    this.updateUI()
  }

  private updateImageMesh(image: ImageEntry) {
    const mesh = this._sceneInfra.scene.getObjectByName(
      `ReferenceImage_${image.path}`
    )
    if (!mesh) {
      return
    }
    mesh.position.set(image.x, image.y, mesh.position.z)
    mesh.scale.set(image.width, image.height, 1)
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
    globalThis.removeEventListener('keydown', this.onResizeModifierChange)
    globalThis.removeEventListener('keyup', this.onResizeModifierChange)
    globalThis.removeEventListener('blur', this.onResizeModifierReset)
  }
}
