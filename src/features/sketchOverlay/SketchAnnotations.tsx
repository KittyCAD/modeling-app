import { useComputed, useSignal, useSignalEffect } from '@preact/signals'
import { Icon } from '@kittycad/ui-kit'
import { useEffect, useRef } from 'preact/hooks'
import { useService } from '@src/app/context'
import { kclFrontendService } from '@src/contracts/kclFrontend'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import { settingsService } from '@src/contracts/settings'
import { sketchSessionService } from '@src/contracts/sketchSession'
import { showConstraintsSetting } from '@src/features/sketchMode/settings'
import type { SketchPointer } from '@src/features/sketchOverlay/createSketchInteraction'
import type { BadgeReveal } from '@src/features/sketchOverlay/createBadgeReveal'
import { planeToWorld } from '@src/lib/scene/projection'
import type {
  ApiObjectId,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { PlaneFrame, PlanePoint } from '@src/lib/scene/projection'
import { SKETCH_SELECTION_COLOR } from '@src/lib/sketch/appearance'
import { badgesOf, constraintsForSegment } from '@src/lib/sketch/badges'
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
 *
 * Badges are **hidden until asked for**, which is the existing app's policy and
 * the right one: a sketch with thirty constraints in it is a sketch you cannot
 * see, because the badges cover the geometry they are about. Two ways to ask:
 *
 *  - hover a segment, and *its* constraints appear in a row beside the cursor —
 *    beside, not on top, so the segment stays visible while you read them;
 *  - turn "Show all constraints" on, and every badge sits at its own anchor.
 *
 * A revealed row outlives the hover by two seconds, because reaching a badge
 * means leaving the segment that revealed it. Dimensions are always drawn: a
 * value is the thing itself rather than an annotation of it, and there is no
 * reading of a dimensioned sketch in which the number should be hidden.
 */
export function SketchAnnotations({
  pointer,
  reveal,
}: {
  pointer: SketchPointer
  reveal: BadgeReveal
}) {
  const sessions = useService(sketchSessionService)
  const frontend = useService(kclFrontendService)
  const projection = useService(sceneProjectionService)
  const settings = useService(settingsService)

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
   * Tell the reveal what the pointer is over.
   *
   * Only segments that *have* constraints are offered: hovering a bare line
   * should not reveal an empty row, and it should still start the clock on
   * whatever is already showing — which is what passing null does.
   */
  useSignalEffect(() => {
    const open = sessions.open.value
    const graph = frontend.sceneGraph.value
    const hovered = pointer.hovered.value
    const at = pointer.at.value

    if (!open || !graph || hovered === null || !at) {
      reveal.hover(null, null)
      return
    }

    const attached = constraintsForSegment(graph, hovered)
    reveal.hover(attached.length > 0 ? hovered : null, at)
  })

  /**
   * A drag takes them all away.
   *
   * Geometry moving under a row of badges pinned to where the pointer *was* is
   * the one arrangement that reads as a bug rather than as a hint. The existing
   * app dismisses them on drag start for the same reason.
   */
  useSignalEffect(() => {
    if (sessions.draft.value.kind === 'dragging') reveal.dismiss()
  })

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
      return { box: null, badges: [], dimensions: [] }
    }

    const place = (at: PlanePoint) =>
      projection.project(planeToWorld(plane as PlaneFrame, at), size)

    const selected = new Set(sessions.selection.value)
    const hovered = pointer.hovered.value
    const showAll = settings.value(showConstraintsSetting).value

    /*
     * Anchored, when everything is shown — and also for the one or two badges
     * that are selected or hovered while it is not, because those are being
     * looked at deliberately and should not vanish with the pointer.
     */
    const anchored = badgesOf(graph, open.sketchId).flatMap((badge) => {
      if (!showAll && !selected.has(badge.id) && hovered !== badge.id) return []

      const screen = place(badge.at)
      return screen
        ? [
            {
              ...badge,
              key: `anchored:${badge.id}`,
              screen: {
                x: screen.x + ANCHOR_OFFSET_PX,
                y: screen.y + ANCHOR_OFFSET_PX,
              },
              selected: selected.has(badge.id),
              segmentId: null as ApiObjectId | null,
            },
          ]
        : []
    })

    /*
     * Revealed by hovering a segment: a row beside where the pointer was, one
     * badge per constraint on that segment. Laid out from the pinned point rather
     * than from the segment, so the row is where the hand already is.
     */
    const shown = new Set(anchored.map((badge) => badge.id))
    const revealed = showAll
      ? []
      : reveal.revealed.value.flatMap((entry) => {
          const base = place(entry.at)
          if (!base) return []

          const titles = badgeTitles(graph, open.sketchId, entry.segmentId)

          return titles.flatMap((badge, index) => {
            if (shown.has(badge.id)) return []

            return [
              {
                ...badge,
                key: `revealed:${entry.segmentId}:${badge.id}`,
                screen: {
                  x: base.x + ROW_OFFSET_PX.x + index * ROW_PITCH_PX,
                  y: base.y + ROW_OFFSET_PX.y,
                },
                selected: selected.has(badge.id),
                segmentId: entry.segmentId,
              },
            ]
          })
        })

    /*
     * The area-select box, as a screen rectangle between its two corners.
     *
     * Its *maths* is in the plane — that is where the geometry is, and where the
     * existing app does it too — while the rectangle drawn is the screen box
     * between the two projected corners. The two agree exactly when the plane is
     * square to the camera, which is where sketching happens; seen at an angle
     * the drawn box is a rectangle over a parallelogram, which is the existing
     * app's compromise as well.
     */
    const dragged = pointer.box.value
    const corners = dragged
      ? { from: place(dragged.from), to: place(dragged.to) }
      : null

    return {
      box:
        corners?.from && corners.to
          ? {
              left: Math.min(corners.from.x, corners.to.x),
              top: Math.min(corners.from.y, corners.to.y),
              width: Math.abs(corners.to.x - corners.from.x),
              height: Math.abs(corners.to.y - corners.from.y),
              crossing: dragged?.mode === 'crossing',
            }
          : null,
      badges: [...anchored, ...revealed],
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
      {annotations.value.box ? (
        <div
          class="zds-sketch-area-select"
          data-crossing={annotations.value.box.crossing ? 'true' : undefined}
          style={{
            transform: `translate(${annotations.value.box.left}px, ${annotations.value.box.top}px)`,
            inlineSize: `${annotations.value.box.width}px`,
            blockSize: `${annotations.value.box.height}px`,
          }}
        />
      ) : null}

      {annotations.value.badges.map((badge, index) => (
        <button
          type="button"
          key={badge.key}
          class="zds-sketch-badge"
          data-selected={badge.selected ? 'true' : undefined}
          style={{
            /*
             * Fanned out by index when several land on the same spot, which is
             * ordinary: a corner of a rectangle carries a coincidence and often a
             * perpendicular too. A revealed *row* is already spread out, so this
             * only ever fires on the anchored ones.
             */
            transform: `translate(calc(${badge.screen.x}px - 50%), calc(${badge.screen.y}px - 50%)) translateX(${offsetFor(annotations.value.badges, index)}px)`,
          }}
          title={badge.title}
          aria-label={badge.title}
          /*
           * Holding the pointer on a badge holds the row it is in. Without this
           * the two seconds would run out while somebody was reading it, and the
           * thing they were about to click would go.
           */
          onPointerEnter={() =>
            badge.segmentId !== null && reveal.keep(badge.segmentId)
          }
          onPointerLeave={() =>
            badge.segmentId !== null && reveal.release(badge.segmentId)
          }
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

/**
 * Where an anchored badge sits relative to the thing it is about.
 *
 * Up and to the left, as the existing app places them: off the geometry, and out
 * of the way of a dimension label, which goes on the other side.
 */
const ANCHOR_OFFSET_PX = -15

/** Where a revealed row starts relative to the pointer, and how it is spaced. */
const ROW_OFFSET_PX = { x: 14, y: -14 }
const ROW_PITCH_PX = 22

/**
 * The badges for one segment's constraints, in the graph's own order.
 *
 * Read through `badgesOf` rather than rebuilt, so a revealed badge and an
 * anchored one are the same badge with the same icon and the same name.
 */
function badgeTitles(
  graph: SceneGraph,
  sketchId: ApiObjectId,
  segmentId: ApiObjectId
) {
  const attached = new Set(constraintsForSegment(graph, segmentId))
  return badgesOf(graph, sketchId).filter((badge) => attached.has(badge.id))
}

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
