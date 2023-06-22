import { MouseEventHandler, useEffect, useRef } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'
import { throttle } from '../lib/utils'

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

  const debounceSocketSend = throttle((message) => {
    engineCommandManager?.sendSceneCommand(message)
  }, 100)
  const handleMouseMove: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
  }) => {
    if (!videoRef.current) return
    if (!cmdId.current) return
    const { left, top } = videoRef.current.getBoundingClientRect()
    const x = clientX - left
    const y = clientY - top
    debounceSocketSend({
      type: 'ModelingCmdReq',
      cmd: {
        CameraDragMove: {
          interaction: 'rotate',
          window: {
            x: x,
            y: y,
          },
        },
      },
      cmd_id: uuidv4(),
      file_id: file_id,
    })
  }

  const handleMouseDown: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
  }) => {
    if (!videoRef.current) return
    const { left, top } = videoRef.current.getBoundingClientRect()
    const x = clientX - left
    const y = clientY - top
    console.log('click', x, y)

    const newId = uuidv4()
    cmdId.current = newId

    engineCommandManager?.sendSceneCommand({
      type: 'ModelingCmdReq',
      cmd: {
        CameraDragStart: {
          interaction: 'rotate',
          window: {
            x: x,
            y: y,
          },
        },
      },
      cmd_id: newId,
      file_id,
    })
  }
  const handleMouseUp: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
  }) => {
    if (!videoRef.current) return
    const { left, top } = videoRef.current.getBoundingClientRect()
    const x = clientX - left
    const y = clientY - top

    if (cmdId.current == null) {
      return
    }

    engineCommandManager?.sendSceneCommand({
      type: 'ModelingCmdReq',
      cmd: {
        CameraDragEnd: {
          interaction: 'rotate',
          window: {
            x: x,
            y: y,
          },
        },
      },
      cmd_id: uuidv4(),
      file_id: file_id,
    })
    cmdId.current = ''
  }

  return (
    <div>
      <PanelHeader title="Stream" />
      <video
        ref={videoRef}
        muted
        autoPlay
        controls={false}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      />
    </div>
  )
}
