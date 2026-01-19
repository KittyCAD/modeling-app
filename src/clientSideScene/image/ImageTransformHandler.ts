import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type {
  ImageEntry,
  ImageManager,
} from '@src/clientSideScene/image/ImageManager'
import { IMAGE_RENDERER_GROUP } from '@src/clientSideScene/image/ImageRenderer'
import type { Coords2d } from '@src/lang/util'
import { Vector2 } from 'three'

type DraggingInfo = {
  imagePath: string
  startPos: Coords2d
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
    const isReferenceImage =
      selected?.object.parent?.name === IMAGE_RENDERER_GROUP
    if (isReferenceImage && intersectionPoint) {
      if (this._dragging) {
        this.dragUpdate(selected, this._dragging, intersectionPoint)
      } else {
        // Start dragging
        const image = selected.object.userData.image as ImageEntry
        this._dragging = {
          imagePath: image.path,
          startPos: [image.x, image.y],
        }
      }

      return true
    }
    return false
  }

  private dragUpdate(
    selected: SceneInfra['_selected'],
    draggingInfo: DraggingInfo,
    intersectionPoint: Vector2
  ) {
    const diff = intersectionPoint.clone().sub(selected!.mouseDownVector)
    const x = draggingInfo.startPos[0] + diff.x
    const y = draggingInfo.startPos[1] + diff.y
    selected?.object.position.set(x, y, 1)

    console.log('diff', diff)

    // drag end only
    void this._imageManager.updateImagePosition(draggingInfo.imagePath, [x, y])
  }
}
