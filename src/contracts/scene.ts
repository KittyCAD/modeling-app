import {
  appendValueSpec,
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import type { ContextMenuContribution } from '@src/contracts/contextMenu'
import type { PlaneFrame, Vector3 } from '@src/lib/scene/projection'
import { byOrder, dedupeById } from '@src/lib/registryOrdering'
import type { ComponentChildren } from 'preact'

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

/** The renderer-independent facts available when the scene menu opens. */
export interface SceneContextMenuContext {
  at: ScenePoint
}

export interface CameraGesture {
  kind: CameraGestureKind
  phase: 'start' | 'move' | 'end'
  at: ScenePoint
}

/**
 * A named viewpoint.
 *
 * The six axis views plus the isometric three-quarter, which is what "reset the
 * view" means: a direction, not a position. Where the camera ends up is the
 * renderer's business, because only it knows where the geometry is.
 */
export type StandardView =
  | 'top'
  | 'bottom'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'isometric'

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
  /**
   * Look from a named direction, and frame the scene from there.
   *
   * One call rather than "point the camera" plus "fit", because the two are one
   * intention and splitting them would let a renderer that charges per message
   * pay twice for something the user asked for once.
   */
  standardView(view: StandardView): void
  /**
   * Look at a plane from straight on, along its normal.
   *
   * The general form of `standardView`, and needed because a sketch plane is
   * rarely one of the seven: a sketch on the face of a swept solid is on a plane
   * with an arbitrary origin and orientation, and drawing on a surface seen at an
   * angle means every distance on screen lies about itself.
   *
   * Which side to look from is the normal's, and which way is up is the plane's
   * own `yAxis` — so the axes the sketch is measured in are the axes on screen,
   * and a horizontal constraint looks horizontal.
   *
   * Millimetres, like everything else that meets the renderer.
   */
  faceOn(plane: PlaneFrame): void
  /**
   * Look at what you are already looking at, from a given direction.
   *
   * Keeps the target and the distance and changes only where the camera stands,
   * which is what a view gizmo asks for: clicking a corner of the cube means
   * "from over there", not "somewhere else in the model".
   *
   * `up` is which way is up when you get there. A caller that does not care can
   * leave it out and get world Z, which is the existing app's default for
   * everything except the top and bottom faces.
   */
  lookFrom(direction: Vector3, up?: Vector3): void
  /** Frame everything there is. */
  zoomToFit(): void

  /**
   * Move the camera here rather than wherever it usually lives.
   *
   * Asked for by whoever is drawing *over* the scene and needs the view to answer
   * the pointer rather than to arrive a moment later. Sketching is the case: a
   * rubber band drawn from a camera that is one round trip behind reads as the
   * app being slow, however fast the solve was.
   *
   * A request rather than a fact, because whether it means anything depends on
   * the renderer. The streamed engine stops round-tripping the camera, moves it
   * locally and reports afterwards — so the overlay is exact and the *video* is
   * what lags. A renderer in this process is already local and honours this by
   * doing nothing.
   *
   * Reference-counted is deliberately *not* offered: exactly one thing at a time
   * has a reason to want this, and a count would hide the bug where two of them
   * disagree about who let go.
   */
  claimCamera(): void
  /** Give it back. */
  releaseCamera(): void
}

/**
 * Where in the scene something can be placed.
 *
 * Four edges and the whole surface. A zone is a *region of the viewport*, not a
 * layout: how several items share one edge is the zone's business, and an item
 * that needs to be somewhere specific within an edge says so with `order`.
 *
 * `fill` is for things drawn *over the geometry* rather than beside it — a
 * sketch overlay, a measurement annotation, a selection marquee. It differs from
 * the edges in one way that matters: its items do not take pointer events, and
 * anything in one that wants a click has to ask for it. An invisible sheet over
 * the whole viewport would otherwise swallow every orbit, which gets diagnosed
 * as "the camera is broken" rather than as a stacking order.
 *
 * Deliberately about the scene rather than about the engine. A local renderer
 * would host the same toolbar, the same view gizmo and the same measurement
 * readout, so none of them may know that today's frames arrive as video.
 */
export type SceneZone = 'top' | 'bottom' | 'start' | 'end' | 'fill'

/**
 * Something drawn over the scene.
 *
 * The same shape as a shell item, for the same reason: the surface that draws
 * geometry should not accumulate a list of every control that hovers above it.
 * A toolbar, a view gizmo, a units readout and a selection summary are all
 * contributions, and the viewport knows about none of them.
 */
export interface SceneItem {
  id: string
  zone: SceneZone
  /** Lower sorts earlier within a zone. */
  order?: number
  /** Omitted from the DOM entirely while false. */
  visible?: ReadonlySignal<boolean>
  /**
   * Must return a component element, not JSX that calls hooks inline.
   *
   * Items render inside the viewport's own component, so a hook called directly
   * in `render` would belong to the viewport — and its position in the hook
   * order would shift whenever the item list changed.
   */
  render: () => ComponentChildren
}

export const sceneContract = defineContract({
  sceneInteractionsValueSpec:
    appendValueSpec<SceneInteraction>('scene.interactions'),
  sceneItemsValueSpec: defineValueSpec<SceneItem, SceneItem[]>({
    name: 'scene.items',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
  sceneContextMenuItemsValueSpec: defineValueSpec<
    ContextMenuContribution<SceneContextMenuContext>,
    ContextMenuContribution<SceneContextMenuContext>[]
  >({
    name: 'scene.contextMenuItems',
    defaultValue: [],
    combine: (inputs) => byOrder(dedupeById(inputs)),
  }),
  cameraDriverService: defineService<CameraDriver>('scene.cameraDriver'),
})

export const {
  sceneInteractionsValueSpec,
  sceneItemsValueSpec,
  sceneContextMenuItemsValueSpec,
  cameraDriverService,
} = sceneContract
