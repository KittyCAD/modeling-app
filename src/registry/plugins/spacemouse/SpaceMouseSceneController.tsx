import { useEffect } from 'react'

import { useSingletons } from '@src/lib/boot'
import {
  SpaceMouseController,
  logSpaceMouse,
  setActiveSpaceMouseController,
} from './spaceMouseController'

export function SpaceMouseSceneController() {
  const {
    kclManager: { sceneInfra },
  } = useSingletons()

  useEffect(() => {
    logSpaceMouse('info', 'plugin scene controller mounted')
    const spaceMouseController = new SpaceMouseController(
      sceneInfra.camControls
    )
    setActiveSpaceMouseController(spaceMouseController)

    return () => {
      logSpaceMouse('info', 'plugin scene controller unmounted')
      setActiveSpaceMouseController(null)
      spaceMouseController.dispose()
    }
  }, [sceneInfra.camControls])

  return null
}
