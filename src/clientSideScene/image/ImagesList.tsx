import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { type ImageEntry } from '@src/clientSideScene/image/ImageManager'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { imageManager, sceneInfra } from '@src/lib/singletons'
import { OrthographicCamera, Vector3 } from 'three'

export function ImagesList() {
  useSignals()
  const [images, setImages] = useState<ImageEntry[]>([])
  const { state: modelingState } = useModelingContext()
  const isSketchMode =
    modelingState.matches('Sketch') || modelingState.matches('sketchSolveMode')

  useEffect(() => {
    imageManager.getImages().then(setImages).catch(console.error)
    // Subscribe to imagesChanged signal to refresh when images are added/deleted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageManager.imagesChanged.value])

  const handleVisibilityToggle = useCallback(
    async (imagePath: string) => {
      const image = images.find((img) => img.path === imagePath)
      if (!image) return

      const newVisibility = !(image.visible ?? true)
      await imageManager.setImageVisibility(imagePath, newVisibility)

      setImages((prev) =>
        prev.map((img) =>
          img.path === imagePath ? { ...img, visible: newVisibility } : img
        )
      )
    },
    [images]
  )

  const handleLockToggle = useCallback(
    async (imagePath: string) => {
      const image = images.find((img) => img.path === imagePath)
      if (!image) return

      const newLocked = !(image.locked ?? false)
      await imageManager.setImageLocked(imagePath, newLocked)

      setImages((prev) =>
        prev.map((img) =>
          img.path === imagePath ? { ...img, locked: newLocked } : img
        )
      )
    },
    [images]
  )

  const handleDelete = useCallback(async (imagePath: string) => {
    try {
      await imageManager.deleteImage(imagePath)
      setImages((prev) => prev.filter((img) => img.path !== imagePath))
      toast.success(`Deleted image: ${imagePath}`)
    } catch (error) {
      console.error('Failed to delete image:', error)
      toast.error(`Failed to delete image: ${imagePath}`)
    }
  }, [])

  const handleFocus = useCallback(
    (imagePath: string) => {
      const image = images.find((img) => img.path === imagePath)
      if (!image) {
        return
      }

      const cameraControls = sceneInfra.camControls
      const camera = cameraControls.camera

      if (!(camera instanceof OrthographicCamera)) {
        return
      }

      const currentTarget = cameraControls.target.clone()
      const offset = camera.position.clone().sub(currentTarget)
      const center = new Vector3(image.x, image.y, 0)
      const rotation = image.rotation ?? 0
      const cos = Math.abs(Math.cos(rotation))
      const sin = Math.abs(Math.sin(rotation))
      const boundWidth = image.width * cos + image.height * sin
      const boundHeight = image.width * sin + image.height * cos
      if (boundWidth <= 0 || boundHeight <= 0) {
        return
      }

      const padding = 1.3
      const paddedWidth = boundWidth * padding
      const paddedHeight = boundHeight * padding

      cameraControls.target.copy(center)

      const viewWidth = camera.right - camera.left
      const viewHeight = camera.top - camera.bottom
      const zoom = Math.min(viewWidth / paddedWidth, viewHeight / paddedHeight)
      camera.position.copy(center.clone().add(offset))
      camera.zoom = zoom

      cameraControls.safeLookAtTarget()
      camera.updateProjectionMatrix()
      cameraControls.update(true)
    },
    [images]
  )

  if (images.length === 0) {
    return null
  }

  return (
    <div className="mt-2">
      <div className="h-px bg-chalkboard-50/20 mb-2" />
      <div className="text-xs text-chalkboard-70 dark:text-chalkboard-40 px-2 py-1">
        Reference Images
      </div>
      {images.map((image) => (
        <ImageItem
          key={image.path}
          image={image}
          onVisibilityToggle={handleVisibilityToggle}
          onLockToggle={handleLockToggle}
          onDelete={handleDelete}
          onFocus={isSketchMode ? handleFocus : undefined}
        />
      ))}
    </div>
  )
}

interface ImageItemProps {
  image: ImageEntry
  onVisibilityToggle: (imagePath: string) => void | Promise<void>
  onLockToggle: (imagePath: string) => void | Promise<void>
  onDelete: (imagePath: string) => void | Promise<void>
  onFocus?: (imagePath: string) => void
}

function ImageItem({
  image,
  onVisibilityToggle,
  onLockToggle,
  onDelete,
  onFocus,
}: ImageItemProps) {
  const visible = image.visible ?? true
  const locked = image.locked ?? false
  const itemRef = useRef<HTMLDivElement>(null)

  const contextMenuItems = [
    <ContextMenuItem
      key="delete"
      icon="close"
      onClick={() => void onDelete(image.path)}
    >
      Delete
    </ContextMenuItem>,
  ]
  if (onFocus) {
    contextMenuItems.push(
      <ContextMenuItem
        key="focus"
        icon="search"
        onClick={() => onFocus(image.path)}
      >
        Focus
      </ContextMenuItem>
    )
  }

  return (
    <div
      ref={itemRef}
      className="flex items-center group/item my-0 py-0.5 px-1 hover:bg-2"
    >
      <ContextMenu menuTargetElement={itemRef} items={contextMenuItems} />
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <CustomIcon name="file" className="w-6 h-6 block flex-shrink-0" />
        <span className="text-sm truncate">{image.path}</span>
      </div>
      <button
        onClick={() => void onLockToggle(image.path)}
        className={`p-0 m-0 border-transparent dark:border-transparent transition-opacity ${
          locked
            ? 'opacity-100'
            : 'opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto'
        }`}
        data-testid="image-lock-toggle"
        aria-label={locked ? 'Unlock image' : 'Lock image'}
      >
        <CustomIcon
          name={locked ? 'lockClosed' : 'lockOpen'}
          className="w-6 h-6"
        />
      </button>
      <button
        onClick={() => void onVisibilityToggle(image.path)}
        className={`p-0 m-0 border-transparent dark:border-transparent transition-opacity ${
          visible
            ? 'opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto'
            : 'opacity-100'
        }`}
        data-testid="image-visibility-toggle"
      >
        <CustomIcon
          name={visible ? 'eyeOpen' : 'eyeCrossedOut'}
          className="w-6 h-6"
        />
      </button>
    </div>
  )
}
