import type { ComponentProps } from 'react'
import {
  ClientSideSceneView,
  CamDebugSettingsView,
} from '@src/clientSideScene/ClientSideSceneView'
import { useApp, useSingletons } from '@src/lib/boot'
import { useToolbarConfig } from '@src/hooks/useToolbarConfig'

/** The file route supplies app ownership; project Modeling views supply their own manager and command actor. */
export function ClientSideScene(
  props: Omit<ComponentProps<typeof ClientSideSceneView>, 'host'>
) {
  const { kclManager } = useSingletons()
  const { commands, settings } = useApp()
  const toolbarConfig = useToolbarConfig()
  return (
    <ClientSideSceneView
      {...props}
      host={{ kclManager, commands, settings, toolbarConfig }}
    />
  )
}

export function CamDebugSettings() {
  const { commands } = useApp()
  const { kclManager } = useSingletons()
  return (
    <CamDebugSettingsView
      commands={commands}
      sceneInfra={kclManager.sceneInfra}
    />
  )
}
