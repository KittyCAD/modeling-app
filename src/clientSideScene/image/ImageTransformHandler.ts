import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type {
  ImageEntry,
  ImageManager,
} from '@src/clientSideScene/image/ImageManager'
import { IMAGE_RENDERER_GROUP } from '@src/clientSideScene/image/ImageRenderer'
import type { Coords2d } from '@src/lang/util'
import { Vector2 } from 'three'

type DraggingInfo = {
  image: ImageEntry
  imagePosAtStartDrag: Coords2d
  mousePosAtStartDrag: Coords2d
  moved: boolean
}

export class ImageTransformHandler {
  private readonly _imageManager: ImageManager
  private readonly _sceneInfra: SceneInfra

  private _dragging: DraggingInfo | undefined = undefined

  constructor(imageManager: ImageManager, sceneInfra: SceneInfra) {
    this._imageManager = imageManager
    this._sceneInfra = sceneInfra

    this._sceneInfra.selectedSignal.subscribe(this.updateSelection)

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
          moved: false
        }
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

      return true
    } else {
      return false
    }
  }

  public processDragEnd() {
    console.log('dragged?', this._dragging?.moved)
    if (this._dragging) {
      this._dragging = undefined
      void this._imageManager.saveToFile()
      return true
    } else {
      return false
    }
  }
}
