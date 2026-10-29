import { DEBUG_SHOW_BOTH_SCENES } from '@src/clientSideScene/sceneUtils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useSingletons } from '@src/lib/boot'
import { useEffect, useState } from 'react'

export function useShouldHideScene(): {
  hideClient: boolean
  hideRender: boolean
} {
  const [isCamMoving, setIsCamMoving] = useState(false)
  const [isTween, setIsTween] = useState(false)

  const { state } = useModelingContext()
  const {
    kclManager: { sceneInfra },
  } = useSingletons()

  useEffect(() => {
    sceneInfra.camControls.setIsCamMovingCallback(
      (isMoving: boolean, isTweenValue: boolean) => {
        setIsCamMoving(isMoving)
        setIsTween(isTweenValue)
      }
    )
  }, [sceneInfra.camControls])

  // Local solids and sketches share a camera, so neither scene needs hiding.
  if (
    sceneInfra.localRenderer !== null ||
    DEBUG_SHOW_BOTH_SCENES ||
    !isCamMoving
  )
    return { hideClient: false, hideRender: false }
  const inSketchMode =
    state.matches('Sketch') || state.matches('sketchSolveMode')
  const hideRender = inSketchMode && !isTween

  // Hide the streamed solid during sketch drags, or the client overlay while
  // the engine owns the camera or catches up with a client-side animation.
  return { hideClient: !hideRender, hideRender }
}
