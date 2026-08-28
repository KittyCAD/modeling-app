import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ScenePoint } from '@src/contracts/scene'
import type {
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
   * A counter rather than the camera itself, because what a drawing needs is
   * "redraw now" and exposing the camera would invite everything to re-implement
   * the projection. Read it to subscribe, then call `project`.
   */
  readonly epoch: ReadonlySignal<number>

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
