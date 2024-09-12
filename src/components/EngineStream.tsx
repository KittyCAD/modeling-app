import { MouseEventHandler, useEffect, useRef, useState, MutableRefObject } from 'react'
import { useAppState } from 'AppState'
import { createMachine, createActor, setup } from 'xstate'
import { createActorContext } from '@xstate/react'
import { getNormalisedCoordinates } from '../lib/utils'
import Loading from './Loading'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useModelingContext } from 'hooks/useModelingContext'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { ClientSideScene } from 'clientSideScene/ClientSideSceneComp'
import { btnName } from 'lib/cameraControls'
import { sendSelectEventToEngine } from 'lib/selections'
import { kclManager, engineCommandManager, sceneInfra } from 'lib/singletons'
import {
  EngineCommandManagerEvents,
  EngineConnectionStateType,
  DisconnectingType,
} from 'lang/std/engineConnection'
import { useRouteLoaderData } from 'react-router-dom'
import { PATHS } from 'lib/paths'
import { IndexLoaderData } from 'lib/types'
import useEngineStreamContext, { EngineStreamState, EngineStreamTransition, EngineStreamContext } from 'hooks/useEngineStreamContext'

export const EngineStream = () => {
  const [clickCoords, setClickCoords] = useState<{ x: number; y: number }>()
  const { setAppState } = useAppState()

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const { overallState } = useNetworkContext()
  const { auth, settings } = useSettingsAuthContext()

  const {
    state: modelingMachineState,
    send: modelingMachineActorSend,
    context: modelingMachineContext,
  } = useModelingContext()

  const engineStreamActor = useEngineStreamContext.useActorRef()
  const engineStreamState = engineStreamActor.getSnapshot()

  useEffect(() => {
    engineStreamActor.send({ type: EngineStreamTransition.SetContextProperty, value: { authToken: auth?.context?.token } } )
  }, [])

  useEffect(() => {
    engineStreamActor.send({ type: EngineStreamTransition.SetContextProperty, value: { videoRef } })
  }, [videoRef.current])

  useEffect(() => {
    engineStreamActor.send({ type: EngineStreamTransition.SetContextProperty, value: { canvasRef } })
  }, [canvasRef.current])

  useEffect(() => {
    let timestampNext: number | null = null
    let timestampLast: number | null = null
    let totalDelta: number = 0
    let needsResize = false

    // 0.25s is the average visual reaction time for humans so we'll go a bit more
    // so those exception people don't see.
    const REASONABLE_TIME_TO_REFRESH_STREAM_SIZE = 200

    const configure =  () => {
      engineStreamActor.send({ type: EngineStreamTransition.StartOrReconfigureEngine, modelingMachineActorSend, settings, setAppState })
    }

    // setTimeout is avoided here because there is no need to create and destroy
    // timers every 10 or so frames. It's a lot. Instead we track the time
    // between resize events and eventually fire the configure() function
    // which will resize the stream.
    const onResize = () => {
      timestampNext = Date.now()

      if (timestampLast) {
        totalDelta += timestampNext - timestampLast 
      }

      if (timestampLast && totalDelta > REASONABLE_TIME_TO_REFRESH_STREAM_SIZE && needsResize) {
        totalDelta = 0
        timestampLast = null
        needsResize = false
        configure()
      } else {
        window.requestAnimationFrame(() => {
          needsResize = true
        })
      }

      timestampLast = timestampNext
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [settings])

  const isNetworkOkay =
    overallState === NetworkHealthState.Ok ||
    overallState === NetworkHealthState.Weak

  const isLoading = engineStreamState.value === EngineStreamState.Resuming

  const handleMouseUp: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isNetworkOkay) return
    if (!videoRef.current) return

    modelingMachineActorSend({
      type: 'Set context',
      data: {
        buttonDownInStream: undefined,
      },
    })
    if (modelingMachineState.matches('Sketch')) return
    if (modelingMachineState.matches({ idle: 'showPlanes' })) return

    if (!modelingMachineContext.store?.didDragInStream && btnName(e).left) {
      sendSelectEventToEngine(
        e,
        videoRef.current,
        modelingMachineContext.store?.streamDimensions
      )
    }

    modelingMachineActorSend({
      type: 'Set context',
      data: {
        didDragInStream: false,
      },
    })
    setClickCoords(undefined)
  }

  const handleMouseDown: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isNetworkOkay) return
    if (!videoRef.current) return

    if (modelingMachineState.matches('Sketch')) return
    if (modelingMachineState.matches('Sketch no face')) return

    const { x, y } = getNormalisedCoordinates({
      clientX: e.clientX,
      clientY: e.clientY,
      el: videoRef.current,
      ...modelingMachineContext.store?.streamDimensions,
    })

    modelingMachineActorSend({
      type: 'Set context',
      data: {
        buttonDownInStream: e.button,
      },
    })

    setClickCoords({ x, y })
  }

  const handleMouseMove: MouseEventHandler<HTMLVideoElement> = (e) => {
    if (!isNetworkOkay) return
    if (!clickCoords) return
    if (modelingMachineState.matches('Sketch')) return
    if (modelingMachineState.matches('Sketch no face')) return

    const delta =
      ((clickCoords.x - e.clientX) ** 2 + (clickCoords.y - e.clientY) ** 2) **
      0.5
    if (delta > 5 && !modelingMachineContext.store?.didDragInStream) {
      modelingMachineActorSend({
        type: 'Set context',
        data: {
          didDragInStream: true,
        },
      })
    }
  }

  return (
    <div
      className="absolute inset-0 z-0"
      id="stream"
      data-testid="stream"
      onMouseUp={handleMouseUp}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => e.preventDefault()}
      onContextMenuCapture={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        controls={false}
        onMouseMoveCapture={handleMouseMove}
        className="w-full cursor-pointer h-full"
        disablePictureInPicture
        id="video-stream"
      />
      <canvas ref={canvasRef} className="w-full cursor-pointer h-full" id="freeze-frame">No canvas support</canvas>
      <ClientSideScene
        cameraControls={settings.context.modeling.mouseControls.current}
      />
      {(engineStreamState.value === EngineStreamState.Paused ||
        engineStreamState.value === EngineStreamState.Resuming) && (
        <div className="text-center absolute inset-0">
          <div
            className="flex flex-col items-center justify-center h-screen"
            data-testid="paused"
          >
            <div className="border-primary border p-2 rounded-sm">
              <svg
                width="8"
                height="12"
                viewBox="0 0 8 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M2 12V0H0V12H2ZM8 12V0H6V12H8Z"
                  fill="var(--primary)"
                />
              </svg>
            </div>
            <p className="text-base mt-2 text-primary bold">
              {engineStreamState.value === EngineStreamState.Paused && 'Paused'}
              {engineStreamState.value === EngineStreamState.Resuming && 'Resuming'}
            </p>
          </div>
        </div>
      )}
      {(!isNetworkOkay || isLoading) && (
        <div className="text-center absolute inset-0">
          <Loading>
            {!isNetworkOkay && !isLoading ? (
              <span data-testid="loading-stream">Stream disconnected...</span>
            ) : (
              !isLoading && (
                <span data-testid="loading-stream">Loading stream...</span>
              )
            )}
          </Loading>
        </div>
      )}
    </div>
)
}


