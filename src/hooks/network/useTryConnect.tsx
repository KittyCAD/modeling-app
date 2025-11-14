import type { useAppState } from '@src/AppState'
import { EngineDebugger } from '@src/lib/debugger'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import type { SettingsViaQueryString } from '@src/lib/settings/settingsTypes'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import {
  codeManager,
  engineCommandManager,
  kclManager,
  rustContext,
  sceneInfra,
} from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { getDimensions } from '@src/network/utils'
import { useRef } from 'react'
import { NUMBER_OF_ENGINE_RETRIES } from '@src/lib/constants'

/**
 * Helper function, do not call this directly. Use tryConnecting instead.
 */
const attemptToConnectToEngine = async ({
  authToken,
  videoWrapperRef,
  setAppState,
  videoRef,
  setIsSceneReady,
  settingsEngine,
  timeToConnect,
}: {
  authToken: string
  videoWrapperRef: React.RefObject<HTMLDivElement>
  setAppState: (newAppState: Partial<ReturnType<typeof useAppState>>) => void
  videoRef: React.RefObject<HTMLVideoElement>
  setIsSceneReady: React.Dispatch<React.SetStateAction<boolean>>
  settingsEngine: SettingsViaQueryString
  timeToConnect: number
}) => {
  const connection = new Promise<boolean>((resolve, reject) => {
    const cancelTimeout = setTimeout(() => {
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

        await engineCommandManager.start({
          width,
          height,
          token: authToken,
          setStreamIsReady: () => {
            setAppState({ isStreamReady: true })
          },
          settings: settingsEngine,
        })

        if (!videoRef.current) {
          EngineDebugger.addLog({
            label: 'ConnectionStream.tsx',
            message: 'Unable to reference the video. Calling tearDown()',
          })
          engineCommandManager.tearDown()
          return reject('Unable to reference the video, calling tearDown()')
        }

        if (!engineCommandManager.connection?.mediaStream) {
          EngineDebugger.addLog({
            label: 'ConnectionStream.tsx',
            message: 'Unable to reference the mediaStream, calling tearDown()',
          })
          engineCommandManager.tearDown()
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
        return resolve(true)
      } catch (err) {
        clearTimeout(cancelTimeout)
        return reject(err)
      }
    })()
  })
  return connection
}

const setupSceneAndExecuteCodeAfterOpenedEngineConnection = async () => {
  const settings = await jsAppSettings()
  EngineDebugger.addLog({
    label: 'onEngineConnectionReadyForRequests',
    message: 'rustContext.clearSceneAndBustCache()',
    metadata: {
      jsAppSettings: settings,
      filePath: codeManager.currentFilePath || undefined,
    },
  })
  // Bust the cache always! A new connection has been made. The engine has no previous state
  await rustContext.clearSceneAndBustCache(
    settings,
    codeManager.currentFilePath || undefined
  )
  EngineDebugger.addLog({
    label: 'onEngineConnectionReadyForRequests',
    message: 'kclManager.executeCode()',
  })
  await kclManager.executeCode()
  // TODO: resolve the ~12 remaining dependent playwright tests on this functions isPlaywright() check
  // Once zoom to fit and view isometric work on empty scenes (only grid planes) we can improve the functions
  // business logic

  // This means you idled, otherwise you use the reset camera position
  if (sceneInfra.camControls.oldCameraState) {
    await sceneInfra.camControls.restoreRemoteCameraStateAndTriggerSync()
  } else {
    await resetCameraPosition()
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
async function tryConnecting({
  isConnecting,
  numberOfConnectionAttempts,
  authToken,
  videoWrapperRef,
  setAppState,
  videoRef,
  setIsSceneReady,
  timeToConnect,
  settings,
  setShowManualConnect,
}: {
  isConnecting: React.MutableRefObject<boolean>
  numberOfConnectionAttempts: React.MutableRefObject<number>
  authToken: string
  videoWrapperRef: React.RefObject<HTMLDivElement>
  setAppState: (newAppState: Partial<ReturnType<typeof useAppState>>) => void
  videoRef: React.RefObject<HTMLVideoElement>
  setIsSceneReady: React.Dispatch<React.SetStateAction<boolean>>
  timeToConnect: number
  settings: SettingsViaQueryString
  setShowManualConnect: React.Dispatch<React.SetStateAction<boolean>>
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

        try {
          // Has a time to connect window, if it does not connect, it will go to the next attempt
          await attemptToConnectToEngine({
            authToken: authToken,
            videoWrapperRef,
            setAppState,
            videoRef,
            setIsSceneReady,
            settingsEngine: settings,
            timeToConnect,
          })

          // Do not count the 30 second timer to connect within the kcl execution and scene setup
          await setupSceneAndExecuteCodeAfterOpenedEngineConnection()
          isConnecting.current = false
          setAppState({ isStreamAcceptingInput: true })
          numberOfConnectionAttempts.current = 0
          setShowManualConnect(false)
          EngineDebugger.addLog({
            label: 'tryConnecting',
            message: 'setAppState({ isStreamAcceptingInput: true })',
          })
          resolve('connected')
        } catch (e) {
          isConnecting.current = false
          setAppState({ isStreamAcceptingInput: false })
          EngineDebugger.addLog({
            label: 'useTryConnect.tsx',
            message: `Attempt ${numberOfConnectionAttempts.current}/${NUMBER_OF_ENGINE_RETRIES} failed, calling tearDown()`,
          })
          engineCommandManager.tearDown()
          // Fail after NUMBER_OF_ENGINE_RETRIES
          if (numberOfConnectionAttempts.current >= NUMBER_OF_ENGINE_RETRIES) {
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
  const isConnecting = useRef(false)
  const numberOfConnectionAttempts = useRef(0)

  return {
    tryConnecting,
    isConnecting,
    numberOfConnectionAttempts,
  }
}
