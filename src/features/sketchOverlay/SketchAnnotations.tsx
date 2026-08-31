import { useComputed, useSignal } from '@preact/signals'
import { Icon } from '@kittycad/ui-kit'
import { useEffect, useRef } from 'preact/hooks'
import { useService } from '@src/app/context'
import { kclFrontendService } from '@src/contracts/kclFrontend'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import { sketchSessionService } from '@src/contracts/sketchSession'
import { planeToWorld } from '@src/lib/scene/projection'
import type { PlaneFrame, PlanePoint } from '@src/lib/scene/projection'
import { SKETCH_SELECTION_COLOR } from '@src/lib/sketch/appearance'
import { badgesOf } from '@src/lib/sketch/badges'
import { dimensionsOf } from '@src/lib/sketch/dimensions'
import { editableMeasure, formatMeasure } from '@src/lib/kcl/units'
import './sketchOverlay.css'

/**
 * Constraints and dimensions, as DOM over the scene.
 *
 * The existing app draws both as THREE sprites and then rebuilds click handling,
 * tooltips, focus and row layout by hand in screen space. The DOM already does
 * all of that: a badge is a `<button>` with a title and a focus ring, a
 * dimension is an `<input>`, and both are positioned by one `translate`. What is
 * *not* in the DOM's gift is where they go, which is the projection's job — so
 * this component is a positioning loop and nothing else.
 *
 * The container takes no pointer events and each annotation takes its own, so
 * clicking a badge selects a constraint while clicking beside one still orbits.
 */
export function SketchAnnotations() {
  const sessions = useService(sketchSessionService)
  const frontend = useService(kclFrontendService)
  const projection = useService(sceneProjectionService)

  const host = useRef<HTMLDivElement>(null)

  /**
   * The viewport, remembered rather than read per annotation.
   *
   * Reading `clientWidth` inside the loop would be a layout flush per badge; a
   * sketch with thirty constraints in it would pay thirty.
   */
  const viewport = useSignal({ width: 0, height: 0 })

  useEffect(() => {
    const element = host.current
    if (!element) return

    const measure = () =>
      (viewport.value = {
        width: element.clientWidth,
        height: element.clientHeight,
      })

    measure()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [viewport])

  /**
   * Everything to draw, already placed in element pixels.
   *
   * One computed for both kinds, because both depend on the same three things —
   * the graph, the plane and the camera — and splitting them would mean two
   * subscriptions to the camera and two passes over the graph per frame.
   */
  const annotations = useComputed(() => {
    const open = sessions.open.value
    const graph = frontend.sceneGraph.value
    const plane = open?.plane
    const size = viewport.value

    // Read so the annotations follow the camera; `project` itself is not a
    // signal read.
    void projection.epoch.value

    if (!open || !graph || !plane || size.width === 0) {
      return { badges: [], dimensions: [] }
    }

    const place = (at: PlanePoint) =>
      projection.project(planeToWorld(plane as PlaneFrame, at), size)

    const selected = new Set(sessions.selection.value)

    return {
      badges: badgesOf(graph, open.sketchId).flatMap((badge) => {
        const screen = place(badge.at)
        return screen
          ? [{ ...badge, screen, selected: selected.has(badge.id) }]
          : []
      }),
      dimensions: dimensionsOf(graph, open.sketchId).flatMap((dimension) => {
        // A dimension with no label position has nowhere to be drawn. It still
        // constrains the sketch; it just cannot be shown until something places
        // it.
        if (!dimension.at) return []
        const screen = place(dimension.at)
        return screen
          ? [{ ...dimension, screen, selected: selected.has(dimension.id) }]
          : []
      }),
    }
  })

  if (!sessions.open.value) return null

  return (
    <div
      class="zds-sketch-annotations"
      ref={host}
      // The one place that decides what "selected" looks like in a sketch is
      // `appearance.ts`, so the stylesheet is told rather than told twice.
      style={{ '--zds-sketch-selection': SKETCH_SELECTION_COLOR }}
    >
      {annotations.value.badges.map((badge, index) => (
        <button
          type="button"
          key={badge.id}
          class="zds-sketch-badge"
          data-selected={badge.selected ? 'true' : undefined}
          style={{
            /*
             * Fanned out by index when several land on the same spot, which is
             * ordinary: a corner of a rectangle carries a coincidence and often a
             * perpendicular too.
             */
            transform: `translate(calc(${badge.screen.x}px - 50%), calc(${badge.screen.y}px - 50%)) translateX(${offsetFor(annotations.value.badges, index)}px)`,
          }}
          title={badge.title}
          aria-label={badge.title}
          onClick={(event) =>
            sessions.select(badge.id, { add: event.shiftKey })
          }
        >
          <Icon name={badge.icon} size="small" />
        </button>
      ))}

      {annotations.value.dimensions.map((dimension) => (
        <DimensionLabel
          key={dimension.id}
          id={dimension.id}
          value={dimension.value}
          units={dimension.units}
          selected={dimension.selected}
          at={dimension.screen}
        />
      ))}
    </div>
  )
}

/** How far along to nudge a badge that shares a position with earlier ones. */
const BADGE_PITCH_PX = 20

function offsetFor(
  badges: readonly { screen: { x: number; y: number } }[],
  index: number
): number {
  const here = badges[index]?.screen
  if (!here) return 0

  let seen = 0
  for (let earlier = 0; earlier < index; earlier += 1) {
    const other = badges[earlier]?.screen
    if (!other) continue
    if (Math.abs(other.x - here.x) < 1 && Math.abs(other.y - here.y) < 1) {
      seen += 1
    }
  }

  return seen * BADGE_PITCH_PX
}

/**
 * A dimension's value, editable in place.
 *
 * An `<input>` rather than a click-to-open dialog, because a dimension *is* a
 * value: the shortest path from seeing 40 to meaning 50 is typing over it. What
 * is submitted is the text, not a number, because that is what goes into the
 * file — `2 * width` is as valid as `40`.
 */
function DimensionLabel({
  id,
  value,
  units,
  selected,
  at,
}: {
  id: number
  value: number
  units: string
  selected: boolean
  at: { x: number; y: number }
}) {
  const sessions = useService(sketchSessionService)
  const editing = useSignal(false)
  const draft = useSignal('')

  const shown = formatMeasure(value, units)
  const editable = editableMeasure(value)

  const commit = () => {
    const text = draft.value.trim()
    editing.value = false
    // Unchanged, or emptied: a re-solve that says the same thing is a wasted
    // round trip, and an empty expression is not a value.
    if (text.length === 0 || text === editable) return

    sessions.setDimension(id, text)
  }

  return (
    <div
      class="zds-sketch-dimension"
      data-selected={selected ? 'true' : undefined}
      style={{
        transform: `translate(calc(${at.x}px - 50%), calc(${at.y}px - 50%))`,
      }}
    >
      {editing.value ? (
        <input
          class="zds-sketch-dimension__field"
          // Autofocused because it was opened by a double click on the value it
          // replaces: anything else would need a second click to type into.
          ref={(element) => element?.focus()}
          value={draft.value}
          onInput={(event) =>
            (draft.value = (event.currentTarget as HTMLInputElement).value)
          }
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              editing.value = false
            }
          }}
        />
      ) : (
        <button
          type="button"
          class="zds-sketch-dimension__value"
          onClick={(event) => sessions.select(id, { add: event.shiftKey })}
          onDblClick={() => {
            draft.value = editable
            editing.value = true
          }}
        >
          {shown}
        </button>
      )}
    </div>
  )
}
