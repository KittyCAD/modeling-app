import { MouseEventHandler, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'
import { getNormalisedCoordinates } from '../lib/utils'
import Loading from './Loading'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { Models } from '@kittycad/lib'
import { engineCommandManager } from '../lang/std/engineConnection'
import { useModelingContext } from 'hooks/useModelingContext'
import { useKclContext } from 'lang/KclSingleton'
import { ClientSideScene } from 'clientSideScene/ClientSideSceneComp'
import { NetworkHealthState, useNetworkStatus } from './NetworkHealthIndicator'

export const Stream = ({ className = '' }: { className?: string }) => {
  const [isLoading, setIsLoading] = useState(true)
  const [clickCoords, setClickCoords] = useState<{ x: number; y: number }>()
  const videoRef = useRef<HTMLVideoElement>(null)
  const {
    mediaStream,
    setButtonDownInStream,
    didDragInStream,
    setDidDragInStream,
    streamDimensions,
  } = useStore((s) => ({
    mediaStream: s.mediaStream,
    setButtonDownInStream: s.setButtonDownInStream,
    didDragInStream: s.didDragInStream,
    setDidDragInStream: s.setDidDragInStream,
    streamDimensions: s.streamDimensions,
  }))
  const { settings } = useGlobalStateContext()
  const { state } = useModelingContext()
  const { isExecuting } = useKclContext()
  const { overallState } = useNetworkStatus()
  const isNetworkOkay = overallState === NetworkHealthState.Ok

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined'
    )
      return
    if (!videoRef.current) return
    if (!mediaStream) return
    videoRef.current.srcObject = mediaStream
  }, [mediaStream])

  const handleMouseDown: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!videoRef.current) return
    if (state.matches('Sketch')) return
    if (state.matches('Sketch no face')) return
    const { x, y } = getNormalisedCoordinates({
      clientX: e.clientX,
      clientY: e.clientY,
      el: videoRef.current,
      ...streamDimensions,
    })

    setButtonDownInStream(e.button)
    setClickCoords({ x, y })
  }

  const handleMouseUp: MouseEventHandler<HTMLDivElement> = ({
    clientX,
    clientY,
    ctrlKey,
  }) => {
    if (!videoRef.current) return
    setButtonDownInStream(undefined)
    if (state.matches('Sketch')) return
    if (state.matches('Sketch no face')) return
    const { x, y } = getNormalisedCoordinates({
      clientX,
      clientY,
      el: videoRef.current,
      ...streamDimensions,
    })

    const newCmdId = uuidv4()
    const interaction = ctrlKey ? 'pan' : 'rotate'

    const command: Models['WebSocketRequest_type'] = {
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_end',
        interaction,
        window: { x, y },
      },
      cmd_id: newCmdId,
    }

    if (!didDragInStream) {
      command.cmd = {
        type: 'select_with_point',
        selected_at_window: { x, y },
        selection_type: 'add',
      }
      engineCommandManager.sendSceneCommand(command)
    } else if (didDragInStream) {
      command.cmd = {
        type: 'handle_mouse_drag_end',
        window: { x, y },
      }
      void engineCommandManager.sendSceneCommand(command)
    } else {
      engineCommandManager.sendSceneCommand(command)
    }

    setDidDragInStream(false)
    setClickCoords(undefined)
  }

  const handleMouseMove: MouseEventHandler<HTMLVideoElement> = (e) => {
    if (state.matches('Sketch')) return
    if (state.matches('Sketch no face')) return
    if (!clickCoords) return

    const delta =
      ((clickCoords.x - e.clientX) ** 2 + (clickCoords.y - e.clientY) ** 2) **
      0.5

    if (delta > 5 && !didDragInStream) {
      setDidDragInStream(true)
    }
  }

  return (
    <div
      id="stream"
      className={className}
      onMouseUp={handleMouseUp}
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => e.preventDefault()}
      onContextMenuCapture={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        muted
        autoPlay
        controls={false}
        onPlay={() => setIsLoading(false)}
        onMouseMoveCapture={handleMouseMove}
        className={`w-full cursor-pointer h-full ${isExecuting && 'blur-md'}`}
        disablePictureInPicture
        style={{ transitionDuration: '200ms', transitionProperty: 'filter' }}
      />
      <ClientSideScene cameraControls={settings.context.cameraControls} />
      {!isNetworkOkay && !isLoading && (
        <div className="text-center absolute inset-0">
          <Loading>
            <span data-testid="loading-stream">Stream disconnected</span>
          </Loading>
        </div>
      )}
      {isLoading && (
        <div className="text-center absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <Loading>
            <span data-testid="loading-stream">Loading stream...</span>
          </Loading>
        </div>
      )}
    </div>
  )
}
