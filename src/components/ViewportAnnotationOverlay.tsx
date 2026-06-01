import { TRIM_PREVIEW_LINE_COLOR } from '@src/lib/constants'
import { getTrimPreviewLineWidth } from '@src/lib/freehandLineDrawing'
import { getVisibleViewportRect } from '@src/lib/viewportElement'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    let settled = false
    const resolveOnce = () => {
      if (settled) {
        return
      }
      settled = true
      resolve(image)
    }
    image.onload = resolveOnce
    image.onerror = () => {
      if (settled) {
        return
      }
      settled = true
      reject(new Error('Failed to load viewport screenshot annotation image'))
    }
    image.src = src
    if (image.complete && (image.naturalWidth || image.width)) {
      resolveOnce()
    }
  })

const getCanvasPoint = (
  canvas: HTMLCanvasElement,
  event: ReactPointerEvent<HTMLCanvasElement>
) => {
  const rect = canvas.getBoundingClientRect()
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}

interface ViewportAnnotationOverlayProps {
  imageDataUrl: string
  onCancel: () => void
  onSend: (annotatedDataUrl: string) => void
}

export const ViewportAnnotationOverlay = (
  props: ViewportAnnotationOverlayProps
) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const [viewportRect, setViewportRect] = useState(getVisibleViewportRect)
  const [imageSize, setImageSize] = useState<{
    width: number
    height: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false

    void loadImage(props.imageDataUrl)
      .then((image) => {
        if (cancelled) {
          return
        }

        const width = image.naturalWidth || image.width
        const height = image.naturalHeight || image.height
        setImageSize({ width, height })

        const canvas = canvasRef.current
        if (!canvas) {
          return
        }
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d')?.clearRect(0, 0, width, height)
      })
      .catch((error) => {
        console.error('Failed to prepare viewport annotation image', error)
      })

    return () => {
      cancelled = true
    }
  }, [props.imageDataUrl])

  useEffect(() => {
    const updateViewportRect = () => setViewportRect(getVisibleViewportRect())
    const viewport = document.querySelector('[data-engine]')
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(updateViewportRect)

    if (viewport instanceof HTMLElement) {
      resizeObserver?.observe(viewport)
    }
    window.addEventListener('resize', updateViewportRect)
    window.addEventListener('scroll', updateViewportRect, true)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateViewportRect)
      window.removeEventListener('scroll', updateViewportRect, true)
    }
  }, [])

  const drawTo = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !lastPoint.current) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const nextPoint = getCanvasPoint(canvas, event)
    const rect = canvas.getBoundingClientRect()
    const pixelRatio = rect.width > 0 ? canvas.width / rect.width : 1
    ctx.strokeStyle = TRIM_PREVIEW_LINE_COLOR
    ctx.lineWidth = getTrimPreviewLineWidth(pixelRatio)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    ctx.lineTo(nextPoint.x, nextPoint.y)
    ctx.stroke()
    lastPoint.current = nextPoint
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return
    }

    const canvas = canvasRef.current
    if (!canvas || !imageSize) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    lastPoint.current = getCanvasPoint(canvas, event)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!lastPoint.current) {
      return
    }
    drawTo(event)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!lastPoint.current) {
      return
    }
    drawTo(event)
    lastPoint.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const clearDrawing = () => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }

  const createAnnotatedImageDataUrl = async () => {
    const drawingCanvas = canvasRef.current
    if (!drawingCanvas) {
      return props.imageDataUrl
    }

    const image = await loadImage(props.imageDataUrl)
    const width = image.naturalWidth || drawingCanvas.width
    const height = image.naturalHeight || drawingCanvas.height
    const compositeCanvas = document.createElement('canvas')
    compositeCanvas.width = width
    compositeCanvas.height = height
    const ctx = compositeCanvas.getContext('2d')
    if (!ctx) {
      return props.imageDataUrl
    }

    ctx.drawImage(image, 0, 0, width, height)
    ctx.drawImage(drawingCanvas, 0, 0, width, height)
    return compositeCanvas.toDataURL('image/png')
  }

  const onSend = () => {
    void createAnnotatedImageDataUrl()
      .then(props.onSend)
      .catch((error) => {
        console.error('Failed to create viewport annotation image', error)
      })
  }

  return createPortal(
    <div
      data-testid="viewport-annotation-overlay"
      className="fixed z-50 bg-chalkboard-100"
      style={{
        left: viewportRect.left,
        top: viewportRect.top,
        width: viewportRect.width,
        height: viewportRect.height,
      }}
    >
      <img
        src={props.imageDataUrl}
        alt=""
        className="absolute inset-0 h-full w-full select-none"
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        data-testid="viewport-annotation-canvas"
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          lastPoint.current = null
        }}
      />
      <div className="absolute top-2 left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-sm border border-chalkboard-30 bg-chalkboard-10/95 p-1 shadow-sm dark:border-chalkboard-70 dark:bg-chalkboard-90/95">
        <button
          type="button"
          className="m-0 h-7 px-2 rounded-sm border-none bg-transparent hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 text-xs"
          onClick={clearDrawing}
        >
          Clear
        </button>
        <button
          type="button"
          className="m-0 h-7 px-2 rounded-sm border-none bg-transparent hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80 text-xs"
          onClick={props.onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="viewport-annotation-send-button"
          disabled={!imageSize}
          className="m-0 h-7 px-2 rounded-sm border-none bg-ml-green hover:bg-ml-green text-chalkboard-100 disabled:opacity-60 text-xs"
          onClick={onSend}
        >
          Send
        </button>
      </div>
    </div>,
    document.body
  )
}
