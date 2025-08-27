import { EngineDebugger } from '@src/lib/debugger'
import { EngineCommandManagerEvents } from './utils'
import type RustContext from '@src/lib/rustContext'
import { DeepPartial } from '@src/lib/types'
import { Configuration } from '@src/lang/wasm'
import { SettingsViaQueryString } from '@src/lib/settings/settingsTypes'
import { uuidv4 } from '@src/lib/utils'
import { EngineCommand } from '@src/lang/std/artifactGraph'
import { Models } from '@kittycad/lib/dist/types/src'
import { Themes } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { Connection } from './connection'

export const createOnEngineConnectionRestartRequest = ({
  dispatchEvent,
}: {
  dispatchEvent: (event: Event) => boolean
}) => {
  const onEngineConnectionRestartRequest = () => {
    dispatchEvent(
      new CustomEvent(EngineCommandManagerEvents.EngineRestartRequest)
    )
  }
  return onEngineConnectionRestartRequest
}

export const createOnEngineOffline = ({
  dispatchEvent,
}: { dispatchEvent: (event: Event) => boolean }) => {
  const onEngineOffline = () => {
    dispatchEvent(new CustomEvent(EngineCommandManagerEvents.Offline))
  }
  return onEngineOffline
}

// TODO: Why settings and jsAppSettings?
export const createOnEngineConnectionOpened = ({
  rustContext,
  settings,
  jsAppSettings,
  path,
  sendSceneCommand,
  setTheme,
  listenToDarkModeMatcher,
  camControlsCameraChange,
  sceneInfra,
  connection,
}: {
  rustContext: RustContext
  settings: SettingsViaQueryString
  jsAppSettings: DeepPartial<Configuration>
  path: string
  sendSceneCommand: (
    command: EngineCommand,
    forceWebsocket?: boolean
  ) => Promise<
    Models['WebSocketResponse_type'] | [Models['WebSocketResponse_type']] | null
  >
  setTheme: (theme: Themes) => Promise<void>
  listenToDarkModeMatcher: () => void
  camControlsCameraChange: () => void
  sceneInfra: SceneInfra
  connection: Connection
}) => {
  const onEngineConnectionOpened = async () => {
    try {
      EngineDebugger.addLog({
        label: 'onEngineConnectionOpened',
        message: 'clearing scene and busting cache',
      })
      await rustContext.clearSceneAndBustCache(jsAppSettings, path)
    } catch (e) {
      console.warn('unknown error in onEngineConnectionOpened:', e)
      EngineDebugger.addLog({
        label: 'onEngineConnectionOpened',
        message: 'error',
        metadata: { e },
      })
    }

    // Set the stream's camera projection type
    // We don't send a command to the engine if in perspective mode because
    // for now it's the engine's default.
    if (settings.cameraProjection === 'orthographic') {
      EngineDebugger.addLog({
        label: 'onEngineConnectionOpened',
        message: 'Setting camera to orthographic',
      })
      await sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_set_orthographic',
        },
      })
    }

    EngineDebugger.addLog({
      label: 'onEngineConnectionOpened',
      message: 'setting theme',
      metadata: {
        theme: settings.theme,
      },
    })
    await setTheme(settings.theme)
    // External dependency that we attach an event listener for 'change'
    listenToDarkModeMatcher()

    EngineDebugger.addLog({
      label: 'onEngineConnectionOpened',
      message: 'setting_edge_lines_visible',
      metadata: {
        hidden: !settings.highlightEdges,
      },
    })
    await sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'edge_lines_visible' as any, // TODO: update kittycad.ts to use the correct type
        hidden: !settings.highlightEdges,
      },
    })

    EngineDebugger.addLog({
      label: 'onEngineConnectionOpened',
      message: 'camControlsCameraChange',
    })
    camControlsCameraChange()
    EngineDebugger.addLog({
      label: 'onEngineConnectionOpened',
      message: 'restoreRemoteCameraStateAndTriggerSync',
    })
    await sceneInfra.camControls.restoreRemoteCameraStateAndTriggerSync()
    // TODO: setIsStreamReady()
    EngineDebugger.addLog({
      label: 'onEngineConnectionOpened',
      message: 'Dispatching SceneReady',
    })

    dispatchEvent(
      new CustomEvent(EngineCommandManagerEvents.SceneReady, {
        detail: connection,
      })
    )
  }
  return onEngineConnectionOpened
}

export const createOnDarkThemeMediaQueryChange = ({
  setTheme,
}: { setTheme: (theme: Themes) => Promise<void> }) => {
  const onDarkThemeMediaQueryChange = (e: MediaQueryListEvent) => {
    setTheme(e.matches ? Themes.Dark : Themes.Light).catch(reportRejection)
  }
  return onDarkThemeMediaQueryChange
}

export const onEngineConnectionStarted = () => {
  const onEngineConnectionStarted = () => {}
  return onEngineConnectionStarted
}
