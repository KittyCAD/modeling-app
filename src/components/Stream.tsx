import {
  MouseEventHandler,
  WheelEventHandler,
  useEffect,
  useRef,
  useState,
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'
import { getNormalisedCoordinates } from '../lib/utils'
import Loading from './Loading'

export const Stream = ({ className = '' }) => {
  const [isLoading, setIsLoading] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  const {
    mediaStream,
    engineCommandManager,
    setIsMouseDownInStream,
    didDragInStream,
    setDidDragInStream,
    streamDimensions,
  } = useStore((s) => ({
    mediaStream: s.mediaStream,
    engineCommandManager: s.engineCommandManager,
    isMouseDownInStream: s.isMouseDownInStream,
    setIsMouseDownInStream: s.setIsMouseDownInStream,
    fileId: s.fileId,
    didDragInStream: s.didDragInStream,
    setDidDragInStream: s.setDidDragInStream,
    streamDimensions: s.streamDimensions,
  }))

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined'
    )
      return
    if (!videoRef.current) return
    if (!mediaStream) return
    videoRef.current.srcObject = mediaStream
  }, [mediaStream, engineCommandManager])

  const handleMouseDown: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
    ctrlKey,
  }) => {
    if (!videoRef.current) return
    const { x, y } = getNormalisedCoordinates({
      clientX,
      clientY,
      el: videoRef.current,
      ...streamDimensions,
    })
    console.log('click', x, y)

    const newId = uuidv4()

    const interaction = ctrlKey ? 'pan' : 'rotate'

    engineCommandManager?.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_start',
        interaction,
        window: { x, y },
      },
      cmd_id: newId,
    })

    setIsMouseDownInStream(true)
  }

  const handleScroll: WheelEventHandler<HTMLVideoElement> = (e) => {
    e.preventDefault()
    engineCommandManager?.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'default_camera_zoom',
        magnitude: e.deltaY * 0.4,
      },
      cmd_id: uuidv4(),
    })
  }

  const handleMouseUp: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
    ctrlKey,
  }) => {
    if (!videoRef.current) return
    const { x, y } = getNormalisedCoordinates({
      clientX,
      clientY,
      el: videoRef.current,
      ...streamDimensions,
    })

    const newCmdId = uuidv4()
    const interaction = ctrlKey ? 'pan' : 'rotate'

    engineCommandManager?.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_end',
        interaction,
        window: { x, y },
      },
      cmd_id: newCmdId,
    })

    setIsMouseDownInStream(false)
    if (!didDragInStream) {
      engineCommandManager?.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'select_with_point',
          selection_type: 'add',
          selected_at_window: { x, y },
        },
        cmd_id: uuidv4(),
      })
    }
    setDidDragInStream(false)
  }

  return (
    <div id="stream" className={className}>
      <video
        ref={videoRef}
        muted
        autoPlay
        controls={false}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onContextMenuCapture={(e) => e.preventDefault()}
        onWheel={handleScroll}
        onPlay={() => setIsLoading(false)}
        className="w-full h-full"
      />
      {isLoading && (
        <div className="text-center absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <Loading>Loading stream...</Loading>
        </div>
      )}
    </div>
  )
}
