import { useEffect, useRef } from 'react'
import { Scene, Vector2, WebGLRenderer } from 'three'

import {
  ScaleGridRenderer,
  type ScaleGridOptions,
} from '@src/clientSideScene/ScaleGridRenderer'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

interface InfiniteScaleGridProps extends ScaleGridOptions {
  sceneInfra: SceneInfra
}

/**
 * A local overlay for the streamed 3D viewport. The video has no depth channel,
 * so this first integration cannot occlude grid lines behind streamed solids.
 */
export function InfiniteScaleGrid({
  sceneInfra,
  majorGridSpacing,
  minorGridsPerMajor,
  fixedSizeGrid,
  isLightTheme,
}: InfiniteScaleGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setClearColor(0, 0)
    const scene = new Scene()
    const grid = new ScaleGridRenderer()
    scene.add(grid)
    const viewportSize = new Vector2()
    let frame: number | undefined

    const render = () => {
      frame = undefined
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.setSize(width, height, false)
      renderer.getDrawingBufferSize(viewportSize)
      grid.updateScaleGrid(
        sceneInfra.camControls.camera,
        [viewportSize.x, viewportSize.y],
        sceneInfra.baseUnitMultiplier,
        { majorGridSpacing, minorGridsPerMajor, fixedSizeGrid, isLightTheme }
      )
      renderer.render(scene, sceneInfra.camControls.camera)
    }
    const scheduleRender = () => {
      if (frame === undefined) frame = requestAnimationFrame(render)
    }
    const observer = new ResizeObserver(scheduleRender)
    observer.observe(canvas)
    const removeCameraListener =
      sceneInfra.camControls.cameraChange.add(scheduleRender)
    const removeUnitListener = sceneInfra.baseUnitChange.add(scheduleRender)
    scheduleRender()

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer.disconnect()
      removeCameraListener()
      removeUnitListener()
      grid.geometry.dispose()
      grid.material.dispose()
      renderer.dispose()
    }
  }, [
    sceneInfra,
    majorGridSpacing,
    minorGridsPerMajor,
    fixedSizeGrid,
    isLightTheme,
  ])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="infinite-scale-grid"
      className="absolute inset-0 h-full w-full pointer-events-none"
    />
  )
}
