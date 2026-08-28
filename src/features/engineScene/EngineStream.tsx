import { useSignalEffect } from '@preact/signals'
import { useRef } from 'preact/hooks'
import type { EngineConnection } from '@src/contracts/engine'
import '../project.css'

/**
 * The engine's video stream.
 *
 * The scene is rendered on the engine and streamed, so this really is the
 * viewport rather than a local canvas. The element is created once and its
 * `srcObject` is assigned from a signal effect: re-creating a `<video>` when the
 * stream changes would restart playback and flash black.
 *
 * `muted` and `playsInline` are what let autoplay work at all without a user
 * gesture, and `play()` is still called explicitly because some browsers ignore
 * `autoplay` on a stream attached after mount.
 */
export function EngineStream({ engine }: { engine: EngineConnection }) {
  const video = useRef<HTMLVideoElement>(null)

  useSignalEffect(() => {
    const element = video.current
    const stream = engine.mediaStream.value
    if (!element) return

    element.srcObject = stream
    if (!stream) return

    // A rejection here is normal when the element is detached mid-negotiation.
    void element.play().catch(() => {})
  })

  return (
    <video
      ref={video}
      class="zds-viewport__stream"
      muted
      playsInline
      autoPlay
      // The engine's own frames are the content; nothing here is decorative,
      // but there is no alternative text for a live 3D scene either.
      aria-label="Modeling engine viewport"
    />
  )
}
