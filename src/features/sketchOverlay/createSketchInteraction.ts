import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { SceneProjection } from '@src/contracts/sceneProjection'
import type { SketchSessionService } from '@src/contracts/sketchSession'
import type { SceneGraph } from '@rust/kcl-lib/bindings/FrontendApi'
import type { PlanePoint } from '@src/lib/scene/projection'
import type { ApiObjectId } from '@rust/kcl-lib/bindings/FrontendApi'
import { coincidentCluster, isDraggable, isPoint } from '@src/lib/sketch/drag'
import { drawingOf } from '@src/lib/sketch/drawing'
import { SKETCH_HOVER_DISTANCE_PX, pickInSketch } from '@src/lib/sketch/hitTest'
import {
  ORIGIN_TARGET,
  type SnappingCandidate,
  allowSnapping,
  bestSnappingCandidate,
  snappedPosition,
} from '@src/lib/sketch/snapping'

/** Where the pointer is on the sketch plane, shared with whatever draws it. */
export interface SketchPointer {
  readonly at: ReadonlySignal<PlanePoint | null>
  /**
   * What the pointer would snap to, if anything.
   *
   * Held here rather than recomputed by the drawing, because the click and the
   * indicator have to agree: an overlay that worked out its own candidate could
   * mark one place and place the point in another.
   */
  readonly snap: ReadonlySignal<SnappingCandidate | null>
}

/** How far the pointer may travel between press and release and still be a click. */
const CLICK_SLOP = 4

export interface SketchInteractionDependencies {
  session: () => SketchSessionService | undefined
  projection: () => SceneProjection | undefined
  /** The scene the sketch is drawn from, for working out what to snap to. */
  graph: () => SceneGraph | null
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
  const snap = signal<SnappingCandidate | null>(null)

  /**
   * What the pointer would snap to, in the plane's own units.
   *
   * Ten pixels of reach, as the existing app has it, converted through the
   * projection so the reach is the same number of pixels at any zoom. Shift
   * suppresses it, which is how somebody says "near that, not on it".
   */
  const snapFor = (
    where: PlanePoint | null,
    event: { shiftKey: boolean },
    viewport: { width: number; height: number }
  ): SnappingCandidate | null => {
    const session = dependencies.session()
    const projection = dependencies.projection()
    const graph = dependencies.graph()
    const open = session?.open.value
    const plane = open?.plane

    if (!where || !plane || !graph || !projection) return null
    if (!allowSnapping(event)) return null

    // The real viewport: how big a pixel is on the plane depends on it, and a
    // made-up one would make the reach wrong by whatever factor it was out by.
    const scale = projection.scaleOn(plane, where, viewport)
    // A scale of zero says the plane is edge-on or off screen, and then there is
    // nothing to snap within.
    if (scale <= 0) return null

    /*
     * Never to itself.
     *
     * The point being moved is in the sketch like any other, so without this it
     * snaps to where it started and refuses to be dragged at all — the existing
     * app excludes the draft point for exactly this reason. The same is true of a
     * draft's own end while it is being rubber-banded.
     */
    /*
     * A drag excludes the whole *coincident cluster*, not just the point being
     * held: a profile's corner is several points at one place, and the twin one
     * pixel away would capture every snap the moment the corner was picked up.
     */
    const moving = session?.draft.value
    let exclude: Set<ApiObjectId> | undefined

    if (moving?.kind === 'drawing') {
      exclude = new Set([moving.pointId])
    } else if (moving?.kind === 'dragging') {
      // Snapping is for points. A segment body being dragged has no single
      // position to snap, which is how the existing app has it too.
      if (!isPoint(graph, moving.objectId)) return null
      exclude = new Set(coincidentCluster(graph, moving.objectId))
    }

    return bestSnappingCandidate(
      drawingOf(graph, open.sketchId),
      where,
      SKETCH_HOVER_DISTANCE_PX / scale,
      exclude ? { exclude } : {}
    )
  }

  /** The element's size, which the projection needs to place anything. */
  const viewportOf = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }

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

  /**
   * What the pointer could take hold of, if anything.
   *
   * The same ten pixels of reach the snapping uses, because it is the same
   * question asked for a different purpose — and two different reaches would mean
   * a point you could snap to but not grab.
   *
   * A segment *body* counts, not just its ends. Grabbing an edge and moving the
   * whole thing is how the existing app works and is most of what dragging is
   * for; the hit test already prefers points where both are in reach, so an end
   * is still an end.
   */
  const grabbableAt = (
    where: PlanePoint | null,
    viewport: { width: number; height: number }
  ) => {
    const session = dependencies.session()
    const projection = dependencies.projection()
    const graph = dependencies.graph()
    const open = session?.open.value
    const plane = open?.plane

    if (!where || !plane || !graph || !projection) return null

    const scale = projection.scaleOn(plane, where, viewport)
    if (scale <= 0) return null

    const hit = pickInSketch(
      drawingOf(graph, open.sketchId),
      where,
      SKETCH_HOVER_DISTANCE_PX / scale
    )
    if (!hit) return null

    /*
     * Refused rather than grabbed and then ignored.
     *
     * A line that belongs to something else cannot be moved directly, and
     * claiming the press for a drag that will do nothing would swallow an orbit
     * with it.
     */
    return isDraggable(graph, hit.id) ? hit.id : null
  }

  /**
   * Whether the pointer is on the sketch's origin.
   *
   * The origin is a real thing to select — constraints name it — and the one such
   * thing that is not an object in the graph, so it cannot come out of the hit
   * test with everything else. The same ten pixels of reach, because it is the
   * same question.
   */
  const nearOrigin = (
    where: PlanePoint,
    viewport: { width: number; height: number }
  ) => {
    const projection = dependencies.projection()
    const plane = dependencies.session()?.open.value?.plane
    if (!projection || !plane) return false

    const scale = projection.scaleOn(plane, where, viewport)
    if (scale <= 0) return false

    return Math.hypot(where.x, where.y) <= SKETCH_HOVER_DISTANCE_PX / scale
  }

  /** True while a point is being moved. */
  const dragging = () => dependencies.session()?.draft.value.kind === 'dragging'

  return {
    pointer: {
      at: computed(() => at.value),
      snap: computed(() => snap.value),
    },

    attachTool(element: HTMLElement) {
      let pressedAt: { x: number; y: number } | null = null
      /** What the press took hold of, so a release can tell a click from a drag. */
      let grabbedId: ApiObjectId | null = null

      const onPointerMove = (event: PointerEvent) => {
        // Tracked whenever a sketch is open, tool or not: hovering is how you
        // see what you would pick, and that is true before you pick up a tool.
        if (!dependencies.session()?.open.value) {
          at.value = null
          snap.value = null
          return
        }
        const where = planePointFor(element, event)
        at.value = where
        const candidate = snapFor(where, event, viewportOf(element))
        snap.value = candidate

        /*
         * And drag the draft to it.
         *
         * The snapped position, not the pointer's, because the rubber band has
         * to end where the click will land — a preview that follows the cursor
         * past a snap target is a preview that lies about the next click.
         */
        if (where && (drawing() || dragging())) {
          dependencies.session()?.moveTo(snappedPosition(candidate, where))
        }
      }

      const onPointerLeave = () => {
        at.value = null
        snap.value = null
      }

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return

        const where = planePointFor(element, event)
        const viewport = viewportOf(element)

        /*
         * A point under the pointer is grabbed, tool or no tool.
         *
         * This has to happen here, ahead of the camera, for the same reason
         * drawing does: the camera begins an orbit on the press, so a grab
         * decided any later would be a grab that also spun the model. It is why
         * moving geometry cannot live with the *other* pointer handler, the one
         * that sits behind the camera and swallows clicks.
         */
        const grabbed = drawing() ? null : grabbableAt(where, viewport)
        if (!drawing() && grabbed === null) return

        event.stopImmediatePropagation()
        event.preventDefault()
        pressedAt = { x: event.clientX, y: event.clientY }
        at.value = where
        snap.value = snapFor(where, event, viewport)

        if (grabbed !== null && where) {
          grabbedId = grabbed
          dependencies.session()?.beginDrag(grabbed, where)
        }
      }

      const onPointerUp = (event: PointerEvent) => {
        const pressed = pressedAt
        const grabbed = grabbedId
        pressedAt = null
        grabbedId = null
        if (event.button !== 0) return

        const moved =
          !pressed ||
          Math.abs(event.clientX - pressed.x) > CLICK_SLOP ||
          Math.abs(event.clientY - pressed.y) > CLICK_SLOP

        /*
         * A drag ends where it ended, and is not also a click.
         *
         * Committed from the release rather than from the last preview, because
         * the pointer can move between the two — and because a superseded preview
         * may never have reached the position the user let go at.
         */
        if (dragging()) {
          event.stopImmediatePropagation()

          /*
           * Pressed and released without moving: that is a click on the thing,
           * which selects it. The drag is abandoned rather than committed, so a
           * click costs no solve and cannot nudge geometry by a pixel.
           */
          if (!moved && grabbed !== null) {
            dependencies.session()?.cancelTool()
            dependencies.session()?.select(grabbed, { add: event.shiftKey })
            return
          }

          const where = planePointFor(element, event)
          const landed = snappedPosition(
            snapFor(where, event, viewportOf(element)),
            where ?? { x: 0, y: 0 }
          )
          if (where) dependencies.session()?.endDrag(landed)
          return
        }

        if (!drawing() || !pressed) return

        event.stopImmediatePropagation()

        // A drag is not a click. Somebody who pressed, moved and released was
        // doing something else, and placing a point where they let go would be
        // a segment they did not ask for.
        if (moved) return

        /*
         * A double click ends the chain.
         *
         * Checked before placing, because the second click of the pair has
         * already committed a segment: what is being said is "and no more",
         * not "and one more".
         */
        if (event.detail >= 2) {
          dependencies.session()?.finishChain()
          return
        }

        const point = planePointFor(element, event)
        // Off the plane: edge-on, or behind the camera. There is nowhere to put
        // a point, and inventing one would put it somewhere surprising.
        if (!point) return

        /*
         * The snap wins over the pointer.
         *
         * Worked out again here rather than read from the signal, because the
         * release is what commits and the pointer may have moved since the last
         * move event — and shift may have been let go or taken up in between.
         */
        dependencies
          .session()
          ?.place(
            snappedPosition(snapFor(point, event, viewportOf(element)), point)
          )
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
        snap.value = null
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
      /** Where the press was, so an orbit can be told from a click. */
      let pressedAt: { x: number; y: number } | null = null

      const onPointerDown = (event: PointerEvent) => {
        // A tool has its own listener, ahead of the camera, and has already
        // taken this event by the time it would get here.
        if (!inSketch() || drawing() || event.button !== 0) return
        pressedAt = { x: event.clientX, y: event.clientY }
        event.stopImmediatePropagation()
      }

      const onPointerUp = (event: PointerEvent) => {
        const pressed = pressedAt
        pressedAt = null
        if (!inSketch() || drawing() || event.button !== 0) return

        event.stopImmediatePropagation()

        /*
         * An orbit is not a click.
         *
         * This runs *behind* the camera, so a press that turned into an orbit
         * gets here on release like any other. Clearing the selection because
         * somebody looked at the model from another angle would be its own bug.
         */
        if (
          !pressed ||
          Math.abs(event.clientX - pressed.x) > CLICK_SLOP ||
          Math.abs(event.clientY - pressed.y) > CLICK_SLOP
        ) {
          return
        }

        /*
         * The origin, which is selectable and is not in the graph.
         *
         * Nothing else can be picked here: anything in the sketch was already
         * offered to the tool handler ahead of the camera, and it claimed the
         * press. So what reaches this point is a click on the origin or a click
         * on nothing.
         */
        const where = planePointFor(element, event)
        const session = dependencies.session()

        if (where && nearOrigin(where, viewportOf(element))) {
          session?.select(ORIGIN_TARGET, { add: event.shiftKey })
          return
        }

        // Clicking nothing means nothing is selected, which is how a selection
        // is abandoned without reaching for a key.
        if (!event.shiftKey) session?.clearSelection()
      }

      element.addEventListener('pointerdown', onPointerDown)
      element.addEventListener('pointerup', onPointerUp)

      return () => {
        element.removeEventListener('pointerdown', onPointerDown)
        element.removeEventListener('pointerup', onPointerUp)
      }
    },
  }
}
