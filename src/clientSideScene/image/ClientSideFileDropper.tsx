import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { isExternalFileDrag } from '@src/components/Explorer/utils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { ImageManager } from '@src/clientSideScene/image/ImageManager'
import { imageManager, sceneInfra } from '@src/lib/singletons'

type ModelingState = ReturnType<typeof useModelingContext>['state']

function isDropEnabled(e: React.DragEvent, state: ModelingState): boolean {
  if (!isExternalFileDrag(e)) {
    return false
  }
  if (!state.matches('Sketch') && !state.matches('sketchSolveMode')) {
    return false
  }
  e.preventDefault()
  e.stopPropagation()
  return true
}

function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.width, height: img.height })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

interface ClientSideFileDropperProps {
  children: React.ReactNode
}

export function ClientSideFileDropper({
  children,
}: ClientSideFileDropperProps) {
  const [isExternalDragOver, setIsExternalDragOver] = useState(false)
  const dragCounter = useRef(0)
  const { state } = useModelingContext()

  const handleFileDrop = async (e: React.DragEvent) => {
    const files = e.dataTransfer.files
    const file = files[0]
    if (!file) return

    if (!ImageManager.isSupportedImageFile(file)) {
      toast.error(`Unsupported image format. Supported: png, jpg, svg, webp`)
      return
    }

    try {
      // Get drop position in world coordinates
      const worldPos = sceneInfra.camControls.screenToWorld(e.nativeEvent)

      // Get image dimensions to calculate aspect ratio
      const imgDimensions = await getImageDimensions(file)
      const aspectRatio = imgDimensions.width / imgDimensions.height

      // Default height in world units, width based on aspect ratio
      const height = 100
      const width = height * aspectRatio

      await imageManager.addImage(file, {
        x: worldPos.x,
        y: worldPos.y,
        width,
        height,
      })
      toast.success(`Added image: ${file.name}`)
    } catch (error) {
      console.error('Failed to add image:', error)
      toast.error(`Failed to add image: ${file.name}`)
    }
  }

  return (
    <div
      className={`absolute inset-0 h-full w-full ${
        isExternalDragOver
          ? 'ring-[6px] ring-inset ring-blue-500 bg-blue-500/5'
          : ''
      }`}
      onDragEnter={(e) => {
        if (isDropEnabled(e, state)) {
          dragCounter.current++
          setIsExternalDragOver(true)
        }
      }}
      onDragOver={(e) => {
        if (isDropEnabled(e, state)) {
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDragLeave={(e) => {
        if (isDropEnabled(e, state)) {
          dragCounter.current--
          if (dragCounter.current <= 0) {
            dragCounter.current = 0
            setIsExternalDragOver(false)
          }
        }
      }}
      onDrop={(e) => {
        if (isDropEnabled(e, state)) {
          dragCounter.current = 0
          setIsExternalDragOver(false)
          if (e.dataTransfer.files.length > 0) {
            void handleFileDrop(e)
          }
        }
      }}
    >
      {children}
    </div>
  )
}
