import { DEBUG_SHOW_BOTH_SCENES } from '@src/clientSideScene/sceneUtils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useSingletons } from '@src/lib/boot'
import { useEffect, useState } from 'react'

export function useShouldHideScene(): {
  hideClient: boolean
  hideRender: boolean
} {
  const [isCamMoving, setIsCamMoving] = useState(false)

  const { state } = useModelingContext()
  const {
    kclManager: { sceneInfra },
  } = useSingletons()

  useEffect(() => {
    sceneInfra.camControls.setIsCamMovingCallback(setIsCamMoving)
  }, [sceneInfra.camControls])

  // Local solids and sketches share a camera, so neither scene needs hiding.
  if (
    sceneInfra.localRenderer !== null ||
    DEBUG_SHOW_BOTH_SCENES ||
    !isCamMoving
  )
    return { hideClient: false, hideRender: false }
  const hideRender = state.matches('Sketch') || state.matches('sketchSolveMode')

  return { hideClient: !hideRender, hideRender }
}
