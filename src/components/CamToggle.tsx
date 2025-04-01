import { EngineCommandManagerEvents } from 'lang/std/engineConnection'
import { engineCommandManager, sceneInfra } from 'lib/singletons'
import { reportRejection } from 'lib/trap'
import { isReducedMotion, throttle } from 'lib/utils'
import { useEffect, useState } from 'react'

const updateDollyZoom = throttle(
  (newFov: number) => sceneInfra.camControls.dollyZoom(newFov),
  1000 / 15
)

export const CamToggle = () => {
  const [isPerspective, setIsPerspective] = useState(true)
  const [fov, setFov] = useState(40)
  const [enableRotate, setEnableRotate] = useState(true)

  useEffect(() => {
    engineCommandManager.addEventListener(
      EngineCommandManagerEvents.SceneReady,
      () => {
        sceneInfra.camControls.dollyZoom(fov).catch(reportRejection)
      }
    )
  }, [])

  const toggleCamera = () => {
    if (isPerspective) {
      isReducedMotion()
        ? sceneInfra.camControls.useOrthographicCamera()
        : sceneInfra.camControls.animateToOrthographic().catch(reportRejection)
    } else {
      isReducedMotion()
        ? sceneInfra.camControls.usePerspectiveCamera().catch(reportRejection)
        : sceneInfra.camControls.animateToPerspective().catch(reportRejection)
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
            sceneInfra.camControls.enableRotate = false
          } else {
            sceneInfra.camControls.enableRotate = true
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
