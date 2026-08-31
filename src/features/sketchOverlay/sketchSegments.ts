import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector2,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial'
import type { ApiObjectId } from '@rust/kcl-lib/bindings/FrontendApi'
import { createArcPositions } from '@src/lib/sketch/arcPositions'
import {
  CONSTRUCTION_DASH_PX,
  CONSTRUCTION_GAP_PX,
  CONTROL_POLYGON_COLOR,
  POINT_SEGMENT_RADIUS,
  SEGMENT_WIDTH_PX,
  type SketchTheme,
  getPointSegmentScale,
  getSegmentColor,
  getSegmentLineWidth,
} from '@src/lib/sketch/appearance'
import type { SketchDrawing, SketchShape } from '@src/lib/sketch/drawing'

/**
 * The sketch, as THREE objects.
 *
 * A port of the existing app's `segments.ts`, narrowed to what it draws today —
 * lines, arcs, circles, points and a spline's control polygon — and keeping the
 * decisions that are not obvious from the outside:
 *
 * **Lines are `Line2`, not `Line`.** THREE's plain line material ignores
 * `linewidth` on almost every platform, so a 1.6px segment would be 1px. `Line2`
 * draws a line as a strip of triangles, which is also what makes a *screen-space*
 * width possible — a segment stays the same thickness however far the camera is.
 *
 * **Points are meshes scaled per frame**, not sprites. A sprite would keep its
 * size for free but cannot be picked analytically or coloured per state as
 * cheaply, and the scale is one multiply.
 *
 * **Nothing is depth-tested.** The whole sketch is drawn over a video of the
 * model; there is no depth buffer shared with it, so testing against this scene's
 * own depth would only let the sketch hide itself.
 */

/** Names, as the original spells them, so a hit or a hover can find a part. */
export const STRAIGHT_SEGMENT_BODY = 'STRAIGHT_SEGMENT_BODY'
export const ARC_SEGMENT_BODY = 'ARC_SEGMENT_BODY'
export const POINT_SEGMENT_BODY = 'POINT_SEGMENT_BODY'

/** Draw order within the sketch: points sit above the curves they end. */
const RENDER_ORDER = { curve: 0, point: 10 }

export interface SegmentAppearance {
  theme: SketchTheme
  /** Segment ids the tool has not committed yet. */
  drafts: ReadonlySet<ApiObjectId>
  hoveredId: ApiObjectId | null
  /** What is selected. Coloured over the freedom colours, but under a hover. */
  selected: ReadonlySet<ApiObjectId>
}

const materialFor = (
  color: string,
  width: number,
  dashed: boolean,
  viewport: { width: number; height: number }
) =>
  new LineMaterial({
    color,
    // Device pixels, because that is what `LineMaterial` measures in.
    linewidth: width * window.devicePixelRatio,
    dashed,
    dashSize: CONSTRUCTION_DASH_PX,
    gapSize: CONSTRUCTION_GAP_PX,
    // Screen space, so a dash is the same length at every zoom — the thing the
    // original writes a custom shader to guarantee.
    worldUnits: false,
    /*
     * The *canvas* size, not the window's.
     *
     * `LineMaterial` turns a pixel width into clip space with this, so it has to
     * be the surface being drawn on. The original passes the window, which is
     * right there because its canvas fills it and wrong here because ours is one
     * pane of several — lines came out thinner than asked for by whatever
     * fraction of the window the viewport happened to be.
     */
    resolution: new Vector2(viewport.width, viewport.height),
    depthTest: false,
    depthWrite: false,
  })

/** A curve's points, in the sketch's own two dimensions. */
function positionsOf(shape: SketchShape): number[] {
  switch (shape.kind) {
    case 'line':
      return [shape.from.x, shape.from.y, 0, shape.to.x, shape.to.y, 0]

    case 'polyline':
      return shape.points.flatMap((point) => [point.x, point.y, 0])

    case 'circle':
      return createArcPositions({
        center: [shape.center.x, shape.center.y],
        radius: shape.radius,
        startAngle: 0,
        endAngle: Math.PI * 2,
        ccw: true,
      })

    case 'arc': {
      const startAngle = Math.atan2(
        shape.start.y - shape.center.y,
        shape.start.x - shape.center.x
      )
      const endAngle = Math.atan2(
        shape.end.y - shape.center.y,
        shape.end.x - shape.center.x
      )

      return createArcPositions({
        center: [shape.center.x, shape.center.y],
        radius: shape.radius,
        startAngle,
        endAngle,
        ccw: !shape.clockwise,
      })
    }
  }
}

const bodyNameFor = (shape: SketchShape) =>
  shape.kind === 'line' || shape.kind === 'polyline'
    ? STRAIGHT_SEGMENT_BODY
    : ARC_SEGMENT_BODY

/**
 * Draw one sketch into a group, replacing whatever was there.
 *
 * Rebuilt rather than diffed, and that is a deliberate simplification of the
 * original — which keeps a group per segment and updates its geometry in place.
 * It can, because it owns a stable id per segment across solves; we get a whole
 * new graph from every solve and `invalidates_ids` can renumber everything, so a
 * diff would be a cache keyed on something that is allowed to change underneath
 * it. Rebuilding a few dozen line strips per solve is cheaper than being wrong
 * about that.
 */
export function drawSketch(
  group: Group,
  drawing: SketchDrawing,
  appearance: SegmentAppearance,
  viewport: { width: number; height: number }
): void {
  clear(group)

  for (const shape of drawing.shapes) {
    const positions = positionsOf(shape)
    if (positions.length < 6) continue

    const isDraft = appearance.drafts.has(shape.id)
    const isHovered = appearance.hoveredId === shape.id
    const isSelected = appearance.selected.has(shape.id)
    const owned = shape.kind === 'polyline'

    const geometry = new LineGeometry()
    geometry.setPositions(positions)

    const material = materialFor(
      // A spline's control polygon is scenery rather than geometry, so it keeps
      // the original's own grey instead of taking part in the freedom colours.
      owned
        ? CONTROL_POLYGON_COLOR
        : getSegmentColor({
            isDraft,
            isHovered,
            isSelected,
            freedom: shape.freedom,
            theme: appearance.theme,
          }),
      owned
        ? Math.max(1, SEGMENT_WIDTH_PX * 0.65)
        : getSegmentLineWidth({ isHovered }),
      shape.construction,
      viewport
    )
    if (owned) {
      material.transparent = true
      material.opacity = 0.45
    }

    const line = new Line2(geometry, material)
    line.name = bodyNameFor(shape)
    line.userData = { segmentId: shape.id }
    line.renderOrder = RENDER_ORDER.curve
    // `Line2` computes its own bounds from the geometry, and without this a
    // segment can be frustum-culled while still on screen.
    line.computeLineDistances()
    group.add(line)
  }

  for (const vertex of drawing.vertices) {
    const isHovered = appearance.hoveredId === vertex.id
    const isSelected = appearance.selected.has(vertex.id)

    /*
     * A unit circle, scaled per frame rather than built at a size.
     *
     * A point has to stay the same number of pixels across as the camera zooms,
     * and the geometry cannot be rebuilt that often — so its radius is one and
     * the scale carries the pixel size. The pixel radius is remembered on the
     * object so `scalePoints` can reapply it whenever the camera moves, which is
     * how the original keeps its own point handles a constant size.
     */
    const pixelRadius =
      POINT_SEGMENT_RADIUS * getPointSegmentScale({ isHovered })

    const point = new Mesh(
      new CircleGeometry(1, 12),
      new MeshBasicMaterial({
        color: getSegmentColor({
          isHovered,
          isSelected,
          freedom: vertex.freedom,
          theme: appearance.theme,
        }),
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
      })
    )
    point.position.set(vertex.at.x, vertex.at.y, 0)
    point.name = POINT_SEGMENT_BODY
    point.userData = { pointId: vertex.id, pixelRadius }
    point.renderOrder = RENDER_ORDER.point
    group.add(point)
  }
}

/**
 * Resize the points for the camera.
 *
 * Called on every camera echo, which is why it walks the group rather than
 * redrawing it: the sketch has not changed shape, only how big a pixel is, and
 * rebuilding every line strip fifteen times a second to move a point by a
 * fraction of a millimetre would be absurd.
 */
export function scalePoints(group: Group, unitsPerPixel: number): void {
  for (const child of group.children) {
    const pixelRadius = child.userData?.pixelRadius
    if (typeof pixelRadius !== 'number') continue
    child.scale.setScalar(pixelRadius * unitsPerPixel)
  }
}

/**
 * Tell the line materials how big the canvas is.
 *
 * `LineMaterial` needs this to turn a pixel width into clip space, so a resize
 * that did not update it would leave every segment the thickness it was at the
 * old size.
 */
export function resizeLines(
  group: Group,
  viewport: { width: number; height: number }
): void {
  for (const child of group.children) {
    if (!(child instanceof Line2)) continue
    const material = child.material
    if (material instanceof LineMaterial) {
      material.resolution.set(viewport.width, viewport.height)
    }
  }
}

/** Empty a group, disposing what it held. */
export function clear(group: Group): void {
  for (const child of [...group.children]) {
    group.remove(child)

    // THREE holds GPU resources outside the reach of the garbage collector, so
    // dropping the reference is not enough: a sketch redrawn on every solve would
    // leak a geometry and a material per segment per keystroke.
    if (child instanceof Line2 || child instanceof Mesh) {
      child.geometry.dispose()
      const material = child.material
      if (Array.isArray(material)) {
        for (const one of material) one.dispose()
      } else {
        material.dispose()
      }
    }
  }
}
