import { useState, useEffect } from 'react'
import { setupSingleton } from '../clientSideScene/setup'
import { engineCommandManager } from 'lang/std/engineConnection'
import { throttle, isReducedMotion } from 'lib/utils'
import { cameraMouseDragGuards } from 'lib/cameraControls'

const updateDollyZoom = throttle(
  (newFov: number) => setupSingleton.dollyZoom(newFov),
  1000 / 15
)

export const CamToggle = () => {
  const [isPerspective, setIsPerspective] = useState(true)
  const [fov, setFov] = useState(40)
  const [enableRotate, setEnableRotate] = useState(true)
  const [useOnShapeControls, setUseOnShapeControls] = useState(false)

  useEffect(() => {
    engineCommandManager.waitForReady.then(async () => {
      setupSingleton.dollyZoom(fov)
    })
  }, [])

  const toggleCamera = () => {
    if (isPerspective) {
      isReducedMotion()
        ? setupSingleton.useOrthographicCamera()
        : setupSingleton.animateToOrthographic()
    } else {
      isReducedMotion()
        ? setupSingleton.usePerspectiveCamera()
        : setupSingleton.animateToPerspective()
    }
    setIsPerspective(!isPerspective)
  }

  const handleFovChange = (newFov: number) => {
    setFov(newFov)
    updateDollyZoom(newFov)
  }

  return (
    <div className="absolute right-14 bottom-3">
      <button
        onClick={() => {
          setupSingleton.setInteractionGuards(
            useOnShapeControls
              ? cameraMouseDragGuards.KittyCAD
              : cameraMouseDragGuards.OnShape
          )
          setUseOnShapeControls(!useOnShapeControls)
        }}
      >
        change to {useOnShapeControls ? 'KittyCAD' : 'OnShape'} controls
      </button>
      {isPerspective && (
        <div className="">
          <input
            type="range"
            min="4"
            max="90"
            step={0.5}
            value={fov}
            onChange={(e) => handleFovChange(Number(e.target.value))}
            className="w-full cursor-pointer pointer-events-auto"
          />
        </div>
      )}
      <button onClick={toggleCamera} className="">
        {isPerspective
          ? 'Switch to Orthographic Camera'
          : 'Switch to Perspective Camera'}
      </button>
      <button
        onClick={() => {
          if (enableRotate) {
            setupSingleton.controls.enableRotate = false
          } else {
            setupSingleton.controls.enableRotate = true
          }
          setEnableRotate(!enableRotate)
        }}
        className=""
      >
        {enableRotate ? 'Disable Rotation' : 'Enable Rotation'}
      </button>
    </div>
  )
}
