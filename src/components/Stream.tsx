import { MouseEventHandler, useEffect, useRef } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'
import { throttle } from '../lib/utils'
import { EngineCommand } from '../lang/std/engineConnection'

export const Stream = () => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const cmdId = useRef('')
  const { mediaStream, engineCommandManager } = useStore((s) => ({
    mediaStream: s.mediaStream,
    engineCommandManager: s.engineCommandManager,
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

  const file_id = uuidv4()

  const debounceSocketSend = throttle<EngineCommand>((message) => {
    engineCommandManager?.sendSceneCommand(message)
  }, 16)
  const handleMouseMove: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
    ctrlKey,
  }) => {
    if (!videoRef.current) return
    if (!cmdId.current) return
    const { left, top } = videoRef.current.getBoundingClientRect()
    const x = clientX - left
    const y = clientY - top
    const interaction = ctrlKey ? 'pan' : 'rotate'

    debounceSocketSend({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_move',
        interaction,
        window: {
          x,
          y,
        },
      },
      cmd_id: uuidv4(),
      file_id: file_id,
    })
  }

  const handleMouseDown: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
    ctrlKey,
  }) => {
    if (!videoRef.current) return
    const { left, top } = videoRef.current.getBoundingClientRect()
    const x = clientX - left
    const y = clientY - top
    console.log('click', x, y)

    const newId = uuidv4()
    cmdId.current = newId

    const interaction = ctrlKey ? 'pan' : 'rotate'

    engineCommandManager?.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_start',
        interaction,
        window: {
          x,
          y,
        },
      },
      cmd_id: newId,
      file_id,
    })
  }
  const handleMouseUp: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
    ctrlKey,
  }) => {
    if (!videoRef.current) return
    const { left, top } = videoRef.current.getBoundingClientRect()
    const x = clientX - left
    const y = clientY - top

    if (cmdId.current == null) {
      return
    }

    const interaction = ctrlKey ? 'pan' : 'rotate'

    engineCommandManager?.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_end',
        interaction,
        window: {
          x,
          y,
        },
      },
      cmd_id: uuidv4(),
      file_id: file_id,
    })
    cmdId.current = ''
  }

  return (
    <div id="stream">
      <PanelHeader title="Stream" />
      <video
        ref={videoRef}
        muted
        autoPlay
        controls={false}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onContextMenuCapture={(e) => e.preventDefault()}
      />
    </div>
  )
}
