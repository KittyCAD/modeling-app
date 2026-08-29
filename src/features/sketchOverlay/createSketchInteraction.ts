import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import type { SketchSessionService } from '@src/contracts/sketchSession'
import type { PlanePoint } from '@src/lib/scene/projection'

/** Where the pointer is on the sketch plane, shared with whatever draws it. */
export interface SketchPointer {
  readonly at: ReadonlySignal<PlanePoint | null>
}

/** How far the pointer may travel between press and release and still be a click. */
const CLICK_SLOP = 4

export interface SketchInteractionDependencies {
  session: () => SketchSessionService | undefined
  projection: () => SceneProjection | undefined
}

/**
 * Drawing with the pointer, in front of everything else.
 *
 * Attached at interaction order 50, ahead of the camera at 100 and selection at
 * 200, and it claims events with `stopImmediatePropagation` while a tool is
 * equipped. That is the only way to be ahead of them: interactions share one
 * element, so ordinary propagation would not stop a listener already bound to it.
 *
 * It claims *only* while a tool is equipped, which is what keeps orbiting
 * available inside a sketch. Put the tool down and the camera has the surface
 * back, unchanged.
 *
 * Engine picking is deliberately not consulted. The engine is showing the last
 * model that was *built*, and a segment drawn a moment ago is not in it — so
 * asking it what is under the cursor would answer about a scene that is one
 * execution out of date. Everything here is analytic, in the plane.
 */
export function createSketchInteraction(
  dependencies: SketchInteractionDependencies
): {
  pointer: SketchPointer
  attachTool: (element: HTMLElement) => () => void
  attachPick: (element: HTMLElement) => () => void
} {
  const at = signal<PlanePoint | null>(null)

  /** Where a plane point is, for a pointer event over an element. */
  const planePointFor = (
    element: HTMLElement,
    event: PointerEvent
  ): PlanePoint | null => {
    const session = dependencies.session()
    const projection = dependencies.projection()
    const plane = session?.open.value?.plane
    if (!plane || !projection) return null

    const rect = element.getBoundingClientRect()
    return projection.unproject(
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        viewport: { width: rect.width, height: rect.height },
      },
      plane
    )
  }

  /** True while the pointer belongs to a tool rather than to the camera. */
  const drawing = () => dependencies.session()?.tool.value != null

  /** True while a sketch is open, tool or no tool. */
  const inSketch = () => dependencies.session()?.open.value != null

  return {
    pointer: { at: computed(() => at.value) },

    attachTool(element: HTMLElement) {
      let pressedAt: { x: number; y: number } | null = null

      const onPointerMove = (event: PointerEvent) => {
        // Tracked whenever a sketch is open, tool or not: hovering is how you
        // see what you would pick, and that is true before you pick up a tool.
        if (!dependencies.session()?.open.value) {
          at.value = null
          return
        }
        at.value = planePointFor(element, event)
      }

      const onPointerLeave = () => {
        at.value = null
      }

      const onPointerDown = (event: PointerEvent) => {
        if (!drawing() || event.button !== 0) return

        /*
         * Claimed here rather than on the click, because the camera starts its
         * drag on pointerdown: letting this one through would begin an orbit
         * that the click then finished.
         */
        event.stopImmediatePropagation()
        event.preventDefault()
        pressedAt = { x: event.clientX, y: event.clientY }
        at.value = planePointFor(element, event)
      }

      const onPointerUp = (event: PointerEvent) => {
        const pressed = pressedAt
        pressedAt = null
        if (!drawing() || !pressed || event.button !== 0) return

        event.stopImmediatePropagation()

        // A drag is not a click. Somebody who pressed, moved and released was
        // doing something else, and placing a point where they let go would be
        // a segment they did not ask for.
        if (
          Math.abs(event.clientX - pressed.x) > CLICK_SLOP ||
          Math.abs(event.clientY - pressed.y) > CLICK_SLOP
        ) {
          return
        }

        const point = planePointFor(element, event)
        // Off the plane: edge-on, or behind the camera. There is nowhere to put
        // a point, and inventing one would put it somewhere surprising.
        if (point) dependencies.session()?.place(point)
      }

      element.addEventListener('pointermove', onPointerMove)
      element.addEventListener('pointerleave', onPointerLeave)
      element.addEventListener('pointerdown', onPointerDown)
      element.addEventListener('pointerup', onPointerUp)

      return () => {
        element.removeEventListener('pointermove', onPointerMove)
        element.removeEventListener('pointerleave', onPointerLeave)
        element.removeEventListener('pointerdown', onPointerDown)
        element.removeEventListener('pointerup', onPointerUp)
        at.value = null
      }
    },

    /**
     * Clicks that reach neither the engine nor the mode.
     *
     * Attached *after* the camera and *before* selection, which is the only
     * position that works and is why interaction order is a number rather than a
     * list. It has to be after the camera because swallowing a press would stop
     * an orbit, and orbiting inside a sketch is the whole reason the projection
     * follows the camera instead of taking it. It has to be before selection
     * because of what selection does with a click on nothing: it runs "leave the
     * mode", which now writes the sketch back and rebuilds the model. A stray
     * click may not finish somebody's sketch.
     *
     * Suppressing the engine pick is wanted here regardless. The engine is
     * showing the last model that was *built*, so what it says is under the
     * cursor is one execution out of date, and a segment drawn a moment ago is
     * not in it at all. Analytic sketch selection lands here next; until then a
     * click means nothing, which is the right amount of nothing.
     */
    attachPick(element: HTMLElement) {
      const swallow = (event: PointerEvent) => {
        // A tool has its own listener, ahead of the camera, and has already
        // taken this event by the time it would get here.
        if (!inSketch() || drawing() || event.button !== 0) return
        event.stopImmediatePropagation()
      }

      element.addEventListener('pointerdown', swallow)
      element.addEventListener('pointerup', swallow)

      return () => {
        element.removeEventListener('pointerdown', swallow)
        element.removeEventListener('pointerup', swallow)
      }
    },
  }
}
