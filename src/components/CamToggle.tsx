import { useState, useEffect } from 'react'
import { sceneInfra } from '../clientSideScene/sceneInfra'
import { engineCommandManager } from 'lang/std/engineConnection'
import { throttle, isReducedMotion } from 'lib/utils'

const updateDollyZoom = throttle(
  (newFov: number) => sceneInfra.cameraControls.dollyZoom(newFov),
  1000 / 15
)

export const CamToggle = () => {
  const [isPerspective, setIsPerspective] = useState(true)
  const [fov, setFov] = useState(40)
  const [enableRotate, setEnableRotate] = useState(true)

  useEffect(() => {
    engineCommandManager.waitForReady.then(async () => {
      sceneInfra.cameraControls.dollyZoom(fov)
    })
  }, [])

  const toggleCamera = () => {
    if (isPerspective) {
      isReducedMotion()
        ? sceneInfra.cameraControls.useOrthographicCamera()
        : sceneInfra.cameraControls.animateToOrthographic()
    } else {
      isReducedMotion()
        ? sceneInfra.cameraControls.usePerspectiveCamera()
        : sceneInfra.cameraControls.animateToPerspective()
    }
    setIsPerspective(!isPerspective)
  }

  const handleFovChange = (newFov: number) => {
    setFov(newFov)
    updateDollyZoom(newFov)
  }

  return (
    <div className="absolute right-14 bottom-3">
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
            sceneInfra.cameraControls.enableRotate = false
          } else {
            sceneInfra.cameraControls.enableRotate = true
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
