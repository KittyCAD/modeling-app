import { useSignals } from '@preact/signals-react/runtime'
import {
  ZOODLE_BRUSH_SIZE_MAX_PX,
  ZOODLE_BRUSH_SIZE_MIN_PX,
  type ZoodleDrawToolDefinition,
  type ZoodleService,
  type ZoodleToolDefinition,
  type ZoodleToolKey,
  zoodleToolKeys,
} from '@src/registry/contracts/zoodle'
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

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

const stopOverlayEventPropagation = (event: SyntheticEvent) => {
  event.stopPropagation()
}

const getDrawToolStrokeStyle = (
  tool: ZoodleDrawToolDefinition,
  canvas: HTMLCanvasElement
) => {
  if (tool.color === 'currentColor') {
    return getComputedStyle(canvas).color
  }

  return tool.color
}

const getDrawToolColorClassName = (tool: ZoodleDrawToolDefinition) =>
  tool.colorClassName || ''

const toolButtonClassName = (tool: ZoodleToolDefinition, isActive: boolean) =>
  `m-0 flex h-7 items-center justify-center rounded-sm border p-0 text-xs ${
    tool.type === 'erase' ? 'w-auto px-2' : 'w-7'
  } ${
    isActive
      ? 'border-chalkboard-50 bg-chalkboard-20 dark:border-chalkboard-60 dark:bg-chalkboard-80'
      : 'border-transparent bg-transparent hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80'
  }`

const toolbarButtonClassName =
  'm-0 h-7 whitespace-nowrap rounded-sm border-none bg-transparent px-2 text-xs hover:bg-chalkboard-20 dark:hover:bg-chalkboard-80'

interface ZoodleToolbarProps {
  activeToolKey: ZoodleToolKey
  activeTool: ZoodleToolDefinition
  brushSize: number
  disabledSend: boolean
  onCancel: () => void
  onClear: () => void
  onSend: () => void
  zoodle: ZoodleService
}

const ZoodleToolbar = (props: ZoodleToolbarProps) => (
  <div className="pointer-events-none absolute top-2 left-2 right-2 flex justify-center">
    <div
      data-testid="viewport-annotation-toolbar"
      className="pointer-events-auto flex w-full max-w-max flex-wrap items-center justify-center gap-2 rounded-sm border border-chalkboard-30 bg-chalkboard-10/95 p-1 shadow-sm dark:border-chalkboard-70 dark:bg-chalkboard-90/95"
    >
      <div className="flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1">
        {zoodleToolKeys.map((toolKey: ZoodleToolKey) => {
          const tool = props.zoodle.toolDefinitions[toolKey]
          const isActive = props.activeToolKey === toolKey

          return (
            <button
              key={toolKey}
              type="button"
              data-testid={`viewport-annotation-tool-${toolKey}`}
              aria-label={tool.label}
              aria-pressed={isActive}
              className={toolButtonClassName(tool, isActive)}
              onClick={() => props.zoodle.equipTool(toolKey)}
            >
              {tool.type === 'draw' ? (
                <span
                  className={`h-4 w-4 rounded-full border border-chalkboard-100/40 dark:border-chalkboard-10/40 ${getDrawToolColorClassName(
                    tool
                  )}`}
                  style={{ backgroundColor: tool.color }}
                />
              ) : (
                tool.label
              )}
            </button>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2 px-1">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <span
            data-testid="viewport-annotation-brush-size-dot"
            className={`rounded-full border border-chalkboard-100/40 dark:border-chalkboard-10/40 ${
              props.activeTool.type === 'draw'
                ? getDrawToolColorClassName(props.activeTool)
                : 'text-default'
            }`}
            style={{
              width: `${props.brushSize}px`,
              height: `${props.brushSize}px`,
              backgroundColor:
                props.activeTool.type === 'draw'
                  ? props.activeTool.color
                  : 'currentColor',
            }}
          />
        </span>
        <input
          type="range"
          min={ZOODLE_BRUSH_SIZE_MIN_PX}
          max={ZOODLE_BRUSH_SIZE_MAX_PX}
          step="1"
          value={props.brushSize}
          aria-label="Brush size"
          data-testid="viewport-annotation-brush-size-slider"
          className="h-7 w-24 cursor-pointer accent-ml-green"
          onChange={(event) => {
            props.zoodle.setBrushSize(Number(event.target.value))
          }}
        />
      </div>
      <div className="flex shrink-0 items-center justify-center gap-1">
        <button
          type="button"
          className={toolbarButtonClassName}
          onClick={props.onClear}
        >
          Clear
        </button>
        <button
          type="button"
          className={toolbarButtonClassName}
          onClick={props.onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="viewport-annotation-send-button"
          disabled={props.disabledSend}
          className="m-0 h-7 whitespace-nowrap rounded-sm border-none bg-ml-green px-2 text-xs text-chalkboard-100 hover:bg-ml-green disabled:opacity-60"
          onClick={props.onSend}
        >
          Send
        </button>
      </div>
    </div>
  </div>
)

interface ViewportAnnotationOverlayProps {
  imageDataUrl: string
  onCancel: () => void
  onSend: (annotatedDataUrl: string) => void
  zoodle: ZoodleService
}

export const ViewportAnnotationOverlay = (
  props: ViewportAnnotationOverlayProps
) => {
  useSignals()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const activeToolKey = props.zoodle.activeToolKey.value
  const activeTool = props.zoodle.toolDefinitions[activeToolKey]
  const brushSize = props.zoodle.brushSize.value
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
    ctx.globalCompositeOperation =
      activeTool.type === 'erase' ? 'destination-out' : 'source-over'
    ctx.strokeStyle =
      activeTool.type === 'draw'
        ? getDrawToolStrokeStyle(activeTool, canvas)
        : '#000000'
    const lineWidthMultiplier =
      'lineWidthMultiplier' in activeTool ? activeTool.lineWidthMultiplier : 1
    ctx.lineWidth = brushSize * pixelRatio * lineWidthMultiplier
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

  const activeDrawToolClassName =
    activeTool.type === 'draw' ? getDrawToolColorClassName(activeTool) : ''

  return (
    <div
      role="presentation"
      data-testid="viewport-annotation-overlay"
      className="absolute inset-0 z-50"
      onPointerDown={stopOverlayEventPropagation}
      onPointerMove={stopOverlayEventPropagation}
      onPointerUp={stopOverlayEventPropagation}
      onPointerCancel={stopOverlayEventPropagation}
      onMouseDown={stopOverlayEventPropagation}
      onMouseMove={stopOverlayEventPropagation}
      onMouseUp={stopOverlayEventPropagation}
      onClick={stopOverlayEventPropagation}
      onDoubleClick={stopOverlayEventPropagation}
      onWheel={stopOverlayEventPropagation}
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
        className={`absolute inset-0 h-full w-full touch-none ${
          activeTool.type === 'erase' ? 'cursor-cell' : 'cursor-crosshair'
        } ${activeDrawToolClassName}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          lastPoint.current = null
        }}
      />
      <ZoodleToolbar
        activeToolKey={activeToolKey}
        activeTool={activeTool}
        brushSize={brushSize}
        disabledSend={!imageSize}
        onCancel={props.onCancel}
        onClear={clearDrawing}
        onSend={onSend}
        zoodle={props.zoodle}
      />
    </div>
  )
}
