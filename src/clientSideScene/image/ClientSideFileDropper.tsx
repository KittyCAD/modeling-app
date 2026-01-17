import { useRef, useState } from 'react'
import { useRouteLoaderData } from 'react-router-dom'
import toast from 'react-hot-toast'
import { isExternalFileDrag } from '@src/components/Explorer/utils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { ImageManager } from '@src/clientSideScene/image/ImageManager'
import { PATHS } from '@src/lib/paths'
import type { IndexLoaderData } from '@src/lib/types'

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

interface ClientSideFileDropperProps {
  children: React.ReactNode
}

export function ClientSideFileDropper({
  children,
}: ClientSideFileDropperProps) {
  const [isExternalDragOver, setIsExternalDragOver] = useState(false)
  const dragCounter = useRef(0)
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const { state } = useModelingContext()

  const handleFileDrop = async (files: FileList) => {
    if (!loaderData?.project?.path) {
      toast.error('No project path available')
      return
    }

    const file = files[0]
    if (!file) return

    if (!ImageManager.isSupportedImageFile(file)) {
      toast.error(`Unsupported image format. Supported: png, jpg, svg, webp`)
      return
    }

    try {
      const imageManager = new ImageManager(loaderData.project.path)
      await imageManager.addImage(file)
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
            void handleFileDrop(e.dataTransfer.files)
          }
        }
      }}
    >
      {children}
    </div>
  )
}
