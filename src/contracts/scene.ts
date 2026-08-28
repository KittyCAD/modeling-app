import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import type { ReadonlySignal } from '@preact/signals'

/**
 * Something that reacts to input over whatever surface the scene is drawn on.
 *
 * Deliberately says nothing about what that surface is. Today it is a `<video>`
 * carrying frames rendered on Zoo's engine; a local renderer would draw into a
 * canvas instead, and the camera, selection, and any measurement tool should not
 * be able to tell the difference.
 */
export interface SceneInteraction {
  id: string
  /** Lower attaches earlier, so an interaction can see events first. */
  order?: number
  /**
   * Bind to the element the scene is drawn on. Returns a disposer.
   *
   * Called again if the element is replaced, and disposed when the viewport
   * unmounts — an interaction must not assume it outlives the view.
   */
  attach: (element: HTMLElement) => (() => void) | void
}

/** What a drag means. `rotatetrackball` is the trackball orbit. */
export type CameraGestureKind = 'pan' | 'rotate' | 'rotatetrackball' | 'zoom'

/**
 * A point on the scene surface, and how big that surface was when it was read.
 *
 * Element pixels, from its top-left corner. Deliberately *not* the renderer's
 * pixels: the streamed engine renders at a clamped, multiple-of-four resolution
 * that rarely matches the panel, while a local renderer's canvas matches it
 * exactly. Which of those applies is the driver's business, so the size the
 * measurement was taken against travels with it.
 */
export interface ScenePoint {
  x: number
  y: number
  viewport: { width: number; height: number }
}

export interface CameraGesture {
  kind: CameraGestureKind
  phase: 'start' | 'move' | 'end'
  at: ScenePoint
}

export interface CameraZoomRequest {
  /** Already scaled for the device pixel ratio. Positive zooms in. */
  magnitude: number
  at: ScenePoint
}

/**
 * Whatever is actually drawing the scene.
 *
 * This is the seam that lets the camera outlive the renderer. Everything
 * upstream of it — which gesture a button and a modifier mean, what the
 * preferences are, pointer capture, touch, suppressing the context menu — is
 * true of any renderer. Everything downstream is not: the streamed engine takes
 * commands over a websocket in its own pixel space and charges a re-render *and*
 * a re-stream for each one, while a local renderer can follow the pointer every
 * frame and be asked where its camera is.
 *
 * Optional, and absent until something is rendering. A viewport with no driver is
 * not broken; it is a viewport with nothing in it.
 */
export interface CameraDriver {
  /** `engine`, for diagnostics. */
  readonly id: string
  /** False while there is nothing to talk to. Gestures are dropped. */
  readonly ready: ReadonlySignal<boolean>
  gesture(gesture: CameraGesture): void
  zoom(request: CameraZoomRequest): void
  /**
   * Draw with this projection, and keep drawing with it.
   *
   * Stated rather than asked for: a renderer that forgets — a remote scene
   * replaced, a context lost — is expected to restate this itself, because only
   * it knows when that happened.
   */
  setProjection(projection: CameraProjectionType): void
}

export const sceneContract = defineContract({
  sceneInteractionsValueSpec:
    appendValueSpec<SceneInteraction>('scene.interactions'),
  cameraDriverService: defineService<CameraDriver>('scene.cameraDriver'),
})

export const { sceneInteractionsValueSpec, cameraDriverService } = sceneContract
