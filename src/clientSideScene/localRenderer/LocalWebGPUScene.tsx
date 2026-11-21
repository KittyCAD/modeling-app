import type { LocalRendererProps } from '@src/clientSideScene/localRenderer/LocalRenderer'
import { LocalWebGPUSceneView } from '@src/clientSideScene/localRenderer/LocalWebGPUSceneView'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { legacyLocalRendererHost } from '@src/clientSideScene/localRenderer/legacyHost'
import { useApp, useSingletons } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import { useCallback, useMemo } from 'react'
import { waitFor } from 'xstate'

export const LocalWebGPUScene = (props: LocalRendererProps) => {
  const { kclManager } = useSingletons()
  const host = useMemo(() => legacyLocalRendererHost(kclManager), [kclManager])
  const { settings } = useApp()
  const { state } = useModelingContext()

  // The engine session is chosen when the scene mounts, so streaming needs a reload.
  const switchToStreaming = useCallback(() => {
    settings.send({
      type: 'set.modeling.useLocalRenderer',
      data: { level: 'user', value: false },
    })
    // Reloading before the change is saved would start with the old value.
    waitFor(settings.actor, (snapshot) => snapshot.matches('idle'))
      .then(() => window.location.reload())
      .catch(reportRejection)
  }, [settings])

  return (
    <LocalWebGPUSceneView
      {...props}
      host={host}
      onSwitchToStreaming={switchToStreaming}
      pickingEnabled={state.matches('idle') || state.matches('Sketch no face')}
      defaultPlaneVisibility={state.context.defaultPlaneVisibility}
    />
  )
}
