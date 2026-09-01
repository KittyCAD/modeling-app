import fsZds from '@src/lib/fs-zds'
import type { HomeProjectThumbnail } from '@src/registry/contracts/homeProjects'
import { useEffect, useState } from 'react'

export function useProjectThumbnailUrl(
  thumbnail: HomeProjectThumbnail | undefined
) {
  const [imageUrl, setImageUrl] = useState('')
  const thumbnailType = thumbnail?.type
  const localThumbnailPath =
    thumbnail?.type === 'local' ? thumbnail.path : undefined
  const remoteThumbnailUrl =
    thumbnail?.type === 'remote' ? thumbnail.url : undefined

  useEffect(() => {
    if (!thumbnailType) {
      setImageUrl('')
      return
    }

    if (thumbnailType === 'remote') {
      setImageUrl(remoteThumbnailUrl ?? '')
      return
    }

    if (!localThumbnailPath) {
      setImageUrl('')
      return
    }

    const thumbnailPath = localThumbnailPath
    let disposed = false
    let createdImageUrl: string | undefined

    async function setupImageUrl() {
      try {
        await fsZds.stat(thumbnailPath)
        const imageData = await fsZds.readFile(thumbnailPath)
        const blob = new Blob([new Uint8Array(imageData)], {
          type: 'image/png',
        })

        if (blob.size === 0) {
          return
        }

        createdImageUrl = URL.createObjectURL(blob)
        if (disposed) {
          URL.revokeObjectURL(createdImageUrl)
          return
        }
        setImageUrl(createdImageUrl)
      } catch (error: unknown) {
        console.log(error)
      }
    }

    setImageUrl('')
    void setupImageUrl()

    return () => {
      disposed = true
      if (createdImageUrl) {
        URL.revokeObjectURL(createdImageUrl)
      }
    }
  }, [localThumbnailPath, remoteThumbnailUrl, thumbnailType])

  return imageUrl
}
