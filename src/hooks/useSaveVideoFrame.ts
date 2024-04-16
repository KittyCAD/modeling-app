import { RefObject, useEffect } from 'react'
import { useFileContext } from './useFileContext'
import { isTauri } from 'lib/isTauri'
import { writeFile } from '@tauri-apps/plugin-fs'
import { PROJECT_IMAGE_NAME } from 'lib/constants'
import { join } from '@tauri-apps/api/path'

export function useSaveVideoFrame(video: RefObject<HTMLVideoElement>) {
  const {
    context: { project },
  } = useFileContext()

  useEffect(() => {
    const localRef = video.current

    // Save the current frame to a file
    // before unloading
    return () => {
      if (localRef && isTauri() && project.path) {
        saveVideoFrame(localRef, project.path)
      }
    }
  }, [])
}

async function saveVideoFrame(videoElement: HTMLVideoElement, dirPath: string) {
  // In future, we can save video frames in the browser
  // by uploading them to the server
  if (!isTauri()) return

  // Save the current frame to a file
  const bitmap = await createImageBitmap(videoElement, {
    resizeWidth: 1280,
  })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  ctx!.drawImage(bitmap, 0, 0)

  canvas.toBlob(
    async (image) => {
      if (!image) return

      const path = await join(dirPath, PROJECT_IMAGE_NAME)

      await writeFile(path, new Uint8Array(await image.arrayBuffer()), {
        create: true,
      })
    },
    'image/jpeg',
    0.75
  )
}
