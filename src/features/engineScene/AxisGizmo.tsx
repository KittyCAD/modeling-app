import { useSignal } from '@preact/signals'
import { useService } from '@src/app/context'
import { commandService } from '@src/contracts/commands'
import type { StandardView } from '@src/contracts/scene'
import { sceneProjectionService } from '@src/contracts/sceneProjection'
import type { Vector3 } from '@src/lib/scene/projection'
import './viewGizmo.css'

/**
 * Which way round the model is, and a way to square it up — the axis version.
 *
 * Ported from the existing app, which draws it with a second THREE.js renderer,
 * its own orthographic camera, six meshes, six canvas-texture sprites and a
 * raycaster — about four hundred lines, and a WebGL context per viewport. None
 * of that is the gizmo; it is the cost of drawing the gizmo inside a 3D engine.
 *
 * What the gizmo actually needs is one thing: which way the camera is pointing.
 * We already have that, because the projection follows the engine's camera — so
 * this is six directions asked about, arranged in a circle, and it works for any
 * renderer that can answer the same question.
 *
 * The handles are real buttons. The existing app raycasts against sprites and
 * then rebuilds hover, cursor and click by hand; a button already has all three,
 * plus focus and a name a screen reader can read. Only the stems are drawn, and
 * they take no pointer events.
 */

/** The widget's radius in pixels. The existing app's 80px box, halved. */
const RADIUS = 40

/** How far out the handles sit, as a fraction of the radius. */
const REACH = 0.72

interface GizmoAxis {
  /** The named view that looks down this axis. */
  view: StandardView
  direction: Vector3
  /** X, Y or Z on the positive handle; the negative ones are unlabelled. */
  label: string | null
  /** For colouring: the axis this belongs to, positive or not. */
  axis: 'x' | 'y' | 'z'
  positive: boolean
  /** What the button says it does, for whoever hovers or reads it. */
  name: string
}

/**
 * The six, and which view each one asks for.
 *
 * The mapping is the existing app's, and it is the one that reads right: a
 * handle is a place to put the camera, so clicking the +X handle moves the
 * camera to +X and looks back down the axis — which is the view we call `right`.
 * +Y is therefore `back` rather than `front`, which looks wrong written down and
 * is correct on screen.
 */
const AXES: readonly GizmoAxis[] = [
  {
    view: 'right',
    direction: { x: 1, y: 0, z: 0 },
    label: 'X',
    axis: 'x',
    positive: true,
    name: 'Right',
  },
  {
    view: 'back',
    direction: { x: 0, y: 1, z: 0 },
    label: 'Y',
    axis: 'y',
    positive: true,
    name: 'Back',
  },
  {
    view: 'top',
    direction: { x: 0, y: 0, z: 1 },
    label: 'Z',
    axis: 'z',
    positive: true,
    name: 'Top',
  },
  {
    view: 'left',
    direction: { x: -1, y: 0, z: 0 },
    label: null,
    axis: 'x',
    positive: false,
    name: 'Left',
  },
  {
    view: 'front',
    direction: { x: 0, y: -1, z: 0 },
    label: null,
    axis: 'y',
    positive: false,
    name: 'Front',
  },
  {
    view: 'bottom',
    direction: { x: 0, y: 0, z: -1 },
    label: null,
    axis: 'z',
    positive: false,
    name: 'Bottom',
  },
]

interface PlacedAxis extends GizmoAxis {
  /** Pixels from the centre of the widget. */
  x: number
  y: number
  /** How far the direction points away from the viewer, in [-1, 1]. */
  depth: number
}

export function AxisGizmo() {
  const projection = useService(sceneProjectionService)
  const commands = useService(commandService)
  const hovered = useSignal<StandardView | null>(null)

  // Read so the gizmo turns with the camera.
  void projection.epoch.value

  const placed: PlacedAxis[] = []
  for (const axis of AXES) {
    const facing = projection.orientationOf(axis.direction)
    if (!facing) continue
    placed.push({
      ...axis,
      x: facing.x * RADIUS * REACH,
      y: facing.y * RADIUS * REACH,
      depth: facing.depth,
    })
  }

  // Nothing to point at until the scene has said where its camera is. An empty
  // widget would be a circle that looks broken rather than one that is waiting.
  if (placed.length === 0) return null

  /*
   * Farthest first, so the near handles cover the far ones.
   *
   * `depth` is how much of a direction points *away*, so the largest depth is
   * the axis pointing into the screen and has to be drawn first.
   */
  const order = [...placed].sort((a, b) => b.depth - a.depth)

  return (
    <div
      class="zds-gizmo"
      style={{ inlineSize: RADIUS * 2, blockSize: RADIUS * 2 }}
    >
      {/* Stems only. The handles are buttons on top, and a line nobody can
          click is a line that cannot get in their way. */}
      <svg class="zds-gizmo__stems" viewBox={`0 0 ${RADIUS * 2} ${RADIUS * 2}`}>
        {order.map((axis) => (
          <line
            key={`stem-${axis.view}`}
            class="zds-gizmo__stem"
            data-axis={axis.axis}
            data-positive={axis.positive ? 'true' : undefined}
            x1={RADIUS}
            y1={RADIUS}
            x2={RADIUS + axis.x}
            y2={RADIUS + axis.y}
          />
        ))}
      </svg>

      {order.map((axis) => (
        <button
          key={axis.view}
          type="button"
          class="zds-gizmo__handle"
          data-axis={axis.axis}
          data-positive={axis.positive ? 'true' : undefined}
          data-hovered={hovered.value === axis.view ? 'true' : undefined}
          style={{
            // Placed from the centre, so a handle keeps its own size whatever
            // the camera does.
            insetInlineStart: RADIUS + axis.x,
            insetBlockStart: RADIUS + axis.y,
          }}
          aria-label={`${axis.name} view`}
          onPointerEnter={() => {
            hovered.value = axis.view
          }}
          onPointerLeave={() => {
            hovered.value = null
          }}
          onClick={() => commands.run(`camera.view.${axis.view}`)}
        >
          {axis.label}
        </button>
      ))}
    </div>
  )
}
