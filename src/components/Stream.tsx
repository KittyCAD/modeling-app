import { MouseEventHandler, useEffect, useRef, useState } from 'react'
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
  const [isMouseDown, setIsMouseDown] = useState(false)
  const [didDrag, setDidDrag] = useState(false)

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

    if (isMouseDown) {
      setDidDrag(true)
    }
    const { x, y } = getNormalisedCoordinates(
      clientX,
      clientY,
      videoRef.current
    )
    const interaction = ctrlKey ? 'pan' : 'rotate'

    if (cmdId.current) {
      debounceSocketSend({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'camera_drag_move',
          interaction,
          window: { x, y },
        },
        cmd_id: uuidv4(),
        file_id: file_id,
      })
    } else {
      debounceSocketSend({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'highlight_set_entity',
          selected_at_window: { x, y },
        },
        cmd_id: uuidv4(),
        file_id: file_id,
      })
    }
  }

  const handleMouseDown: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
    ctrlKey,
  }) => {
    if (!videoRef.current) return
    setIsMouseDown(true)
    const { x, y } = getNormalisedCoordinates(
      clientX,
      clientY,
      videoRef.current
    )

    const newId = uuidv4()
    cmdId.current = newId

    const interaction = ctrlKey ? 'pan' : 'rotate'

    engineCommandManager?.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_start',
        interaction,
        window: { x, y },
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
    setIsMouseDown(false)
    const { x, y } = getNormalisedCoordinates(
      clientX,
      clientY,
      videoRef.current
    )

    if (cmdId.current == null) {
      return
    }

    if (!didDrag) {
      engineCommandManager?.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'select_with_point',
          selection_type: 'add',
          selected_at_window: { x, y },
        },
        cmd_id: uuidv4(),
        file_id: file_id,
      })
    }
    setDidDrag(false)

    const interaction = ctrlKey ? 'pan' : 'rotate'

    engineCommandManager?.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_end',
        interaction,
        window: { x, y },
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

function getNormalisedCoordinates(
  clientX: number,
  clientY: number,
  el: HTMLVideoElement
) {
  // TODO: update this when we have dynamic stream resolution
  const STREAMWIDTH = 1280
  const STREAMHEIGHT = 720

  const { left, top, width, height } = el.getBoundingClientRect()
  const browserX = clientX - left
  const BrowserY = clientY - top
  return {
    x: Math.round((browserX / width) * STREAMWIDTH),
    y: Math.round((BrowserY / height) * STREAMHEIGHT),
  }
}
