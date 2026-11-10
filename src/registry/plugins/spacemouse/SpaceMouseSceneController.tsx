import { useEffect, useRef } from 'react'

import { shouldLockViewControls } from '@src/components/viewControlMenuUtils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { reportRejection, trap } from '@src/lib/trap'
import {
  SpaceMouseController,
  activeSpaceMouseController,
} from './spaceMouseController'

export function SpaceMouseSceneController() {
  const {
    kclManager: { sceneInfra },
  } = useSingletons()
  const { state } = useModelingContext()
  const { settings } = useApp()
  const settingsValues = settings.useSettings()
  const rotationLocked = useRef(false)
  rotationLocked.current = shouldLockViewControls(
    state,
    settingsValues.app.allowOrbitInSketchMode.current
  )

  useEffect(() => {
    const controller = new SpaceMouseController(sceneInfra.camControls, {
      getBounds: () => sceneInfra.localRenderer?.getFitBounds(),
      getSelectionBounds: () => sceneInfra.localRenderer?.getSelectionBounds(),
      canRotate: () => !rotationLocked.current,
    })
    activeSpaceMouseController.value = controller
    controller
      .autoConnect()
      .then((result) => trap(result, { suppress: true }))
      .catch(reportRejection)

    return () => {
      if (activeSpaceMouseController.value === controller) {
        activeSpaceMouseController.value = null
      }
      controller.dispose()
    }
  }, [sceneInfra])

  return null
}
