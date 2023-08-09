import {
  MouseEventHandler,
  WheelEventHandler,
  useEffect,
  useRef,
  useState,
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'
import { throttle } from '../lib/utils'
import { EngineCommand } from '../lang/std/engineConnection'
import { getNormalisedCoordinates } from '../lib/utils'

export const Stream = ({ className = '' }) => {
  const [zoom, setZoom] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const {
    mediaStream,
    engineCommandManager,
    setIsMouseDownInStream,
    fileId,
    setFileId,
    setCmdId,
    didDragInStream,
    setDidDragInStream,
    streamDimensions,
  } = useStore((s) => ({
    mediaStream: s.mediaStream,
    engineCommandManager: s.engineCommandManager,
    isMouseDownInStream: s.isMouseDownInStream,
    setIsMouseDownInStream: s.setIsMouseDownInStream,
    fileId: s.fileId,
    setFileId: s.setFileId,
    setCmdId: s.setCmdId,
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
    setFileId(uuidv4())
    setZoom(videoRef.current.getBoundingClientRect().height / 2)
  }, [mediaStream, engineCommandManager, setFileId])

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
    setCmdId(newId)

    const interaction = ctrlKey ? 'pan' : 'rotate'

    engineCommandManager?.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_start',
        interaction,
        window: { x, y },
      },
      cmd_id: newId,
      file_id: fileId,
    })

    setIsMouseDownInStream(true)
  }

  // TODO: consolidate this with the same function in App.tsx
  const debounceSocketSend = throttle<EngineCommand>((message) => {
    engineCommandManager?.sendSceneCommand(message)
  }, 16)

  const handleScroll: WheelEventHandler<HTMLVideoElement> = (e) => {
    e.preventDefault()
    debounceSocketSend({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_move',
        interaction: 'zoom',
        window: { x: 0, y: zoom + e.deltaY },
      },
      cmd_id: uuidv4(),
      file_id: uuidv4(),
    })

    setZoom(zoom + e.deltaY)
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
      file_id: fileId,
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
        file_id: fileId,
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
        onWheelCapture={handleScroll}
        className="w-full h-full"
      />
    </div>
  )
}
