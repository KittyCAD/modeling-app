import { MouseEventHandler, useEffect, useRef } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../useStore'
import { throttle } from '../lib/utils'

export const Stream = () => {
  const videoRef = useRef<HTMLVideoElement>(null)
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

  let currentCmdId = uuidv4()

  const debounceSocketSend = throttle((message) => {
    engineCommandManager?.sendCommand(message)
  }, 100)
  const handleMouseMove: MouseEventHandler<HTMLVideoElement> = ({
    clientX,
    clientY,
  }) => {
    if (!videoRef.current) return
    const { left, top } = videoRef.current.getBoundingClientRect()
    const x = clientX - left
    const y = clientY - top
    debounceSocketSend({ type: 'MouseMove', x: x, y: y })
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

    engineCommandManager?.sendCommand({
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

    if (currentCmdId == null) {
      return
    }

    engineCommandManager?.sendCommand({
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
      // cmd_id: uuidv4(),
      // file_id: file_id,
    })
    currentCmdId = ''
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
