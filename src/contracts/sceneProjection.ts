import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ScenePoint } from '@src/contracts/scene'
import type {
  CameraFrame,
  PlaneFrame,
  PlanePoint,
  Vector3,
  ViewportSize,
} from '@src/lib/scene/projection'

export type {
  PlaneFrame,
  PlanePoint,
  Vector3,
} from '@src/lib/scene/projection'

/**
 * Where things are on screen.
 *
 * The third seam beside `cameraDriverService` and `scenePickerService`, and the
 * one a sketch cannot do without: drawing a segment over the scene means knowing
 * where its ends land in the panel, and only the thing rendering knows that.
 *
 * The streamed engine answers by *listening*. It reports its camera with every
 * drag and zoom, so the app can follow the camera without owning it — which is
 * what keeps orbiting available inside a sketch. A renderer in this process
 * would answer from its own camera immediately and be exact rather than one
 * echo behind.
 *
 * Everything here is in millimetres, because that is what the engine's world is.
 */
export interface SceneProjection {
  /** `engine`, for diagnostics. */
  readonly id: string
  /** False until a camera has been heard from. Nothing can be placed before then. */
  readonly ready: ReadonlySignal<boolean>
  /**
   * Bumps whenever the view changed.
   *
   * A counter, because what most consumers need is "redraw now": read it to
   * subscribe, then call `project`.
   */
  readonly epoch: ReadonlySignal<number>
  /**
   * The camera itself, for whoever has to build one of their own.
   *
   * This was deliberately absent, on the grounds that exposing the camera would
   * invite callers to re-implement the projection. That reasoning holds for
   * *placing* things — `project`, `unproject` and `orientationOf` are still what
   * a caller should reach for, and each exists so nobody has to do the arithmetic
   * twice. It does not hold for a second renderer drawing into the same view: a
   * projection matrix cannot be assembled out of point queries, and a THREE
   * camera needs the vantage, the centre, the roll and the frustum.
   *
   * Null until a camera has been heard from.
   */
  readonly frame: ReadonlySignal<CameraFrame | null>

  /**
   * Which way a world direction points on screen, and how far from the viewer.
   *
   * Orientation without position, in [-1, 1] on each axis. Separate from
   * `project` because what needs it is not in the scene: a view gizmo has no
   * place in the model, does not move when the model does, and has to keep
   * working when the camera is inside the geometry. All it shares with the scene
   * is which way round the camera is.
   *
   * Null until a camera has been heard from.
   */
  orientationOf(
    direction: Vector3
  ): { x: number; y: number; depth: number } | null
  /** Where a world point lands on the surface, in element pixels. */
  project(
    point: Vector3,
    viewport: ViewportSize
  ): { x: number; y: number } | null
  /** Where a point on the surface meets a plane, in that plane's coordinates. */
  unproject(at: ScenePoint, plane: PlaneFrame): PlanePoint | null
  /**
   * How many element pixels one plane unit covers, near a point.
   *
   * What turns a pointer tolerance in pixels into one in plane units, so picking
   * a segment stays two-dimensional arithmetic that no renderer takes part in.
   * Zero for a plane that is edge-on or off screen.
   */
  scaleOn(plane: PlaneFrame, near: PlanePoint, viewport: ViewportSize): number

  /**
   * Where a face is, when the file cannot say.
   *
   * A sketch on a standard plane carries its own frame in the artifact graph; a
   * sketch on the face of a solid does not, because the face's position is
   * something only the geometry kernel worked out. Asking is the only way to
   * find out, and it is a round trip, so it happens once when a sketch is opened.
   *
   * Null for an entity the renderer cannot place, which includes everything that
   * is not a planar face.
   */
  frameOf(entityId: string): Promise<PlaneFrame | null>
}

export const sceneProjectionContract = defineContract({
  sceneProjectionService: defineService<SceneProjection>('scene.projection'),
})

export const { sceneProjectionService } = sceneProjectionContract
