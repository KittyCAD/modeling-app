import type { useAppState } from '@src/AppState'
import { EngineDebugger } from '@src/lib/debugger'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import {
  codeManager,
  engineCommandManager,
  kclManager,
  rustContext,
} from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import { getDimensions } from '@src/network/utils'
import { useRef } from 'react'

const NumberOfEngineRetries = 5

const attemptToConnectToEngine = async ({
  authToken,
  videoWrapperRef,
  setAppState,
  videoRef,
  setIsSceneReady,
}: {
  authToken: string
  videoWrapperRef: React.RefObject<HTMLDivElement>
  setAppState: (newAppState: Partial<ReturnType<typeof useAppState>>) => void
  videoRef: React.RefObject<HTMLVideoElement>
  setIsSceneReady: React.Dispatch<React.SetStateAction<boolean>>
}) => {
  const connection = new Promise<boolean>((resolve, reject) => {
    void (async () => {
      try {
        if (!authToken) {
          return reject('authToken is missing on connection initialilzation')
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
        })

        if (!videoRef.current) {
          EngineDebugger.addLog({
            label: 'ConnectionStream.tsx',
            message: 'Unable to reference the video',
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
        await engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'zoom_to_fit',
            object_ids: [], // leave empty to zoom to all objects
            padding: 0.1, // padding around the objects
            animated: false, // don't animate the zoom for now
          },
        })
        return resolve(true)
      } catch (err) {
        return reject(err)
      }
    })()
  })
  return connection
}

async function tryConnecting({
  isConnecting,
  successfullyConnected,
  numberOfConnectionAtttempts,
  authToken,
  videoWrapperRef,
  setAppState,
  videoRef,
  setIsSceneReady,
  timeToConnect,
}: {
  isConnecting: React.MutableRefObject<boolean>
  successfullyConnected: React.MutableRefObject<boolean>
  numberOfConnectionAtttempts: React.MutableRefObject<number>
  authToken: string
  videoWrapperRef: React.RefObject<HTMLDivElement>
  setAppState: (newAppState: Partial<ReturnType<typeof useAppState>>) => void
  videoRef: React.RefObject<HTMLVideoElement>
  setIsSceneReady: React.Dispatch<React.SetStateAction<boolean>>
  timeToConnect: number
}) {
  const connection = new Promise<string>((resolve, reject) => {
    void (async () => {
      if (isConnecting.current) {
        return resolve('connecting')
      }

      isConnecting.current = true
      async function attempt() {
        const throwTimeoutError = () => {
          // I want to throw to reject the attempt function to go into the catch block from within the timeout.
          // eslint-disable-next-line suggest-no-throw/suggest-no-throw
          throw new Error('attempt took too long')
        }

        numberOfConnectionAtttempts.current =
          numberOfConnectionAtttempts.current + 1

        const cancelTimeout = setTimeout(() => {
          isConnecting.current = false
          successfullyConnected.current = false
          engineCommandManager.tearDown()
          throwTimeoutError()
        }, timeToConnect)

        try {
          await attemptToConnectToEngine({
            authToken: authToken,
            videoWrapperRef,
            setAppState,
            videoRef,
            setIsSceneReady,
          })
          clearInterval(cancelTimeout)
          isConnecting.current = false
          successfullyConnected.current = true
          numberOfConnectionAtttempts.current = 0
          resolve('connected')
        } catch (e) {
          clearInterval(cancelTimeout)
          isConnecting.current = false
          successfullyConnected.current = false
          engineCommandManager.tearDown()
          // Fail after 5 attempts
          if (numberOfConnectionAtttempts.current >= NumberOfEngineRetries) {
            numberOfConnectionAtttempts.current = 0
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
  // What about offline? the dispatch event.
  const isConnecting = useRef(false)
  const successfullyConnected = useRef(false)
  const numberOfConnectionAtttempts = useRef(0)

  return {
    tryConnecting,
    isConnecting,
    successfullyConnected,
    numberOfConnectionAtttempts,
  }
}
