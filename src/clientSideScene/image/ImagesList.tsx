import { useCallback, useEffect, useState } from 'react'
import { useRouteLoaderData } from 'react-router-dom'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  ImageManager,
  type ImageEntry,
} from '@src/clientSideScene/image/ImageManager'
import { PATHS } from '@src/lib/paths'
import type { IndexLoaderData } from '@src/lib/types'

export function ImagesList() {
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const [images, setImages] = useState<ImageEntry[]>([])
  const [imageManager, setImageManager] = useState<ImageManager | null>(null)

  useEffect(() => {
    if (!loaderData?.project?.path) return

    const manager = new ImageManager(loaderData.project.path)
    setImageManager(manager)

    manager.getImages().then(setImages).catch(console.error)
  }, [loaderData?.project?.path])

  const handleVisibilityToggle = useCallback(
    async (imagePath: string) => {
      if (!imageManager) return

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
    [imageManager, images]
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
        />
      ))}
    </div>
  )
}

interface ImageItemProps {
  image: ImageEntry
  onVisibilityToggle: (imagePath: string) => void
}

function ImageItem({ image, onVisibilityToggle }: ImageItemProps) {
  const visible = image.visible ?? true

  return (
    <div className="flex items-center group/item my-0 py-0.5 px-1 hover:bg-2">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <CustomIcon name="file" className="w-6 h-6 block flex-shrink-0" />
        <span className="text-sm truncate">{image.path}</span>
      </div>
      <button
        onClick={() => onVisibilityToggle(image.path)}
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
