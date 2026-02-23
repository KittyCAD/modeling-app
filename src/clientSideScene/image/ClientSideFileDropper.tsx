import { OrthographicCamera } from 'three'
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { isExternalFileDrag } from '@src/components/Explorer/utils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { ImageManager } from '@src/clientSideScene/image/ImageManager'
import { useSingletons } from '@src/lib/boot'

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
  const { sceneInfra, imageManager } = useSingletons()

  const handleFileDrop = async (e: React.DragEvent) => {
    const files = e.dataTransfer.files
    const file = files[0]
    if (!file) return
    if (!ImageManager.isSupportedImageFile(file)) {
      toast.error(`Unsupported image format. Supported: png, jpg, svg, webp`)
      return
    }

    try {
      // Get drop position on the sketch plane (2D coordinates)
      const planeIntersect = sceneInfra.getPlaneIntersectPoint()
      if (!planeIntersect?.twoD) {
        toast.error('Could not determine drop position on sketch plane')
        return
      }
      const dropPos = planeIntersect.twoD
      console.log('Drop position:', { x: dropPos.x, y: dropPos.y })

      // Get image dimensions and calculate size to fit 70% of the view
      const imgDimensions = await getImageDimensions(file)
      const { width, height } = calculateInitialImageSize(
        imgDimensions.width,
        imgDimensions.height,
        sceneInfra.camControls.camera
      )

      await imageManager.addImage(file, {
        x: dropPos.x,
        y: dropPos.y,
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

function calculateInitialImageSize(
  imageWidth: number,
  imageHeight: number,
  camera:
    | OrthographicCamera
    | { fov: number; aspect: number; position: { length(): number } }
): { width: number; height: number } {
  const aspectRatio = imageWidth / imageHeight

  let viewWidth: number
  let viewHeight: number

  if (camera instanceof OrthographicCamera) {
    viewWidth = (camera.right - camera.left) / camera.zoom
    viewHeight = (camera.top - camera.bottom) / camera.zoom
  } else {
    const distance = camera.position.length()
    const fovRad = (camera.fov * Math.PI) / 180
    viewHeight = 2 * Math.tan(fovRad / 2) * distance
    viewWidth = viewHeight * camera.aspect
  }

  // Fit image to 40% of the view, respecting aspect ratio
  const targetFraction = 0.4
  const maxWidth = viewWidth * targetFraction
  const maxHeight = viewHeight * targetFraction

  if (aspectRatio > maxWidth / maxHeight) {
    // Image is wider - fit to width
    return { width: maxWidth, height: maxWidth / aspectRatio }
  } else {
    // Image is taller - fit to height
    return { width: maxHeight * aspectRatio, height: maxHeight }
  }
}
