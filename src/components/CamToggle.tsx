import { useState } from 'react'
import { sceneSingleton } from './clientSideScene'

export const CamToggle = () => {
  const [isPerspective, setIsPerspective] = useState(true)

  const toggleCamera = () => {
    if (isPerspective) {
      sceneSingleton.useOrthographicCamera()
    } else {
      sceneSingleton.usePerspectiveCamera()
    }
    setIsPerspective(!isPerspective)
  }

  return (
    <button onClick={toggleCamera} className="absolute right-14 bottom-3">
      {isPerspective
        ? 'Switch to Orthographic Camera'
        : 'Switch to Perspective Camera'}
    </button>
  )
}
