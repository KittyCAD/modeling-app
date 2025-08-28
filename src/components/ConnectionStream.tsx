import type { MouseEventHandler } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ClientSideScene } from '@src/clientSideScene/ClientSideSceneComp'
import {
  engineCommandManager,
  kclManager,
  useSettings,
} from '@src/lib/singletons'
import { ViewControlContextMenu } from '@src/components/ViewControlMenu'
import { sceneInfra } from '@src/lib/singletons'
import { btnName } from '@src/lib/cameraControls'
import { getDimensions } from '@src/network/utils'
import { trap } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import Loading from '@src/components/Loading'

let didInit = false

export const ConnectionStream = (props: {
  pool: string | null
  authToken: string | undefined
}) => {
  const [isSceneReady, setIsSceneReady] = useState(false)
  const settings = useSettings()
  const id = 'engine-stream'
  // These will be passed to the engineStreamActor to handle.
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // For attaching right-click menu events
  const videoWrapperRef = useRef<HTMLDivElement>(null)

  const handleMouseUp: MouseEventHandler<HTMLDivElement> = (e) => {
    console.log('handleMouseUp cached, no op')
  }
  const enterSketchModeIfSelectingSketch: MouseEventHandler<HTMLDivElement> = (
    e
  ) => {
    console.log('enterSketchModeIfSelectingSketch cached, no op')
  }

  // Run once on initialization
  useEffect(() => {
    // video wrapper ref
    if (!didInit) {
      didInit = true

      if (!props.authToken) {
        throw new Error('authToken is not ready. Good luck!')
      }

      if (videoWrapperRef.current) {
        const { width, height } = getDimensions(
          videoWrapperRef.current.clientWidth,
          videoWrapperRef.current.clientHeight
        )
        // TODO: Make sure pool works in the url.
        engineCommandManager
          .start({
            width,
            height,
            token: props.authToken,
          })
          .then(() => {
            if (!videoRef.current) {
              throw new Error('unable to reference the video ref. Good luck!')
            }

            if (!engineCommandManager.connection?.mediaStream) {
              throw new Error('unable to reference mediaStream. Good luck!')
            }

            videoRef.current.srcObject =
              engineCommandManager.connection?.mediaStream
            setIsSceneReady(true)
          })
          .then(() => {
            kclManager
              .executeCode()
              .catch(trap)
              .then(() =>
                // It makes sense to also call zoom to fit here, when a new file is
                // loaded for the first time, but not overtaking the work kevin did
                // so the camera isn't moving all the time.
                engineCommandManager.sendSceneCommand({
                  type: 'modeling_cmd_req',
                  cmd_id: uuidv4(),
                  cmd: {
                    type: 'zoom_to_fit',
                    object_ids: [], // leave empty to zoom to all objects
                    padding: 0.1, // padding around the objects
                    animated: false, // don't animate the zoom for now
                  },
                })
              )
              .catch(trap)
          })
      } else {
        throw new Error('DOM is not initialized for the stream. Good luck!')
      }
    }
  }, [])

  return (
    <div
      ref={videoWrapperRef}
      className="absolute inset-[-4px] z-0"
      id="stream"
      data-testid="stream"
      onMouseUp={handleMouseUp}
      onDoubleClick={enterSketchModeIfSelectingSketch}
      onContextMenu={(e) => e.preventDefault()}
      onContextMenuCapture={(e) => e.preventDefault()}
    >
      <video
        autoPlay
        muted
        key={id + 'video'}
        ref={videoRef}
        controls={false}
        className="w-full cursor-pointer h-full"
        disablePictureInPicture
        id="video-stream"
      />
      <canvas
        key={id + 'canvas'}
        ref={canvasRef}
        className="cursor-pointer"
        id="freeze-frame"
      >
        No canvas support
      </canvas>
      <ClientSideScene
        cameraControls={settings.modeling.mouseControls.current}
        enableTouchControls={settings.modeling.enableTouchControls.current}
      />
      <ViewControlContextMenu
        event="mouseup"
        guard={(e) =>
          sceneInfra.camControls.wasDragging === false &&
          btnName(e).right === true
        }
        menuTargetElement={videoWrapperRef}
      />
      {!isSceneReady && (
        <Loading
          isRetrying={false}
          retryAttemptCountdown={0}
          dataTestId="loading-engine"
          className="absolute inset-0 h-screen"
        >
          Connecting and setting up scene...
        </Loading>
      )}
    </div>
  )
}
