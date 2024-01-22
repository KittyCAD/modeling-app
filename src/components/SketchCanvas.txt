import { useRef, useEffect } from 'react'
import paper from 'paper'
import { useModelingContext } from 'hooks/useModelingContext'
import { sketchCanvasHelper } from './sketchCanvashelper'

export const SketchCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { send, state, context } = useModelingContext()
  useEffect(() => {
    sketchCanvasHelper.setSend(send)
  }, [])

  useEffect(() => {
    if (paper?.view) {
      paper.view.onMouseMove = ({ point }: paper.MouseEvent) => {
        const isLineToolState = state.matches('Sketch.Line tool 2')
        const isArcToolState = state.matches('Sketch.tangential arc to 2')

        if (isLineToolState) {
          sketchCanvasHelper.updateDraftLine(
            point,
            context.sketchPathToNode || []
          )
        } else if (isArcToolState) {
          sketchCanvasHelper.updateDraftArc(
            point,
            context.sketchPathToNode || []
          )
        }
      }

      paper.view.onClick = (a: paper.MouseEvent) => {
        if (state.matches('Sketch.Line tool 2')) {
          sketchCanvasHelper.addNewStraightSegment(
            context.sketchPathToNode || [],
            [a.point.x, -a.point.y]
          )
        } else if (state.matches('Sketch.tangential arc to 2')) {
          sketchCanvasHelper.addNewTangentialArcSegment(
            context.sketchPathToNode || [],
            [a.point.x, -a.point.y]
          )
        }
      }
    }
  }, [state, sketchCanvasHelper.draftLine])

  useEffect(() => {
    paper.setup(canvasRef?.current as any)

    paper.view.center = new paper.Point(0, 0)
    paper.view.zoom = paper.view.viewSize.height * 0.0117

    const setZoom = () => {
      console.log('setting zoom')
      const canvas = canvasRef.current
      if (canvas) {
        // Set the size of the canvas to fill its container
        const viewportWidth =
          window.innerWidth || document.documentElement.clientWidth
        const viewportHeight =
          window.innerHeight || document.documentElement.clientHeight
        canvas.width = viewportWidth
        canvas.height = viewportHeight

        // Update the size of the paper.js view to match the canvas
        paper.view.viewSize = new paper.Size(canvas.width, canvas.height)
        paper.view.center = new paper.Point(0, 0)

        // Adjust the zoom
        paper.view.zoom = paper.view.viewSize.height * 0.01165
      }
    }
    setZoom() // run once at the start

    window.addEventListener('resize', setZoom)
    return () => {
      window.removeEventListener('resize', setZoom)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      id="paper-canvas"
      className={`w-full h-full ${
        state.matches('Sketch')
          ? 'pointer-events-auto'
          : 'opacity-pointer-events-auto'
      }`}
    ></canvas>
  )
}
