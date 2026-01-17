import { useRef, useState } from 'react'
import { isExternalFileDrag } from '@src/components/Explorer/utils'

function handleExternalDragEvent(e: React.DragEvent): boolean {
  if (!isExternalFileDrag(e)) {
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

  return (
    <div
      className={`absolute inset-0 h-full w-full ${
        isExternalDragOver
          ? 'ring-[6px] ring-inset ring-blue-500 bg-blue-500/5'
          : ''
      }`}
      onDragEnter={(e) => {
        if (handleExternalDragEvent(e)) {
          dragCounter.current++
          setIsExternalDragOver(true)
        }
      }}
      onDragOver={(e) => {
        if (handleExternalDragEvent(e)) {
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDragLeave={(e) => {
        if (handleExternalDragEvent(e)) {
          dragCounter.current--
          if (dragCounter.current <= 0) {
            dragCounter.current = 0
            setIsExternalDragOver(false)
          }
        }
      }}
      onDrop={(e) => {
        if (handleExternalDragEvent(e)) {
          dragCounter.current = 0
          setIsExternalDragOver(false)
          if (e.dataTransfer.files.length > 0) {
            console.log('Dropped files:', Array.from(e.dataTransfer.files))
          }
        }
      }}
    >
      {children}
    </div>
  )
}
