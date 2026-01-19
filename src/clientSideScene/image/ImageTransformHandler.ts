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

  public processDrag(
    selected: SceneInfra['selected'],
    intersectionPoint: Vector2 | undefined
  ) {
    if (intersectionPoint) {
      const isReferenceImage =
        selected?.object.parent?.name === IMAGE_RENDERER_GROUP
      if (isReferenceImage) {
        if (this._dragging) {
          this.dragUpdate(selected, this._dragging, intersectionPoint)
        } else {
          // Start drag
          const image = selected.object.userData.image as ImageEntry
          this._dragging = {
            image,
            imagePosAtStartDrag: [image.x, image.y],
            mousePosAtStartDrag: [intersectionPoint.x, intersectionPoint.y],
          }
        }

        return true
      }
    }
    return false
  }

  private dragUpdate(
    selected: SceneInfra['_selected'],
    draggingInfo: DraggingInfo,
    intersectionPoint: Vector2
  ) {
    const diff = intersectionPoint
      .clone()
      .sub(new Vector2(...draggingInfo.mousePosAtStartDrag))
    const x = draggingInfo.imagePosAtStartDrag[0] + diff.x
    const y = draggingInfo.imagePosAtStartDrag[1] + diff.y
    selected?.object.position.set(x, y, 1)

    draggingInfo.image.x = x
    draggingInfo.image.y = y

    // drag end only
    //void this._imageManager.updateImagePosition(draggingInfo.imagePath, [x, y])
  }

  private dragEnd() {}
}
