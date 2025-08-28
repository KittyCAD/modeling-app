import { EngineDebugger } from '@src/lib/debugger'
import type {
  IEventListenerTracked,
  NewTrackArgs,
  UnreliableResponses,
} from './utils'
import {
  EngineCommandManagerEvents,
  EngineConnectionEvents,
  isHighlightSetEntity_type,
} from './utils'
import type RustContext from '@src/lib/rustContext'
import type { DeepPartial } from '@src/lib/types'
import type { Configuration } from '@src/lang/wasm'
import type { SettingsViaQueryString } from '@src/lib/settings/settingsTypes'
import { uuidv4 } from '@src/lib/utils'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import type { Models } from '@kittycad/lib/dist/types/src'
import { Themes } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Connection } from './connection'

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
      console.warn('KEVIN1')
      await rustContext.clearSceneAndBustCache(jsAppSettings, path)
      console.warn('KEVIN2')
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

    console.warn('SCENE IS READY!')
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

export const createOnEngineConnectionClosed = () => {
  const onEngineConnectionClosed = () => {
    EngineDebugger.addLog({
      label: 'onEngineConnectionClosed',
      message: 'stream is not ready. closing.',
    })
  }
  return onEngineConnectionClosed
}

export const createOnEngineConnectionStarted = ({
  peerConnection,
  getUnreliableSubscriptions,
  setInSequence,
  getInSequence,
  websocket,
  handleMessage,
  connection,
  trackListener,
}: {
  peerConnection: RTCPeerConnection
  getUnreliableSubscriptions: () => {
    [event: string]: {
      [localUnsubscribeId: string]: (a: any) => void
    }
  }
  setInSequence: (sequence: number) => void
  getInSequence: () => number
  websocket: WebSocket
  handleMessage: (event: MessageEvent) => void
  connection: Connection
  trackListener: (
    name: string,
    eventListenerTracked: IEventListenerTracked
  ) => void
}) => {
  console.warn('THIS RUNS')
  // TODO: connection.ts may not send the detail: connection back within this event handler.
  // Do not use the detail: connection yet, use the one from the connectionManager
  // This is the second datachannel initialized on the peerConnection. One is already
  // attached when the createWebsocket() workflow is triggered before this code.
  const onEngineConnectionStarted = () => {
    // When the EngineConnection starts a connection, we want to register
    // callbacks into the WebSocket/PeerConnection.
    EngineDebugger.addLog({
      label: 'onEngineConnectionStarted',
      message: 'adding datachannel on peerConnection',
    })

    const onDataChannel = (event: RTCDataChannelEvent) => {
      const unreliableDataChannel = event.channel

      EngineDebugger.addLog({
        label: 'onEngineConnectionStarted',
        message: 'adding message on unreliableDataChannel',
      })

      // TODO: This event listener would need to be cleaned up if the connection is destroyed
      unreliableDataChannel.addEventListener(
        'message',
        (event: MessageEvent) => {
          const result: UnreliableResponses = JSON.parse(event.data)
          Object.values(
            getUnreliableSubscriptions()[result.type] || {}
          ).forEach((callback) => {
            // TODO: There is only one response that uses the unreliable channel atm,
            // highlight_set_entity, if there are more it's likely they will all have the same
            // sequence logic, but I'm not sure if we use a single global sequence or a sequence
            // per unreliable subscription.
            const data = result.data
            if (isHighlightSetEntity_type(data)) {
              if (
                data.sequence !== undefined &&
                data.sequence > getInSequence()
              ) {
                setInSequence(data.sequence)
                callback(result)
              }
            }
          })
        }
      )
    }
    trackListener('datachannel', {
      event: 'datachannel',
      callback: onDataChannel,
      type: 'peerConnection',
    })
    // TODO: This event listener would need to be cleaned up if the connection is destroyed
    peerConnection.addEventListener('datachannel', onDataChannel)

    EngineDebugger.addLog({
      label: 'onEngineConnectionStarted',
      message: 'adding message on websocket',
    })

    const onMessage = (event: MessageEvent) => {
      handleMessage(event)
    }
    trackListener('message', {
      event: 'message',
      callback: onMessage,
      type: 'websocket',
    })
    websocket.addEventListener('message', onMessage)

    const onVideoTrackMute = () => {
      console.warn('video track mute - potentially lost stream for a moment')
      EngineDebugger.addLog({
        label: 'onVideoTrackMute',
        message: 'video track mute - potentially lost stream for a moment',
      })
    }

    // Gotcha: Why are we adding a new NewTrack listener again? It is already on the peerConnection
    const onEngineConnectionNewTrack = ({
      detail: { mediaStream },
    }: CustomEvent<NewTrackArgs>) => {
      // TODO: Adding an event listener that is not properly cleaned up.
      EngineDebugger.addLog({
        label: 'onEngineConnectionNewTrack',
        message: 'adding mute on mediaStream.getVideoTracks()[0]',
      })
      mediaStream.getVideoTracks()[0].addEventListener('mute', onVideoTrackMute)
      if (!mediaStream) {
        throw new Error('no media stream found, this is bad.')
      }
    }

    trackListener(EngineConnectionEvents.NewTrack, {
      event: EngineConnectionEvents.NewTrack,
      callback: onEngineConnectionNewTrack,
      type: 'connection',
    })
    // Yikes, thanks for the massive class interface as EventListener it is
    connection.addEventListener(
      EngineConnectionEvents.NewTrack,
      onEngineConnectionNewTrack as EventListener
    )
    // Start listening!
    // TODO: Load bearing entry point!
    // TODO: THIS HAS TO BE WRONG WHAT?? it is a catch 22
    // connection.connect()
  }
  // TODO: Multiple event listeners on dependencies of member variables are not cleaned up
  return onEngineConnectionStarted
}
