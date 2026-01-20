import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type {
  ImageEntry,
  ImageManager,
} from '@src/clientSideScene/image/ImageManager'
import { IMAGE_RENDERER_GROUP } from '@src/clientSideScene/image/ImageRenderer'
import type { Coords2d } from '@src/lang/util'
import { Vector2 } from 'three'
import { ImageTransformUI } from '@src/clientSideScene/image/ImageTransformUI'

type DraggingInfo = {
  image: ImageEntry
  imagePosAtStartDrag: Coords2d
  mousePosAtStartDrag: Coords2d
  moved: boolean
}

export class ImageTransformHandler {
  private readonly _imageManager: ImageManager
  private readonly _sceneInfra: SceneInfra

  private _selected: ImageEntry | undefined
  private _dragging: DraggingInfo | undefined

  private _ui: ImageTransformUI | undefined

  constructor(imageManager: ImageManager, sceneInfra: SceneInfra) {
    this._imageManager = imageManager
    this._sceneInfra = sceneInfra

    this._sceneInfra.selectedSignal.subscribe(this.updateSelection)
    this._sceneInfra.camControls.cameraChange.add(this.updateUI)
    this._sceneInfra.baseUnitChange.add(this.updateUI)

    this.updateSelection()
  }

  private readonly updateSelection = () => {
    const selected = this._sceneInfra.selected
    if (!selected) {
      this._dragging = undefined
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
        // Start drag
        const image = selected.object.userData.image as ImageEntry
        this._dragging = {
          image,
          imagePosAtStartDrag: [image.x, image.y],
          mousePosAtStartDrag: [intersectionPoint.x, intersectionPoint.y],
          moved: false,
        }
        this.setSelected(image)
        return true
      }
    }
    return false
  }

  public processDrag(
    selected: SceneInfra['selected'],
    intersectionPoint: Vector2 | undefined
  ) {
    if (this._dragging && intersectionPoint) {
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
    } else {
      return false
    }
  }

  public processDragEnd() {
    if (this._dragging) {
      this.setSelected(this._dragging.image)
      this._dragging = undefined
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
}
