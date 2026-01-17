import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { ContextMenu, ContextMenuItem } from '@src/components/ContextMenu'
import { type ImageEntry } from '@src/clientSideScene/image/ImageManager'
import { imageManager } from '@src/lib/singletons'

export function ImagesList() {
  useSignals()
  const [images, setImages] = useState<ImageEntry[]>([])

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

  const handleLocate = useCallback((imagePath: string) => {
    // TODO: Implement locate functionality
    toast('Locate functionality coming soon')
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
      {images.map((image) => (
        <ImageItem
          key={image.path}
          image={image}
          onVisibilityToggle={handleVisibilityToggle}
          onDelete={handleDelete}
          onLocate={handleLocate}
        />
      ))}
    </div>
  )
}

interface ImageItemProps {
  image: ImageEntry
  onVisibilityToggle: (imagePath: string) => void | Promise<void>
  onDelete: (imagePath: string) => void | Promise<void>
  onLocate: (imagePath: string) => void
}

function ImageItem({
  image,
  onVisibilityToggle,
  onDelete,
  onLocate,
}: ImageItemProps) {
  const visible = image.visible ?? true
  const itemRef = useRef<HTMLDivElement>(null)

  const contextMenuItems = [
    <ContextMenuItem
      key="delete"
      icon="close"
      onClick={() => void onDelete(image.path)}
    >
      Delete
    </ContextMenuItem>,
    <ContextMenuItem
      key="locate"
      icon="search"
      onClick={() => onLocate(image.path)}
    >
      Locate
    </ContextMenuItem>,
  ]

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
        onClick={() => void onVisibilityToggle(image.path)}
        className="p-0 m-0 border-transparent dark:border-transparent"
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
