import type { Connection } from '@src/lib/engineConnection/connection'
import type { KclVersion } from '@rust/kcl-lib/bindings/KclVersion'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { getKclLanguageVersion } from '@src/lang/kclLanguageVersion'
import type { KclManager } from '@src/lang/KclManager'
import { useSingletons } from '@src/lib/boot'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { NUMBER_OF_ENGINE_RETRIES } from '@src/lib/constants'
import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { getDimensions } from '@src/lib/engineConnection/utils'
import { preflightEngineVideoCodecSupport } from '@src/lib/engineConnection/videoCodecSupport'
import { reapplyActiveViewAfterReconnect } from '@src/lib/kclNamedViewActivation'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import type RustContext from '@src/lib/rustContext'
import {
  getSettingsFromActorContext,
  jsAppSettings,
} from '@src/lib/settings/settingsUtils'
import { isErr, reportRejection } from '@src/lib/trap'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { useRef } from 'react'

/**
 * Helper function, do not call this directly. Use tryConnecting instead.
 */
const attemptToConnectToEngine = async ({
  authToken,
  videoWrapperRef,
  videoRef,
  setIsSceneReady,
  timeToConnect,
  engineCommandManager,
  kclVersion,
  rustContext,
  prepareForReconnect,
  onConnectionStarted,
}: {
  authToken: string
  videoWrapperRef: React.RefObject<HTMLDivElement | null>
  videoRef: React.RefObject<HTMLVideoElement | null>
  setIsSceneReady: React.Dispatch<React.SetStateAction<boolean>>
  timeToConnect: number
  engineCommandManager: ConnectionManager
  kclVersion?: KclVersion
  rustContext: RustContext
  onConnectionStarted: (connection: Connection | undefined) => void
  prepareForReconnect: (signal: AbortSignal) => Promise<undefined | Error>
}) => {
  const codecError = await preflightEngineVideoCodecSupport()
  if (codecError) {
    engineCommandManager.lastConnectionError = codecError
    void reportClientError({
      code: ClientErrorCode.EngineUnsupportedVideoCodec,
      error: codecError,
      dedupeKey: ClientErrorCode.EngineUnsupportedVideoCodec,
      extra: {
        browserVideoCodecs: codecError.browserCodecs,
        engineVideoCodecs: codecError.engineCodecs,
      },
    })
    return Promise.reject(codecError)
  }

  const connection = new Promise<Connection>((resolve, reject) => {
    let timedOut = false
    const cancelTimeout = setTimeout(() => {
      timedOut = true
      EngineDebugger.addLog({
        label: 'useTryConnect.tsx',
        message: 'Took too long to connect, cancelTimeout',
      })
      reject('took too long to connect, cancelTimeout')
    }, timeToConnect)

    void (async () => {
      try {
        if (!authToken) {
          return reject('authToken is missing on connection initialization')
        }
        if (engineCommandManager.started) {
          return reject('engine is already started. You cannot start again')
        }

        if (!videoWrapperRef.current) {
          return reject('DOM is not initialized for the stream')
        }

        const { width, height } = getDimensions(
          videoWrapperRef.current.clientWidth,
          videoWrapperRef.current.clientHeight
        )

        const starting = engineCommandManager.start({
          width,
          height,
          token: authToken,
          rustContext,
          kclVersion,
          prepareForReconnect,
        })
        const currentConnection = engineCommandManager.connection
        onConnectionStarted(currentConnection)
        await starting
        if (
          timedOut ||
          !currentConnection ||
          engineCommandManager.connection !== currentConnection
        ) {
          return reject(new Error('Connection attempt is no longer current'))
        }

        if (!videoRef.current) {
          EngineDebugger.addLog({
            label: 'ConnectionStream.tsx',
            message: 'Unable to reference the video. Calling tearDown()',
          })
          engineCommandManager.tearDown({
            route: 'connection-attempt-failed',
            initiatedBy: 'client',
          })
          return reject('Unable to reference the video, calling tearDown()')
        }

        if (!engineCommandManager.connection?.mediaStream) {
          EngineDebugger.addLog({
            label: 'ConnectionStream.tsx',
            message: 'Unable to reference the mediaStream, calling tearDown()',
          })
          engineCommandManager.tearDown({
            route: 'connection-attempt-failed',
            initiatedBy: 'client',
          })
          return reject(
            'Unable to reference the mediaStream, calling tearDown()'
          )
        }
        // Scene is ready, start firing events!
        videoRef.current.srcObject = engineCommandManager.connection.mediaStream
        setIsSceneReady(true)
        EngineDebugger.addLog({
          label: 'attemptToConnectToEngine',
          message: 'setIsSceneReady(true)',
        })
        clearTimeout(cancelTimeout)
        return resolve(currentConnection)
      } catch (err) {
        return reject(err)
      } finally {
        clearTimeout(cancelTimeout)
      }
    })()
  })
  return connection
}

const setupSceneAndExecuteCodeAfterOpenedEngineConnection = async ({
  connection,
  sceneInfra,
  settingsActor,
  engineCommandManager,
  kclManager,
  rustContext,
}: {
  connection: Connection
  sceneInfra: SceneInfra
  settingsActor: SettingsActorType
  engineCommandManager: ConnectionManager
  kclManager: KclManager
  rustContext: RustContext
}) => {
  if (engineCommandManager.connection !== connection) return
  const reconnectCameraState = sceneInfra.camControls.reconnectCameraState
  sceneInfra.camControls.reconnectCameraState = undefined
  if (!reconnectCameraState && sceneInfra.camControls.oldCameraState) {
    // Idle reconnects honor projection settings changed while disconnected.
    sceneInfra.camControls.overrideOldCameraStateToPreventDesync()
  }
  const cameraState =
    reconnectCameraState ?? sceneInfra.camControls.oldCameraState
  const providedSettings = getSettingsFromActorContext(settingsActor)
  const settings = jsAppSettings(providedSettings)
  EngineDebugger.addLog({
    label: 'onEngineConnectionReadyForRequests',
    message: 'rustContext.clearSceneAndBustCache()',
    metadata: {
      jsAppSettings: settings,
      filePath: kclManager.path || undefined,
    },
  })
  // Bust the cache always! A new connection has been made. The engine has no previous state
  await rustContext.clearSceneAndBustCache(
    settings,
    kclManager.path || undefined
  )
  if (engineCommandManager.connection !== connection) {
    return
  }
  if (cameraState) {
    // Restore both idle and requested reconnect cameras before rebuilding.
    await sceneInfra.camControls.setCameraView(cameraState)
    if (engineCommandManager.connection !== connection) {
      return
    }
  }
  EngineDebugger.addLog({
    label: 'onEngineConnectionReadyForRequests',
    message: 'kclManager.executeCode()',
  })
  // Rebuild from current source instead of replaying a queued execution from previous connection.
  kclManager.executeIsStale = null
  await kclManager.executeCode()
  // This prevents an old rebuild from restoring its camera onto a replacement connection.
  if (engineCommandManager.connection !== connection) {
    return
  }
  // TODO: resolve the ~12 remaining dependent playwright tests on this functions isPlaywright() check
  // Once zoom to fit and view isometric work on empty scenes (only grid planes) we can improve the functions
  // business logic

  // A named view outlives the connection that showed it, and the new connection
  // has neither its visibility nor its camera.
  const restoredNamedViewCamera = await reapplyActiveViewAfterReconnect(
    kclManager,
    { restoreCamera: cameraState === undefined }
  )

  if (engineCommandManager.connection !== connection) {
    return
  }

  if (!cameraState && !restoredNamedViewCamera) {
    await resetCameraPosition({
      sceneInfra,
      engineCommandManager,
      settingsActor,
    })
  }

  // Since you reconnected you are not idle, clear the old camera state
  sceneInfra.camControls.clearOldCameraState()
}

/**
 * Entry point for starting the connection process.
 * This has wrapper logic to ensure multiple attempts with a global time and reporting the state back to
 * react all happen.
 * For example
 *  - attempt N number of connection tries
 *  - global timeout of timeToConnect, if this is triggered stop trying to connect
 *  - report the state of the connection process back to connectionStream.tsx to display the correct DOM state
 *
 *
 * No part of the system should be trying to directly connect. This file wraps multiple levels of business logic and state management to provide
 * a single safe location to connect to the engine.
 */
export async function tryConnecting({
  abnormalCloseRetries,
  isConnecting,
  numberOfConnectionAttempts,
  authToken,
  videoWrapperRef,
  videoRef,
  setIsSceneReady,
  timeToConnect,
  settingsActor,
  setShowManualConnect,
  sceneInfra,
  engineCommandManager,
  kclManager,
  rustContext,
}: {
  abnormalCloseRetries: React.RefObject<number>
  isConnecting: React.RefObject<boolean>
  numberOfConnectionAttempts: React.RefObject<number>
  authToken: string
  videoWrapperRef: React.RefObject<HTMLDivElement | null>
  videoRef: React.RefObject<HTMLVideoElement | null>
  setIsSceneReady: React.Dispatch<React.SetStateAction<boolean>>
  timeToConnect: number
  settingsActor: SettingsActorType
  setShowManualConnect: React.Dispatch<React.SetStateAction<boolean>>
  sceneInfra: SceneInfra
  engineCommandManager: ConnectionManager
  kclManager: KclManager
  rustContext: RustContext
}) {
  const connection = new Promise<string>((resolve, reject) => {
    void (async () => {
      if (isConnecting.current) {
        return resolve('connecting')
      }

      isConnecting.current = true

      async function attempt() {
        numberOfConnectionAttempts.current =
          numberOfConnectionAttempts.current + 1

        let attemptConnection: Connection | undefined
        try {
          const instance = await rustContext.wasmInstancePromise
          const kclVersion = getKclLanguageVersion(kclManager.code, instance)
          // Has a time to connect window, if it does not connect, it will go to the next attempt
          const connected = await attemptToConnectToEngine({
            onConnectionStarted: (connection) => {
              attemptConnection = connection
            },
            authToken: authToken,
            videoWrapperRef,
            videoRef,
            setIsSceneReady,
            timeToConnect,
            engineCommandManager,
            // Invalid source can still connect; execution reports its diagnostics.
            kclVersion: isErr(kclVersion) ? undefined : kclVersion,
            rustContext,
            prepareForReconnect: (signal) =>
              sceneInfra.camControls.captureCameraForReconnect(signal),
          })

          // Do not count the 30 second timer to connect within the kcl execution and scene setup
          await setupSceneAndExecuteCodeAfterOpenedEngineConnection({
            connection: connected,
            sceneInfra,
            settingsActor,
            engineCommandManager,
            kclManager,
            rustContext,
          })

          if (!engineCommandManager.markStreamAcceptingInput(connected)) {
            if (engineCommandManager.connection) {
              isConnecting.current = false
              return resolve('superseded')
            }
            // eslint-disable-next-line suggest-no-throw/suggest-no-throw
            throw new Error(
              'engine disconnected before it finished the attempt'
            )
          }

          abnormalCloseRetries.current = 0
          isConnecting.current = false
          numberOfConnectionAttempts.current = 0
          setShowManualConnect(false)
          EngineDebugger.addLog({
            label: 'tryConnecting',
            message: 'Stream accepting input',
          })
          resolve('connected')
        } catch (e) {
          // A late failure must not tear down a replacement connection.
          if (
            attemptConnection &&
            engineCommandManager.connection &&
            engineCommandManager.connection !== attemptConnection
          ) {
            isConnecting.current = false
            return resolve('superseded')
          }
          const terminalConnectionError =
            engineCommandManager.lastConnectionError?.terminal === true
              ? engineCommandManager.lastConnectionError
              : undefined
          EngineDebugger.addLog({
            label: 'useTryConnect.tsx',
            message: `Attempt ${numberOfConnectionAttempts.current}/${NUMBER_OF_ENGINE_RETRIES} failed`,
            metadata: { terminalConnectionError },
          })
          if (terminalConnectionError) {
            isConnecting.current = false
            numberOfConnectionAttempts.current = 0
            setShowManualConnect(true)
            return reject(terminalConnectionError)
          }
          engineCommandManager.tearDown({
            route: 'connection-attempt-failed',
            initiatedBy: 'client',
          })
          if (numberOfConnectionAttempts.current >= NUMBER_OF_ENGINE_RETRIES) {
            isConnecting.current = false
            numberOfConnectionAttempts.current = 0
            return reject(e)
          }
          attempt().catch(reportRejection)
        }
      }
      await attempt()
    })()
  })
  return connection
}
export const useTryConnect = () => {
  const { kclManager } = useSingletons()
  const isConnecting = useRef(false)
  const numberOfConnectionAttempts = useRef(0)
  const abnormalCloseRetries = useRef(0)
  type TryConnectingArgs = Omit<
    Parameters<typeof tryConnecting>[0],
    | 'engineCommandManager'
    | 'kclManager'
    | 'rustContext'
    | 'abnormalCloseRetries'
  >

  return {
    tryConnecting: (args: TryConnectingArgs) =>
      tryConnecting({
        ...args,
        engineCommandManager: kclManager.engineCommandManager,
        kclManager,
        rustContext: kclManager.rustContext,
        abnormalCloseRetries,
      }),
    isConnecting,
    numberOfConnectionAttempts,
    abnormalCloseRetries,
  }
}
