import type { ComponentProps } from 'react'
import {
  ClientSideSceneView,
  CamDebugSettingsView,
} from '@src/clientSideScene/ClientSideSceneView'
import { useApp, useSingletons } from '@src/lib/boot'
import { useToolbarConfig } from '@src/hooks/useToolbarConfig'

/** Supplies the file route's manager, settings, commands, and toolbar configuration to the shared scene view. */
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
