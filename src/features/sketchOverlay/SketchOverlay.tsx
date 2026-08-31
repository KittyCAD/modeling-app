import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { useService } from '@src/app/context'
import { kclFrontendService } from '@src/contracts/kclFrontend'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import { sketchSessionService } from '@src/contracts/sketchSession'
import type { PlanePoint } from '@src/lib/scene/projection'
import { planeToWorld } from '@src/lib/scene/projection'
import {
  type SketchShape,
  type SketchVertex,
  drawingOf,
  flatten,
} from '@src/lib/sketch/drawing'
import {
  CONSTRUCTION_DASH_PX,
  CONSTRUCTION_GAP_PX,
  POINT_SEGMENT_RADIUS,
  SKETCH_SELECTION_COLOR,
  getPointSegmentScale,
  getSegmentColor,
  getSegmentLineWidth,
} from '@src/lib/sketch/appearance'
import { SKETCH_HOVER_DISTANCE_PX, pickInSketch } from '@src/lib/sketch/hitTest'
import { draftSegmentIds } from '@src/lib/sketch/draft'
import { isAxisSnapTarget } from '@src/lib/sketch/snapping'
import { themeService } from '@src/contracts/theme'
import type { SketchPointer } from '@src/features/sketchOverlay/createSketchInteraction'
import './sketchOverlay.css'

/**
 * The sketch, drawn over the scene.
 *
 * SVG, and a pure function of three things: the scene graph the frontend
 * publishes, the plane the sketch is on, and where the camera is. Nothing here
 * holds geometry of its own, so there is no second model to fall out of step
 * with the solver — which is the failure the existing app's THREE.js scene works
 * hardest to avoid.
 *
 * It draws and does not listen. Pointer input arrives through a scene
 * interaction on the surface below, because a sheet across the viewport that
 * accepted clicks would swallow every orbit. The exception, when it arrives,
 * will be constraint badges: those are buttons, and a button that has to be
 * clicked asks for pointer events itself.
 */

/**
 * Enough of the DOM's own size for the projection to work in.
 *
 * Measured from the element rather than passed in, because the projection needs
 * the size of the surface the sketch is drawn *over* and only the DOM knows it.
 *
 * The element must therefore always be in the document — see the note on the
 * early return below. Measuring something you only render once you have measured
 * it is a deadlock that looks like a blank overlay.
 */
function useViewport(element: preact.RefObject<SVGSVGElement>) {
  const size = useSignal({ width: 0, height: 0 })

  useEffect(() => {
    const svg = element.current
    if (!svg) return

    const measure = () => {
      size.value = { width: svg.clientWidth, height: svg.clientHeight }
    }
    measure()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [element, size])

  return size
}

const pathFor = (points: readonly { x: number; y: number }[]) =>
  points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )
    .join(' ')

export function SketchOverlay({ pointer }: { pointer: SketchPointer }) {
  const sessions = useService(sketchSessionService)
  const frontend = useService(kclFrontendService)
  const projection = useService(sceneProjectionService)
  // Constrained geometry is drawn against the theme, so the drawing follows it.
  const themes = useService(themeService)

  const svg = useRef<SVGSVGElement>(null)
  const viewport = useViewport(svg)

  const open = sessions.open.value
  const graph = frontend.sceneGraph.value
  const plane = open?.plane ?? null

  // Read so the drawing follows the camera. The projection reports a counter
  // rather than the camera itself, so that nothing downstream is tempted to
  // work out where things are for itself.
  void projection.epoch.value
  const size = viewport.value

  /*
   * Nothing to draw, but the surface stays.
   *
   * Returning null here is what an earlier version did, and it could never draw
   * anything at all: the size comes from measuring this very element, so bailing
   * out before rendering it meant the observer never attached, the size stayed
   * zero, and the condition that caused it stayed true. An empty `<svg>` costs
   * nothing and keeps the measurement alive.
   */
  const drawable =
    open !== null && graph !== null && plane !== null && size.width > 0

  const project = (point: PlanePoint) =>
    plane ? projection.project(planeToWorld(plane, point), size) : null

  const projectAll = (points: readonly PlanePoint[]) => {
    const placed = points.map(project)
    // A chain with a point behind the camera cannot be drawn as one line, and
    // clipping it properly is more than this owes: it is dropped, and reappears
    // when the camera comes back round.
    return placed.every((point) => point !== null)
      ? (placed as { x: number; y: number }[])
      : null
  }

  const drawing =
    drawable && graph && open
      ? drawingOf(graph, open.sketchId)
      : { shapes: [], vertices: [] }

  /**
   * What the pointer is over, in the plane's own units.
   *
   * The tolerance is a few pixels turned into millimetres, which is the only way
   * a fixed pointer slack means the same thing at every zoom. A scale of zero
   * says the plane is edge-on or off screen, and then nothing is pickable —
   * which has to read as "do not pick" rather than as an infinitely fine one.
   */
  const hoverIn = (
    shapes: typeof drawing,
    on: typeof plane,
    viewportSize: typeof size
  ) => {
    const where = pointer.at.value
    if (!drawable || !on || !where) return null

    const scale = projection.scaleOn(on, where, viewportSize)
    // Ten pixels, as the existing app has it, converted to the plane's units so
    // the reach is the same at any zoom.
    return scale > 0
      ? pickInSketch(shapes, where, SKETCH_HOVER_DISTANCE_PX / scale)
      : null
  }

  const hovered = hoverIn(drawing, plane, size)

  const snap = pointer.snap.value

  /*
   * Which segments are provisional.
   *
   * There is no separate preview any more: the segment being dragged out is in
   * the graph like every other, and this is the only thing that says it is not
   * finished yet. Drawing it as a draft — grey, by the ported precedence ladder
   * — is what tells somebody the difference.
   */
  const drafts = new Set(draftSegmentIds(sessions.draft.value))

  /**
   * Where the point would land, marked.
   *
   * A ring in the selection colour on the snapped position rather than under the
   * pointer, which is the whole message: the click will not go where you are
   * pointing, it will go *there*.
   */
  const snapAt = snap ? project(snap.position) : null
  const snapMarker = snapAt ? (
    <circle
      class="zds-sketch__snap"
      cx={snapAt.x}
      cy={snapAt.y}
      r={POINT_SEGMENT_RADIUS * 2}
      stroke={SKETCH_SELECTION_COLOR}
    />
  ) : null

  /**
   * The axis a snap is following, drawn as a guide.
   *
   * An axis snap is the one target with nothing on screen to point at — the
   * others are geometry the user can already see — so without a line it looks
   * like the point simply refused to go where it was put.
   */
  const origin =
    snap && isAxisSnapTarget(snap.target) ? project({ x: 0, y: 0 }) : null
  const snapGuide =
    snapAt && origin ? (
      <line
        class="zds-sketch__guide"
        // From the origin to the snapped point, which by construction lies on
        // the axis — so the line *is* the axis, as far as it is being used.
        x1={origin.x}
        y1={origin.y}
        x2={snapAt.x}
        y2={snapAt.y}
        stroke={SKETCH_SELECTION_COLOR}
      />
    ) : null

  const theme = themes.resolved.value === 'light' ? 'light' : 'dark'

  /*
   * Colour and width come from the ported precedence ladder rather than from
   * CSS.
   *
   * They have to: which of draft, hover, selection, conflict and freedom wins is
   * an ordered decision with five inputs, and expressing that in selectors would
   * be re-deriving it in a language that cannot say "in this order". The
   * stylesheet keeps what is genuinely presentational — line joins, the dash
   * pattern, transitions — and the decisions stay in code where they were tuned.
   */
  const shape = (item: SketchShape, key: string, isDraft: boolean) => {
    const points = projectAll(flatten(item))
    if (!points) return null

    const isHovered = hovered?.kind === 'segment' && hovered.id === item.id

    return (
      <path
        key={key}
        class="zds-sketch__segment"
        d={pathFor(points)}
        stroke={getSegmentColor({
          isDraft,
          isHovered,
          freedom: item.freedom,
          theme,
        })}
        stroke-width={getSegmentLineWidth({ isHovered })}
        // Screen-space dashes, which is what the existing app goes to the
        // trouble of a custom shader for: a dash that scales with zoom stops
        // reading as construction geometry.
        stroke-dasharray={
          item.construction
            ? `${CONSTRUCTION_DASH_PX} ${CONSTRUCTION_GAP_PX}`
            : undefined
        }
      />
    )
  }

  const vertex = (item: SketchVertex) => {
    const at = project(item.at)
    if (!at) return null

    const isHovered = hovered?.kind === 'vertex' && hovered.id === item.id

    return (
      <circle
        key={`vertex-${item.id}`}
        class="zds-sketch__vertex"
        cx={at.x}
        cy={at.y}
        r={POINT_SEGMENT_RADIUS * getPointSegmentScale({ isHovered })}
        fill={getSegmentColor({ isHovered, freedom: item.freedom, theme })}
      />
    )
  }

  return (
    <svg
      ref={svg}
      class="zds-sketch"
      // Decorative in the accessibility sense: everything it shows is in the
      // KCL, which is text and is where a screen reader should be.
      aria-hidden="true"
    >
      {drawing.shapes.map((item) =>
        shape(item, `segment-${item.id}`, drafts.has(item.id))
      )}
      {snapGuide}
      {drawing.vertices.map(vertex)}
      {snapMarker}
    </svg>
  )
}
