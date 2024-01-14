import { useState, useEffect, useRef } from 'react'
import { sceneSingleton } from './ClientSideScene'
import { engineCommandManager } from 'lang/std/engineConnection'
import { throttle } from 'lib/utils'

const updateDollyZoom = throttle(
  (newFov: number) => sceneSingleton.dollyZoom(newFov),
  1000 / 15
)

export const CamToggle = () => {
  const [isPerspective, setIsPerspective] = useState(true)
  const [fov, setFov] = useState(12)

  useEffect(() => {
    engineCommandManager.waitForReady.then(async () => {
      sceneSingleton.dollyZoom(fov)
    })
  }, [])

  const toggleCamera = () => {
    if (isPerspective) {
      sceneSingleton.useOrthographicCamera()
    } else {
      sceneSingleton.usePerspectiveCamera()
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
            step={1}
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
    </div>
  )
}
