import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react'
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
  const draggingRef = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<{
    fileName: string
    position: 'before' | 'after'
  } | null>(null)
  const { state: modelingState } = useModelingContext()
  const isSketchMode =
    modelingState.matches('Sketch') || modelingState.matches('sketchSolveMode')

  useEffect(() => {
    setImages(imageManager.getImages()?.list || [])
    // Subscribe to imagesChanged signal to refresh when images are added/deleted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageManager.imagesChanged.value])

  const handleVisibilityToggle = useCallback(
    async (imagePath: string) => {
      const image = images.find((img) => img.fileName === imagePath)
      if (!image) return

      const newVisibility = !(image.visible ?? true)
      await imageManager.updateImage(imagePath, { visible: newVisibility })

      setImages((prev) =>
        prev.map((img) =>
          img.fileName === imagePath ? { ...img, visible: newVisibility } : img
        )
      )
    },
    [images]
  )

  const handleLockToggle = useCallback(
    async (imagePath: string) => {
      const image = images.find((img) => img.fileName === imagePath)
      if (!image) return

      const newLocked = !(image.locked ?? false)
      await imageManager.updateImage(imagePath, { locked: newLocked })

      setImages((prev) =>
        prev.map((img) =>
          img.fileName === imagePath ? { ...img, locked: newLocked } : img
        )
      )
    },
    [images]
  )

  const handleMove = useCallback(
    async (imagePath: string, direction: 'up' | 'down') => {
      const index = images.findIndex((img) => img.fileName === imagePath)
      if (index < 0) return
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= images.length) return

      await imageManager.moveImage(imagePath, targetIndex)
      setImages([...(imageManager.getImages()?.list || [])])
    },
    [images]
  )

  const handleDelete = useCallback(async (imagePath: string) => {
    try {
      await imageManager.deleteImage(imagePath)
      setImages((prev) => prev.filter((img) => img.fileName !== imagePath))
      toast.success(`Deleted image: ${imagePath}`)
    } catch (error) {
      console.error('Failed to delete image:', error)
      toast.error(`Failed to delete image: ${imagePath}`)
    }
  }, [])

  const handleFocus = useCallback(
    (imagePath: string) => {
      const image = images.find((img) => img.fileName === imagePath)
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

  const handleDragStart = useCallback(
    (imagePath: string, event: DragEvent<HTMLDivElement>) => {
      draggingRef.current = imagePath
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', imagePath)
    },
    []
  )

  const handleDragOver = useCallback(
    (imagePath: string, position: 'before' | 'after') => {
      const dragging = draggingRef.current
      if (!dragging || dragging === imagePath) {
        setDragOver(null)
        return
      }
      setDragOver({ fileName: imagePath, position })
    },
    []
  )

  const handleDragLeave = useCallback((imagePath: string) => {
    setDragOver((prev) => (prev?.fileName === imagePath ? null : prev))
  }, [])

  const handleDrop = useCallback(
    async (imagePath: string, position: 'before' | 'after') => {
      const dragging = draggingRef.current
      if (!dragging || dragging === imagePath) {
        return
      }

      const fromIndex = images.findIndex((img) => img.fileName === dragging)
      const targetIndex = images.findIndex((img) => img.fileName === imagePath)
      if (fromIndex < 0 || targetIndex < 0) {
        return
      }

      let insertIndex = position === 'after' ? targetIndex + 1 : targetIndex
      if (fromIndex < insertIndex) {
        insertIndex -= 1
      }

      await imageManager.moveImage(dragging, insertIndex)
      setImages([...(imageManager.getImages()?.list || [])])
      draggingRef.current = null
      setDragOver(null)
    },
    [images]
  )

  const handleDragEnd = useCallback(() => {
    draggingRef.current = null
    setDragOver(null)
  }, [])

  if (images.length === 0) {
    return null
  }

  return (
    <div className="mt-2">
      <div className="h-px bg-chalkboard-50/20 mb-2" />
      <div className="text-xs text-chalkboard-70 dark:text-chalkboard-40 px-2 py-1">
        Reference Images
      </div>
      {images.map((image, index) => (
        <ImageItem
          key={image.fileName}
          image={image}
          canMoveUp={index > 0}
          canMoveDown={index < images.length - 1}
          dragOverPosition={
            dragOver?.fileName === image.fileName ? dragOver.position : null
          }
          onVisibilityToggle={handleVisibilityToggle}
          onLockToggle={handleLockToggle}
          onDelete={handleDelete}
          onMove={handleMove}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onFocus={isSketchMode ? handleFocus : undefined}
        />
      ))}
    </div>
  )
}

interface ImageItemProps {
  image: ImageEntry
  canMoveUp: boolean
  canMoveDown: boolean
  dragOverPosition: 'before' | 'after' | null
  onVisibilityToggle: (imagePath: string) => void | Promise<void>
  onLockToggle: (imagePath: string) => void | Promise<void>
  onDelete: (imagePath: string) => void | Promise<void>
  onMove: (imagePath: string, direction: 'up' | 'down') => void | Promise<void>
  onDragStart: (imagePath: string, event: DragEvent<HTMLDivElement>) => void
  onDragOver: (imagePath: string, position: 'before' | 'after') => void
  onDragLeave: (imagePath: string) => void
  onDrop: (imagePath: string, position: 'before' | 'after') => void
  onDragEnd: () => void
  onFocus?: (imagePath: string) => void
}

function ImageItem({
  image,
  canMoveUp,
  canMoveDown,
  dragOverPosition,
  onVisibilityToggle,
  onLockToggle,
  onDelete,
  onMove,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onFocus,
}: ImageItemProps) {
  const visible = image.visible ?? true
  const locked = image.locked ?? false
  const itemRef = useRef<HTMLDivElement>(null)

  const contextMenuItems = [
    <ContextMenuItem
      key="delete"
      icon="close"
      onClick={() => void onDelete(image.fileName)}
    >
      Delete
    </ContextMenuItem>,
  ]
  if (onFocus) {
    contextMenuItems.push(
      <ContextMenuItem
        key="focus"
        icon="search"
        onClick={() => onFocus(image.fileName)}
      >
        Focus
      </ContextMenuItem>
    )
  }

  return (
    <div
      ref={itemRef}
      className="relative flex items-center group/item my-0 py-0.5 px-1 hover:bg-2"
      draggable
      onDragStart={(event) => onDragStart(image.fileName, event)}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        const position =
          event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        onDragOver(image.fileName, position)
      }}
      onDragLeave={() => onDragLeave(image.fileName)}
      onDrop={(event) => {
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        const position =
          event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        onDrop(image.fileName, position)
      }}
      onDragEnd={onDragEnd}
    >
      {dragOverPosition === 'before' && (
        <div className="absolute left-0 right-0 top-0 h-px bg-primary" />
      )}
      {dragOverPosition === 'after' && (
        <div className="absolute left-0 right-0 bottom-0 h-px bg-primary" />
      )}
      <ContextMenu menuTargetElement={itemRef} items={contextMenuItems} />
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <CustomIcon name="file" className="w-6 h-6 block flex-shrink-0" />
        <span className="text-sm truncate">{image.fileName}</span>
      </div>
      {/* <div className="flex items-center gap-0.5">
        <button
          onClick={() => void onMove(image.fileName, 'up')}
          draggable={false}
          className={`p-0 m-0 border-transparent dark:border-transparent transition-opacity ${
            canMoveUp
              ? 'opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover/item:opacity-30'
          }`}
          aria-label="Move image up"
          disabled={!canMoveUp}
        >
          <CustomIcon name="caretUp" className="w-4 h-4" />
        </button>
        <button
          onClick={() => void onMove(image.fileName, 'down')}
          draggable={false}
          className={`p-0 m-0 border-transparent dark:border-transparent transition-opacity ${
            canMoveDown
              ? 'opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover/item:opacity-30'
          }`}
          aria-label="Move image down"
          disabled={!canMoveDown}
        >
          <CustomIcon name="caretDown" className="w-4 h-4" />
        </button>
      </div> */}
      <button
        onClick={() => void onLockToggle(image.fileName)}
        draggable={false}
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
        onClick={() => void onVisibilityToggle(image.fileName)}
        draggable={false}
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
