import { useSignal, useSignalEffect } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useService } from '@src/app/context'
import { kclFrontendService } from '@src/contracts/kclFrontend'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import { sketchSessionService } from '@src/contracts/sketchSession'
import { themeService } from '@src/contracts/theme'
import type { SketchPointer } from '@src/features/sketchOverlay/createSketchInteraction'
import type { SketchScene as Scene } from '@src/features/sketchOverlay/createSketchScene'
import type { drawSketch } from '@src/features/sketchOverlay/sketchSegments'
import { draftSegmentIds } from '@src/lib/sketch/draft'
import { drawingOf } from '@src/lib/sketch/drawing'
import { SKETCH_HOVER_DISTANCE_PX, pickInSketch } from '@src/lib/sketch/hitTest'
import './sketchOverlay.css'

/**
 * The sketch, drawn in THREE over the engine's video.
 *
 * Replaces an SVG overlay that drew the same geometry, and the reason is not that
 * SVG could not: it is that everything still to come — dimension lines with
 * arrowheads and extension lines, constraint badges, trim previews, area select —
 * exists in the existing app as THREE objects with a decade of tuning in them,
 * and reimplementing that in SVG would be inventing a second look. Sharing the
 * renderer means sharing the port.
 *
 * Still a pure function of three things: the graph the frontend publishes, the
 * plane the sketch is on, and where the camera is. The scene is rebuilt from them
 * rather than mutated toward them, so there is no second model of the sketch that
 * can drift from the solver's.
 */
export function SketchScene({ pointer }: { pointer: SketchPointer }) {
  const sessions = useService(sketchSessionService)
  const frontend = useService(kclFrontendService)
  const projection = useService(sceneProjectionService)
  const themes = useService(themeService)

  /**
   * Bumped when the renderer arrives.
   *
   * The effects that follow the camera and the sketch run before the dynamic
   * import resolves, and a signal effect only re-runs when a signal it *read*
   * changes — so without something to read they would never run again and the
   * first frame would never be drawn.
   */
  const loaded = useSignal(0)

  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<Scene | null>(null)
  const draw = useRef<typeof drawSketch | null>(null)

  /**
   * Loaded on demand, because THREE.js is most of a megabyte.
   *
   * Nobody should wait for it before the app paints, and the gizmo reaches it the
   * same way — so the two share a chunk and opening a sketch after the gizmo has
   * drawn costs nothing.
   */
  useEffect(() => {
    const element = host.current
    if (!element) return

    let disposed = false
    let built: Scene | null = null
    let observer: ResizeObserver | null = null

    void import('@src/features/sketchOverlay/sketchRenderer')
      .then((renderer) => {
        // Unmounted while the chunk was in flight, which is ordinary: a sketch
        // can be left before a network round trip finishes.
        if (disposed) return

        built = renderer.createSketchScene(element, new renderer.Group())
        scene.current = built
        draw.current = renderer.drawSketch
        built.resize()

        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => built?.resize())
          observer.observe(element)
        }

        // The signal effects below have already run against an empty ref, so
        // nudge them now that there is something to draw into.
        loaded.value += 1
      })
      .catch((error) => {
        console.error('sketch: could not load the renderer', error)
      })

    return () => {
      disposed = true
      observer?.disconnect()
      built?.dispose()
      scene.current = null
      draw.current = null
    }
  }, [loaded])

  /**
   * Follow the camera.
   *
   * Its own effect, and the reason is cost: the camera moves at 15 Hz while the
   * sketch changes only when somebody edits it, so redrawing the geometry on
   * every echo would rebuild every line strip several times a second for a view
   * that has not changed shape.
   */
  useSignalEffect(() => {
    void loaded.value
    void projection.epoch.value
    const frame = projection.frame.value
    if (frame) scene.current?.follow(frame)
  })

  /** Put the group on the plane whenever the open sketch changes. */
  useSignalEffect(() => {
    void loaded.value
    const plane = sessions.open.value?.plane
    if (plane) scene.current?.placeOn(plane)
  })

  /** Redraw when the sketch, the hover, or the theme changes. */
  useSignalEffect(() => {
    void loaded.value
    const built = scene.current
    const paint = draw.current
    const open = sessions.open.value
    const graph = frontend.sceneGraph.value
    const plane = open?.plane
    const theme = themes.resolved.value === 'light' ? 'light' : 'dark'

    if (!built || !paint) return
    if (!open || !graph || !plane) {
      built.invalidate()
      return
    }

    const drawing = drawingOf(graph, open.sketchId)

    /*
     * The hover is worked out here rather than passed in, because it depends on
     * the same drawing that is about to be built — computing it anywhere else
     * would mean building the drawing twice, or marking a segment that is not the
     * one under the pointer.
     */
    const where = pointer.at.value
    const scale = where
      ? projection.scaleOn(plane, where, {
          width: host.current?.clientWidth ?? 0,
          height: host.current?.clientHeight ?? 0,
        })
      : 0
    const hovered =
      where && scale > 0
        ? pickInSketch(drawing, where, SKETCH_HOVER_DISTANCE_PX / scale)
        : null

    paint(
      built.group,
      drawing,
      {
        theme,
        drafts: new Set(draftSegmentIds(sessions.draft.value)),
        hoveredId: hovered?.id ?? null,
      },
      built.viewport()
    )
    // Freshly built points are unit circles until something scales them.
    built.rescale()
    built.invalidate()
  })

  return <div class="zds-sketch" ref={host} aria-hidden="true" />
}
