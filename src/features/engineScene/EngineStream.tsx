import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useValueSpec } from '@src/app/context'
import type { EngineConnection } from '@src/contracts/engine'
import { sceneInteractionsValueSpec } from '@src/contracts/engineScene'
import './engineScene.css'

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
 *
 * Interaction is contributed rather than written here. The element is the only
 * surface the model can be touched through, so the camera wants drags, selection
 * will want clicks, and a measurement tool will want hovers — and none of them
 * belong in a component whose job is a video with a size.
 */
export function EngineStream({ engine }: { engine: EngineConnection }) {
  const video = useRef<HTMLVideoElement>(null)
  const interactions = useValueSpec(sceneInteractionsValueSpec)

  useSignalEffect(() => {
    const element = video.current
    const stream = engine.mediaStream.value
    if (!element) return

    element.srcObject = stream
    if (!stream) return

    // A rejection here is normal when the element is detached mid-negotiation.
    void element.play().catch(() => {})
  })

  // Keyed on the contribution list, not on the signal: a new interaction being
  // installed has to reach an element that is already mounted.
  const installed = interactions.value

  useEffect(() => {
    const element = video.current
    if (!element) return

    const disposers = [...installed]
      .sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
      )
      .map((interaction) => interaction.attach(element))

    return () => {
      for (const dispose of disposers) dispose?.()
    }
  }, [installed])

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
