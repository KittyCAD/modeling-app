import { MouseEventHandler, useEffect, useRef, useState } from 'react'
import { useStore } from '../useStore'
import { getNormalisedCoordinates } from '../lib/utils'
import Loading from './Loading'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useModelingContext } from 'hooks/useModelingContext'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { ClientSideScene } from 'clientSideScene/ClientSideSceneComp'
import { butName } from 'lib/cameraControls'
import { sendSelectEventToEngine } from 'lib/selections'

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
  const { settings } = useSettingsAuthContext()
  const { state } = useModelingContext()
  const { overallState } = useNetworkContext()

  const isNetworkOkay =
    overallState === NetworkHealthState.Ok ||
    overallState === NetworkHealthState.Weak

  // Linux has a default behavior to paste text on middle mouse up
  // This adds a listener to block that pasting if the click target
  // is not a text input, so users can move in the 3D scene with
  // middle mouse drag with a text input focused without pasting.
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const isHtmlElement = e.target && e.target instanceof HTMLElement
      const isEditable =
        (isHtmlElement && !('explicitOriginalTarget' in e)) ||
        ('explicitOriginalTarget' in e &&
          ((e.explicitOriginalTarget as HTMLElement).contentEditable ===
            'true' ||
            ['INPUT', 'TEXTAREA'].some(
              (tagName) =>
                tagName === (e.explicitOriginalTarget as HTMLElement).tagName
            )))
      if (!isEditable) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
    }

    globalThis?.window?.document?.addEventListener('paste', handlePaste, {
      capture: true,
    })
    return () =>
      globalThis?.window?.document?.removeEventListener('paste', handlePaste, {
        capture: true,
      })
  }, [])

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
    if (!isNetworkOkay) return
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

  const handleMouseUp: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isNetworkOkay) return
    if (!videoRef.current) return
    setButtonDownInStream(undefined)
    if (state.matches('Sketch')) return
    if (state.matches('Sketch no face')) return

    if (!didDragInStream && butName(e).left) {
      sendSelectEventToEngine(e, videoRef.current, streamDimensions)
    }

    setDidDragInStream(false)
    setClickCoords(undefined)
  }

  const handleMouseMove: MouseEventHandler<HTMLVideoElement> = (e) => {
    if (!isNetworkOkay) return
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
      className="absolute inset-0 z-0"
      id="stream"
      data-testid="stream"
      id="stream"
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
        className="w-full cursor-pointer h-full"
        disablePictureInPicture
        id="video-stream"
      />
      <ClientSideScene
        cameraControls={settings.context.modeling.mouseControls.current}
      />
      {!isNetworkOkay && !isLoading && (
        <div className="text-center absolute inset-0">
          <Loading>
            <span data-testid="loading-stream">Stream disconnected...</span>
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
