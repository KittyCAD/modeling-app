import { MouseEventHandler, useEffect, useRef, useState } from 'react'
import { getNormalisedCoordinates } from '../lib/utils'
import Loading from './Loading'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useModelingContext } from 'hooks/useModelingContext'
import { useNetworkContext } from 'hooks/useNetworkContext'
import { NetworkHealthState } from 'hooks/useNetworkStatus'
import { ClientSideScene } from 'clientSideScene/ClientSideSceneComp'
import { butName } from 'lib/cameraControls'
import { sendSelectEventToEngine } from 'lib/selections'
import { kclManager, engineCommandManager } from 'lib/singletons'

export const Stream = () => {
  const [isLoading, setIsLoading] = useState(true)
  const [isFirstRender, setIsFirstRender] = useState(kclManager.isFirstRender)
  const [clickCoords, setClickCoords] = useState<{ x: number; y: number }>()
  const videoRef = useRef<HTMLVideoElement>(null)
  const { settings } = useSettingsAuthContext()
  const { state, send, context } = useModelingContext()
  const { overallState } = useNetworkContext()
  const [isFreezeFrame, setIsFreezeFrame] = useState(false)

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

    const IDLE_TIME_MS = 1000 * 20
    let timeoutIdIdleA: ReturnType<typeof setTimeout> | undefined = undefined

    // Teardown everything if we go hidden or reconnect
    if (globalThis?.window?.document) {
      globalThis.window.document.onvisibilitychange = () => {
        if (globalThis.window.document.visibilityState === 'hidden') {
          clearTimeout(timeoutIdIdleA)
          timeoutIdIdleA = setTimeout(() => {
            videoRef.current?.pause()
            setIsFreezeFrame(true)
            window.requestAnimationFrame(() => {
              engineCommandManager.engineConnection?.tearDown({ freeze: true })
            })
          }, IDLE_TIME_MS)
        } else if (!engineCommandManager.engineConnection?.isReady()) {
          clearTimeout(timeoutIdIdleA)
          engineCommandManager.engineConnection?.connect(true)
        }
      }
    }

    let timeoutIdIdleB: ReturnType<typeof setTimeout> | undefined = undefined

    const onIdle = () => {
      videoRef.current?.pause()
      setIsFreezeFrame(true)
      kclManager.isFirstRender = true
      setIsFirstRender(true)
      // Give video time to pause
      window.requestAnimationFrame(() => {
        engineCommandManager.engineConnection?.tearDown({ freeze: true })
      })
    }
    const onAnyInput = () => {
      if (!engineCommandManager.engineConnection?.isReady()) {
        engineCommandManager.engineConnection?.connect(true)
      }
      // Clear both timers
      clearTimeout(timeoutIdIdleA)
      clearTimeout(timeoutIdIdleB)
      timeoutIdIdleB = setTimeout(onIdle, IDLE_TIME_MS)
    }

    globalThis?.window?.document?.addEventListener('keydown', onAnyInput)
    globalThis?.window?.document?.addEventListener('mousemove', onAnyInput)
    globalThis?.window?.document?.addEventListener('mousedown', onAnyInput)
    globalThis?.window?.document?.addEventListener('scroll', onAnyInput)
    globalThis?.window?.document?.addEventListener('touchstart', onAnyInput)

    timeoutIdIdleB = setTimeout(onIdle, IDLE_TIME_MS)

    return () => {
      globalThis?.window?.document?.removeEventListener('paste', handlePaste, {
        capture: true,
      })
      globalThis?.window?.document?.removeEventListener('keydown', onAnyInput)
      globalThis?.window?.document?.removeEventListener('mousemove', onAnyInput)
      globalThis?.window?.document?.removeEventListener('mousedown', onAnyInput)
      globalThis?.window?.document?.removeEventListener('scroll', onAnyInput)
      globalThis?.window?.document?.removeEventListener(
        'touchstart',
        onAnyInput
      )
    }
  }, [])

  useEffect(() => {
    setIsFirstRender(kclManager.isFirstRender)
    if (!kclManager.isFirstRender) videoRef.current?.play()
  }, [kclManager.isFirstRender])

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined'
    )
      return
    if (!videoRef.current) return
    if (!context.store?.mediaStream) return

    // Do not immediately play the stream!
    videoRef.current.srcObject = context.store.mediaStream
    videoRef.current.pause()

    send({
      type: 'Set context',
      data: {
        videoElement: videoRef.current,
      },
    })
  }, [context.store?.mediaStream])

  const handleMouseDown: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isNetworkOkay) return
    if (!videoRef.current) return
    if (state.matches('Sketch')) return
    if (state.matches('Sketch no face')) return

    const { x, y } = getNormalisedCoordinates({
      clientX: e.clientX,
      clientY: e.clientY,
      el: videoRef.current,
      ...context.store?.streamDimensions,
    })

    send({
      type: 'Set context',
      data: {
        buttonDownInStream: e.button,
      },
    })
    setClickCoords({ x, y })
  }

  const handleMouseUp: MouseEventHandler<HTMLDivElement> = (e) => {
    if (!isNetworkOkay) return
    if (!videoRef.current) return
    send({
      type: 'Set context',
      data: {
        buttonDownInStream: undefined,
      },
    })
    if (state.matches('Sketch')) return
    if (state.matches('Sketch no face')) return

    if (!context.store?.didDragInStream && butName(e).left) {
      sendSelectEventToEngine(
        e,
        videoRef.current,
        context.store?.streamDimensions
      )
    }

    send({
      type: 'Set context',
      data: {
        didDragInStream: false,
      },
    })
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

    if (delta > 5 && !context.store?.didDragInStream) {
      send({
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
      {(!isNetworkOkay || isLoading || isFirstRender) && !isFreezeFrame && (
        <div className="text-center absolute inset-0">
          <Loading>
            {!isNetworkOkay && !isLoading ? (
              <span data-testid="loading-stream">Stream disconnected...</span>
            ) : !isLoading && isFirstRender ? (
              <span data-testid="loading-stream">Building scene...</span>
            ) : (
              <span data-testid="loading-stream">Loading stream...</span>
            )}
          </Loading>
        </div>
      )}
    </div>
  )
}
