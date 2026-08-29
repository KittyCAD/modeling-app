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
import { pickInSketch } from '@src/lib/sketch/hitTest'
import { previewOf } from '@src/lib/sketch/tools'
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
    return scale > 0 ? pickInSketch(shapes, where, 8 / scale) : null
  }

  const hovered = hoverIn(drawing, plane, size)

  const tool = sessions.tool.value
  const preview = drawable && tool ? previewOf(tool, pointer.at.value) : null

  const shape = (item: SketchShape, key: string, kind: string) => {
    const points = projectAll(flatten(item))
    if (!points) return null

    return (
      <path
        key={key}
        class="zds-sketch__segment"
        data-kind={kind}
        data-freedom={item.freedom}
        data-construction={item.construction ? 'true' : undefined}
        data-hovered={
          hovered?.kind === 'segment' && hovered.id === item.id
            ? 'true'
            : undefined
        }
        d={pathFor(points)}
      />
    )
  }

  const vertex = (item: SketchVertex) => {
    const at = project(item.at)
    if (!at) return null

    return (
      <circle
        key={`vertex-${item.id}`}
        class="zds-sketch__vertex"
        data-freedom={item.freedom}
        data-hovered={
          hovered?.kind === 'vertex' && hovered.id === item.id
            ? 'true'
            : undefined
        }
        cx={at.x}
        cy={at.y}
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
      {drawing.shapes.map((item) => shape(item, `segment-${item.id}`, 'real'))}
      {preview ? shape(preview, 'preview', 'preview') : null}
      {drawing.vertices.map(vertex)}
    </svg>
  )
}
