import type {
  CameraDragInteractionType,
  CameraViewState,
  ModelingCmdReq,
  Point3d,
} from '@kittycad/lib'
import {
  isModelingBatchResponse,
  isModelingResponse,
} from '@src/lib/kcSdkGuards'
import { isArray } from '@src/lib/utils'
import { getSketchCameraFrame } from '@src/clientSideScene/sketchCamera'
import { getLocalCameraSceneScale } from '@src/clientSideScene/cameraSceneScale'

import Hammer from 'hammerjs'
import type { Box3, Camera, Object3D } from 'three'
import { Matrix4 } from 'three'
import {
  Euler,
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Spherical,
  Vector2,
  Vector3,
} from 'three'

import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'

import {
  DEBUG_SHOW_INTERSECTION_PLANE,
  INTERSECTION_PLANE_LAYER,
  SKETCH_LAYER,
  ZOOM_MAGIC_NUMBER,
} from '@src/clientSideScene/sceneUtils'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import type { MouseGuard } from '@src/lib/cameraControls'
import { cameraMouseDragGuards } from '@src/lib/cameraControls'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { Signal as LegacySignal } from '@src/lib/signal'
import { reportRejection } from '@src/lib/trap'
import { err, isErr } from '@src/lib/trap'
import {
  engineStreamZoomToFit,
  engineViewIsometric,
  getNormalisedCoordinates,
  roundOff,
  uuidv4,
} from '@src/lib/utils'
import { deg2Rad } from '@src/lib/utils2d'
import { type ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  getDimensions,
  getResponseErrorMessage,
  type Subscription,
  type UnreliableSubscription,
} from '@src/lib/engineConnection/utils'

const ORTHOGRAPHIC_CAMERA_SIZE = 20
const EXPECTED_WORLD_COORD_SYSTEM = 'right_handed_up_z'

// Partial declaration; the front/back/left/right are handled differently.
enum StandardView {
  TOP = 'top',
  BOTTOM = 'bottom',
}

type interactionType = 'pan' | 'rotate' | 'zoom'

interface ThreeCamValues {
  position: Vector3
  quaternion: Quaternion
  zoom: number
  isPerspective: boolean
  target: Vector3
}

export type ReactCameraProperties =
  | {
      type: 'perspective'
      fov?: number
      position: [number, number, number]
      target: [number, number, number]
      quaternion: [number, number, number, number]
    }
  | {
      type: 'orthographic'
      zoom?: number
      position: [number, number, number]
      target: [number, number, number]
      quaternion: [number, number, number, number]
    }

export type CameraSyncDirection = 'clientToEngine' | 'engineToClient'

/** A point on screen, such as the center of a two-finger gesture. */
type ScreenPoint = {
  clientX: number
  clientY: number
  // MouseEvent, PointerEvent and WheelEvent have offsetX and offsetY, which
  // avoid getBoundingClientRect() when the target is the canvas.
  offsetX?: number
  offsetY?: number
  target?: EventTarget | null
}

/** What the camera needs from the local renderer, in the camera's world. */
interface LocalCameraScene {
  /** What zoom to fit frames. */
  getFitBounds(): Box3 | undefined
  /** What center view on selection centers on. */
  getSelectionBounds(): Box3 | undefined
}

class CameraFrame {
  private frame: number | null = null
  private callback: (() => void) | undefined

  send(callback: () => void) {
    this.callback = callback
    this.frame ??= requestAnimationFrame(this.flush)
  }

  flush = () => {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    const callback = this.callback
    this.callback = undefined
    callback?.()
  }

  reset() {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    this.callback = undefined
  }
}

export class CameraControls {
  engineCommandManager: ConnectionManager
  private _syncDirection: CameraSyncDirection = 'engineToClient'
  get syncDirection() {
    return this._syncDirection
  }
  set syncDirection(value: CameraSyncDirection) {
    if (value === this._syncDirection) return
    this.cancelPendingUpdates()
    this._syncDirection = value
  }
  localCameraMode = false
  private pendingSketchCamera: { faceId?: string } | undefined
  camera: PerspectiveCamera | OrthographicCamera
  target: Vector3
  domElement: HTMLCanvasElement
  isDragging: boolean
  wasDragging: boolean
  private orbitDragUpInverted = false
  hoverPickingDisabled = false
  mouseDownPosition: Vector2
  mouseNewPosition: Vector2
  worldDownPosition: Vector3
  cameraDown: Camera
  oldCameraState: undefined | CameraViewState
  reconnectCameraState: CameraViewState | undefined
  rotationSpeed = 0.3
  enableRotate = true
  enablePan = true
  enableZoom = true
  private readonly moveFrame = new CameraFrame()
  private readonly zoomFrame = new CameraFrame()
  private readonly hoverFrame = new CameraFrame()
  private readonly engineCameraFrame = new CameraFrame()
  private readonly reactCameraFrame = new CameraFrame()
  private cameraWriteVersion = 0
  lastPerspectiveFov = 45
  pendingZoom: number | null = null
  pendingRotation: Vector2 | null = null
  pendingPan: Vector3 | null = null
  interactionGuards: MouseGuard = cameraMouseDragGuards.Zoo
  isFovAnimationInProgress = false
  perspectiveFovBeforeOrtho = 45
  touchControlManager: HammerManager | null = null
  enableTouchControls = true
  getSettings: () => SettingsType
  private readonly getLocalScene: () => LocalCameraScene | null

  // NOTE: Duplicated state across Provider and singleton. Mapped from settingsMachine
  _setting_allowOrbitInSketchMode = false
  get isPerspective() {
    return this.camera instanceof PerspectiveCamera
  }

  /**
   * In local mode the client owns the camera, as in clientToEngine. The engine
   * has no camera then: the connection drops the camera commands sent to it.
   */
  private get effectiveCameraMode(): CameraSyncDirection | 'local' {
    return this.localCameraMode ? 'local' : this.syncDirection
  }

  private _zoomFocus: Vector3 | null = null // the position under the mouse when zooming, in world space
  private _zoomFocusPoint: ScreenPoint | null = null // where _zoomFocus is on screen

  // Converts a screen space coordinate to world space
  private screenToWorld(point: ScreenPoint, camera?: Camera): Vector3 {
    let x = point.offsetX
    let y = point.offsetY
    if (
      point.target !== this.domElement ||
      x === undefined ||
      y === undefined
    ) {
      // There are some divs over the canvas that change event.offsetX, so manually calculate it
      // We could just do this by default but the getBoundingClientRect() can be expensive
      const rect = this.domElement.getBoundingClientRect()
      x = point.clientX - rect.left
      y = point.clientY - rect.top
    }

    // Ideally we would have access to renderer drawing buffer size
    const width = this.domElement.clientWidth
    const height = this.domElement.clientHeight
    const ndc = new Vector3(
      (x / width) * 2 - 1,
      -(y / height) * 2 + 1,
      0 // NDC z: 0 (halfway between camera near and far)
    )
    return ndc.unproject(camera || this.camera)
  }

  /**
   * Normalize stream element coordinates into the "window" shape
   * that the engine expects.
   */
  private streamToEngineWindowCoordinates({
    clientX,
    clientY,
  }: {
    clientX: number
    clientY: number
  }) {
    const { left, top, width, height } = this.domElement.getBoundingClientRect()
    if (width === 0 || height === 0) {
      return { x: 0, y: 0 }
    }

    return {
      x: Math.round(
        ((clientX - left) / width) *
          this.engineCommandManager.streamDimensions.width
      ),
      y: Math.round(
        ((clientY - top) / height) *
          this.engineCommandManager.streamDimensions.height
      ),
    }
  }

  get engineCameraProjection(): CameraProjectionType {
    return this.camera instanceof OrthographicCamera
      ? 'orthographic'
      : 'perspective'
  }
  set engineCameraProjection(projection: CameraProjectionType) {
    if (projection === 'orthographic') {
      this.useOrthographicCamera()
    } else {
      this.usePerspectiveCamera(true).catch(reportRejection)
    }
  }

  private handleStart = () => {
    this._isCamMovingCallback(true)
  }
  private handleEnd = () => {
    this._isCamMovingCallback(false)
  }

  setCam = (camProps: ReactCameraProperties) => {
    if (
      camProps.type === 'perspective' &&
      this.camera instanceof OrthographicCamera
    ) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.usePerspectiveCamera()
    } else if (
      camProps.type === 'orthographic' &&
      this.camera instanceof PerspectiveCamera
    ) {
      this.useOrthographicCamera()
    }
    this.camera.position.set(...camProps.position)
    this.camera.quaternion.set(...camProps.quaternion)
    if (
      camProps.type === 'perspective' &&
      this.camera instanceof PerspectiveCamera
    ) {
      // not sure what to do here, calling dollyZoom here is buggy because it updates the position
      // at the same time
    } else if (
      camProps.type === 'orthographic' &&
      this.camera instanceof OrthographicCamera
    ) {
      this.camera.zoom = camProps.zoom || 1
    }
    this.camera.updateProjectionMatrix()
    this.update(true)
  }

  private queueEngineInteraction(frame: CameraFrame, callback: () => void) {
    const connection = this.engineCommandManager.connection
    frame.send(() => {
      if (
        this.syncDirection === 'engineToClient' &&
        this.engineCommandManager.connection === connection
      ) {
        callback()
      }
    })
  }

  private queueHoverCommand(cmd: EngineCommand) {
    this.queueEngineInteraction(this.hoverFrame, () => {
      this.engineCommandManager.sendSceneCommand(cmd).catch(reportRejection)
    })
  }

  updateEngineCamera = (threeValues: ThreeCamValues) => {
    this.cameraWriteVersion += 1
    const connection = this.engineCommandManager.connection
    const syncDirection = this.syncDirection
    const cmd: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        ...convertThreeCamValuesToEngineCam(
          threeValues,
          this.perspectiveFovBeforeOrtho || this.lastPerspectiveFov || 45
        ),
      },
    }
    this.engineCameraFrame.send(() => {
      if (
        this.syncDirection === syncDirection &&
        this.engineCommandManager.connection === connection
      ) {
        this.engineCommandManager.sendSceneCommand(cmd).catch(reportRejection)
      }
    })
  }

  cancelPendingUpdates() {
    this.moveFrame.reset()
    this.zoomFrame.reset()
    this.hoverFrame.reset()
    this.engineCameraFrame.reset()
    this.reactCameraFrame.reset()
  }

  doMove = (
    interaction: CameraDragInteractionType,
    coordinates: [number, number]
  ) => {
    const window = this.streamToEngineWindowCoordinates({
      clientX: coordinates[0],
      clientY: coordinates[1],
    })
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_move',
        interaction: interaction,
        window,
      },
      cmd_id: uuidv4(),
    })
  }

  safeLookAtTarget(up = new Vector3(0, 0, 1)) {
    const quaternion = _lookAt(this.camera.position, this.target, up)
    this.camera.quaternion.copy(quaternion)
    this.camera.updateMatrixWorld()
  }

  doZoom = (zoom: number) => {
    this.handleStart()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'default_camera_zoom',
        magnitude: (-1 * zoom) / window.devicePixelRatio,
      },
      cmd_id: uuidv4(),
    })
    this.handleEnd()
  }

  constructor(
    domElement: HTMLCanvasElement,
    engineCommandManager: ConnectionManager,
    getSettings: typeof this.getSettings,
    getLocalScene: typeof this.getLocalScene = () => null
  ) {
    this.engineCommandManager = engineCommandManager
    this.getSettings = getSettings
    this.getLocalScene = getLocalScene
    this.camera = new PerspectiveCamera()
    this.camera.up.set(0, 0, 1)
    this.camera.far = 20000
    this.target = new Vector3()
    this.domElement = domElement
    this.isDragging = false
    this.wasDragging = false
    this.mouseDownPosition = new Vector2()
    this.mouseNewPosition = new Vector2()
    this.worldDownPosition = new Vector3()
    this.cameraDown = this.camera.clone()

    this.domElement.addEventListener('pointerdown', this.onMouseDown)
    this.domElement.addEventListener('pointermove', this.onMouseMove)
    this.domElement.addEventListener('pointerup', this.onMouseUp)
    this.domElement.addEventListener('wheel', this.onMouseWheel)
    this.initTouchControls(this.enableTouchControls)

    this.onWindowResize()

    this.update()
    this._usePerspectiveCamera()

    type CallBackParam = Parameters<
      (
        | Subscription<
            'camera_drag_end' | 'default_camera_get_settings' | 'zoom_to_fit'
          >
        | UnreliableSubscription<'camera_drag_move' | 'default_camera_zoom'>
      )['callback']
    >[0]

    const cb = ({ data, type }: CallBackParam) => {
      const camSettings = data.settings
      this.camera.position.set(
        camSettings.pos.x,
        camSettings.pos.y,
        camSettings.pos.z
      )
      this.target.set(
        camSettings.center.x,
        camSettings.center.y,
        camSettings.center.z
      )

      const orientation = new Quaternion(
        camSettings.orientation.x,
        camSettings.orientation.y,
        camSettings.orientation.z,
        camSettings.orientation.w
      ).invert()

      const newUp = new Vector3(
        camSettings.up.x,
        camSettings.up.y,
        camSettings.up.z
      )

      this.camera.quaternion.set(
        orientation.x,
        orientation.y,
        orientation.z,
        orientation.w
      )

      this.camera.up.copy(newUp)
      this.camera.updateProjectionMatrix()
      if (this.camera instanceof PerspectiveCamera && camSettings.ortho) {
        this.useClientOrthographicCamera()
      }
      if (this.camera instanceof OrthographicCamera && !camSettings.ortho) {
        this._usePerspectiveCamera()
      }
      if (this.camera instanceof PerspectiveCamera && camSettings.fov_y) {
        this.camera.fov = camSettings.fov_y
      } else if (this.camera instanceof OrthographicCamera) {
        const fovY = camSettings.fov_y ?? this.perspectiveFovBeforeOrtho ?? 45
        const eyeOffset = this.camera.position.distanceTo(this.target)
        const height = viewHeightFactor(fovY) * eyeOffset
        this.camera.zoom = ORTHOGRAPHIC_CAMERA_SIZE / height
        this.camera.updateProjectionMatrix()
      }
      // This is authoritative engine state, not a new client camera gesture.
      // Notify local views without echoing projection or look-at commands.
      this.updateCameraClippingPlanes()
      this.notifyCameraSubscribers()
    }

    this.engineCommandManager.subscribeTo({
      event: 'camera_drag_end',
      callback: cb,
    })
    this.engineCommandManager.subscribeToUnreliable({
      event: 'default_camera_zoom',
      callback: cb,
    })
    this.engineCommandManager.subscribeTo({
      event: 'default_camera_get_settings',
      callback: cb,
    })
    this.engineCommandManager.subscribeTo({
      event: 'zoom_to_fit',
      callback: cb,
    })
    this.engineCommandManager.subscribeToUnreliable({
      event: 'camera_drag_move',
      callback: cb,
    })
  }

  // This is only needed for local, streamed camera gets this from engine.
  resetLocalCameraToDefaultView() {
    // An orthographic camera's zoom is only recalculated when switching from perspective,
    // so switch to perspective first if needed.
    if (this.camera instanceof OrthographicCamera) {
      this._usePerspectiveCamera()
    }
    // Set default view
    this.target.set(0, 0, 0)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(14, -14, 14)
    this.camera.lookAt(this.target)

    // Switch back if necessary or just update
    if (
      this.getSettings().modeling.cameraProjection.current === 'orthographic'
    ) {
      // This will convert the distance set above on the perspective camera to ortho zoom
      this.useOrthographicCamera()
    } else {
      this.onCameraChange()
    }
  }

  private _isCamMovingCallback: (isMoving: boolean) => void = () => {}
  setIsCamMovingCallback(cb: (isMoving: boolean) => void) {
    this._isCamMovingCallback = cb
  }

  public readonly cameraChange = new LegacySignal()

  /**
   * The client camera and engine stream must use the same normalized viewport
   * aspect. Deriving it from the displayed canvas also avoids racing a delayed
   * engine resize against a camera projection change.
   */
  private normalizedViewportAspect = () => {
    const displayWidth = this.domElement.clientWidth
    const displayHeight = this.domElement.clientHeight
    if (displayWidth > 0 && displayHeight > 0) {
      const { width, height } = getDimensions(displayWidth, displayHeight)
      return width / height
    }

    return (
      this.engineCommandManager.streamDimensions.width /
      this.engineCommandManager.streamDimensions.height
    )
  }

  onWindowResize = () => {
    const aspect = this.normalizedViewportAspect()
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = aspect
    } else if (this.camera instanceof OrthographicCamera) {
      this.camera.left = -ORTHOGRAPHIC_CAMERA_SIZE * aspect
      this.camera.right = ORTHOGRAPHIC_CAMERA_SIZE * aspect
      this.camera.top = ORTHOGRAPHIC_CAMERA_SIZE
      this.camera.bottom = -ORTHOGRAPHIC_CAMERA_SIZE
    }
    this.camera.updateProjectionMatrix()
  }

  onMouseDown = (event: PointerEvent) => {
    this.hoverFrame.reset()
    this.domElement.setPointerCapture(event.pointerId)
    this.isDragging = true
    // Reset the wasDragging flag to false when starting a new drag
    this.wasDragging = false
    this.setDragAnchor(event)
    // Match engine camera drag: keep horizontal direction stable for the
    // duration of the drag, even while crossing a pole.
    this.orbitDragUpInverted =
      new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).z < 0
    let interaction = this.getInteractionType(event)
    if (interaction === 'none') return
    this.handleStart()

    if (this.effectiveCameraMode === 'engineToClient') {
      const window = this.streamToEngineWindowCoordinates({
        clientX: event.clientX,
        clientY: event.clientY,
      })
      void this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'camera_drag_start',
          interaction,
          window,
        },
        cmd_id: uuidv4(),
      })
    }
  }

  /**
   * Anchors the drag at `point`: later moves are measured from its screen
   * position, the world position under it and the current camera.
   */
  private setDragAnchor(point: ScreenPoint) {
    this.mouseDownPosition.set(point.clientX, point.clientY)
    this.worldDownPosition = this.screenToWorld(point).clone()
    this.cameraDown = this.camera.clone()
  }

  onMouseMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      return
    }

    if (this.isDragging) {
      this.dragTo(event, this.getInteractionType(event))
    } else {
      /**
       * If we're not in sketch mode and not dragging, we can highlight entities
       * under the cursor. This recently moved from being handled in App.tsx.
       * This might not be the right spot, but it is more consolidated.
       */

      // Clear any previous drag state
      this.wasDragging = false
      if (this.syncDirection === 'engineToClient') {
        const newCmdId = uuidv4()

        // You can use raw JS to fetch the element from the DOM. We do not need to proxy a ref of a ref element on the DOM element
        // There will be only one of these in the page.
        const videoElement = <HTMLVideoElement>(
          document.getElementById('video-stream')
        )
        // Nonsense to do anything until the video stream is established.
        if (!videoElement) return

        const { x, y } = getNormalisedCoordinates(
          event,
          videoElement,
          this.engineCommandManager.streamDimensions
        )
        this.queueHoverCommand({
          type: 'modeling_cmd_req',
          cmd: {
            type: 'highlight_set_entity',
            selected_at_window: { x, y },
          },
          cmd_id: newCmdId,
        })
      }
    }
  }

  /** Moves the camera for a drag that onMouseDown started, by mouse or touch. */
  private dragTo(
    point: ScreenPoint,
    interaction: CameraDragInteractionType | 'none'
  ) {
    this.mouseNewPosition.set(point.clientX, point.clientY)
    const deltaMove = this.mouseNewPosition.clone().sub(this.mouseDownPosition)
    this.mouseDownPosition.copy(this.mouseNewPosition)

    if (interaction === 'none') {
      return
    }

    // If there's a valid interaction and the mouse is moving,
    // our past (and current) interaction was a drag.
    this.wasDragging = true

    if (this.effectiveCameraMode === 'engineToClient') {
      this.queueEngineInteraction(this.moveFrame, () => {
        this.doMove(interaction, [point.clientX, point.clientY])
      })
      return
    }

    if (this.effectiveCameraMode === 'local' && interaction === 'rotate') {
      orbitLocalCamera(
        this.camera,
        this.target,
        deltaMove,
        this.domElement,
        this.orbitDragUpInverted
      )
      this.update(true)
      return
    }

    // Else the client owns the camera, either with engine synchronization
    // for sketch mode or without it for local rendering.
    // Implement camera movement logic here based on deltaMove
    // For example, for rotating the camera around the target:
    if (
      interaction === 'rotate' ||
      (this.effectiveCameraMode === 'local' &&
        interaction === 'rotatetrackball')
    ) {
      this.pendingRotation = this.pendingRotation
        ? this.pendingRotation
        : new Vector2()
      this.pendingRotation.x += deltaMove.x
      this.pendingRotation.y += deltaMove.y
    } else if (interaction === 'zoom') {
      this.pendingZoom = this.pendingZoom ? this.pendingZoom : 1
      this.pendingZoom *= 1 + deltaMove.y * 0.01
    } else if (interaction === 'pan') {
      this.pendingPan = this.pendingPan ?? new Vector3()
      if (this.camera instanceof PerspectiveCamera) {
        const distance = this.camera.position.distanceTo(this.target)
        const panSpeed = (distance / 1000 / 45) * this.perspectiveFovBeforeOrtho
        this.pendingPan.x += -deltaMove.x * panSpeed
        this.pendingPan.y += deltaMove.y * panSpeed
      } else {
        const newPosition = this.screenToWorld(point, this.cameraDown)
        this.pendingPan = newPosition.sub(this.worldDownPosition)
      }
    }
    if (this.effectiveCameraMode === 'local') {
      this.update()
    }
  }

  onMouseUp = (event: PointerEvent) => {
    // A touch drag ends in Hammer's panend, after any momentum flick. A tap
    // never pans, so it ends here.
    if (event.pointerType !== 'touch' || !this.wasDragging) {
      this.onMouseUpInner(event)
    }
  }

  onMouseUpInner = (event: PointerEvent) => {
    // Deliver the final coalesced movement before ending the engine gesture.
    this.moveFrame.flush()
    this.zoomFrame.flush()
    this.domElement.releasePointerCapture(event.pointerId)
    this.isDragging = false
    this.handleEnd()
    if (this.effectiveCameraMode === 'engineToClient') {
      const interaction = this.getInteractionType(event)
      if (interaction === 'none') return
      const window = this.streamToEngineWindowCoordinates({
        clientX: event.clientX,
        clientY: event.clientY,
      })
      void this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'camera_drag_end',
          interaction,
          window,
        },
        cmd_id: uuidv4(),
      })
    }
  }

  onMouseWheel = (event: WheelEvent) => {
    const interaction = this.getInteractionType(event)
    if (interaction === 'none') return
    event.preventDefault()

    // TODO: find a better way than this clipping to +/- 100 to prevent the bug in #5120
    const deltaY = Math.max(-100, Math.min(100, event.deltaY))

    if (this.effectiveCameraMode === 'engineToClient') {
      if (interaction === 'zoom') {
        this.queueEngineInteraction(this.zoomFrame, () => {
          this.doZoom(deltaY)
        })
      } else {
        // This case will get handled when we add pan and rotate using Apple trackpad.
        console.error(
          `Unexpected interaction type for engineToClient wheel event: ${interaction}`
        )
      }
      return
    }

    // Else the client owns the camera, either with engine synchronization
    // for sketch mode or without it for local rendering.

    // We need to simulate similar behavior as when we send
    // zoom commands to engine. This means dropping some zoom
    // commands too.
    // From onMouseMove zoom handling which seems to be really smooth

    this.handleStart()
    if (interaction === 'zoom') {
      this.pendingZoom = 1 + (deltaY / window.devicePixelRatio) * 0.001

      // Record the world point under the mouse so we can keep it anchored during zoom.
      // Only orthographic zoom uses it; perspective zooms toward the target.
      if (this.camera instanceof OrthographicCamera) {
        this._zoomFocus = this.screenToWorld(event)
        this._zoomFocusPoint = event
      }
    } else {
      // This case will get handled when we add pan and rotate using Apple trackpad.
      console.error(
        `Unexpected interaction type for wheel event: ${interaction}`
      )
    }
    if (this.effectiveCameraMode === 'local') {
      this.update()
    }
    this.handleEnd()
  }

  private useClientOrthographicCamera = () => {
    if (this.camera instanceof OrthographicCamera) return false
    const { x: px, y: py, z: pz } = this.camera.position
    const { x: qx, y: qy, z: qz, w: qw } = this.camera.quaternion
    const oldCamUp = this.camera.up.clone()
    const aspect = this.normalizedViewportAspect()
    this.lastPerspectiveFov = this.camera.fov
    const { z_near, z_far } = calculateNearFarFromFOV(this.lastPerspectiveFov)
    this.camera = new OrthographicCamera(
      -ORTHOGRAPHIC_CAMERA_SIZE * aspect,
      ORTHOGRAPHIC_CAMERA_SIZE * aspect,
      ORTHOGRAPHIC_CAMERA_SIZE,
      -ORTHOGRAPHIC_CAMERA_SIZE,
      z_near,
      z_far
    )

    this.camera.up.copy(oldCamUp)
    this.camera.layers.enable(SKETCH_LAYER)
    if (DEBUG_SHOW_INTERSECTION_PLANE)
      this.camera.layers.enable(INTERSECTION_PLANE_LAYER)
    this.camera.position.set(px, py, pz)
    const distance = this.camera.position.distanceTo(this.target.clone())
    const fovFactor = 45 / this.lastPerspectiveFov
    this.camera.zoom =
      this.effectiveCameraMode === 'local'
        ? getLocalOrthoZoom(this.camera, distance, this.lastPerspectiveFov)
        : (ZOOM_MAGIC_NUMBER * fovFactor * 0.8) / distance

    this.camera.quaternion.set(qx, qy, qz, qw)
    this.camera.updateProjectionMatrix()
    return true
  }

  useOrthographicCamera = () => {
    if (!this.useClientOrthographicCamera()) return
    if (!this.localCameraMode) {
      this.engineCommandManager
        .sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'default_camera_set_orthographic' },
        })
        .catch(reportRejection)
    }
    this.onCameraChange()
  }
  private createPerspectiveCamera = () => {
    const { z_near, z_far } = calculateNearFarFromFOV(this.lastPerspectiveFov)
    const previousCamUp = this.camera.up.clone()
    const camera = new PerspectiveCamera(
      this.lastPerspectiveFov,
      this.normalizedViewportAspect(),
      z_near,
      z_far
    )
    camera.up.copy(previousCamUp)
    camera.layers.enable(SKETCH_LAYER)
    if (DEBUG_SHOW_INTERSECTION_PLANE)
      camera.layers.enable(INTERSECTION_PLANE_LAYER)

    return camera
  }
  private _usePerspectiveCamera = () => {
    const { x: px, y: py, z: pz } = this.camera.position
    const { x: qx, y: qy, z: qz, w: qw } = this.camera.quaternion
    this.camera = this.createPerspectiveCamera()

    this.camera.position.set(px, py, pz)
    this.camera.quaternion.set(qx, qy, qz, qw)
    const direction = new Vector3().subVectors(
      this.camera.position,
      this.target
    )
    direction.normalize()
  }
  async setCameraProjection(projection: CameraProjectionType): Promise<void> {
    if (projection === 'perspective') {
      await this.usePerspectiveCamera(true)
      return
    }

    if (this.localCameraMode) {
      this.useOrthographicCamera()
      return
    }
    if (this.camera instanceof OrthographicCamera) {
      await this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_set_orthographic',
        },
      })
      return
    }

    this.useOrthographicCamera()
  }

  usePerspectiveCamera = async (forceSend = false) => {
    this._usePerspectiveCamera()
    if (
      this.effectiveCameraMode !== 'local' &&
      (this.effectiveCameraMode !== 'engineToClient' || forceSend)
    ) {
      await this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_set_perspective',
          parameters: {
            fov_y:
              this.camera instanceof PerspectiveCamera ? this.camera.fov : 45,
          },
        },
      })
    }
    this.onCameraChange()
    this.update()
    return this.camera
  }

  dollyZoom = async (newFov: number) => {
    if (!(this.camera instanceof PerspectiveCamera)) {
      console.warn('Dolly zoom is only applicable to perspective cameras.')
      return
    }
    this.lastPerspectiveFov = newFov
    dollyZoomCamera(this.camera, this.target, newFov)

    this.onCameraChange()
    if (this.localCameraMode) return
    // Publish local camera state, but send only the final reliable command.
    this.engineCameraFrame.reset()
    await sendCameraCommand(this.engineCommandManager, {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_perspective_settings',
        ...convertThreeCamValuesToEngineCam(
          {
            isPerspective: true,
            position: this.camera.position,
            quaternion: this.camera.quaternion,
            zoom: this.camera.zoom,
            target: this.target,
          },
          this.perspectiveFovBeforeOrtho || this.lastPerspectiveFov || 45
        ),
        fov_y: newFov,
      },
    })
  }

  update = (forceUpdate = false) => {
    // If there are any changes that need to be applied to the camera, apply them here.

    let didChange = false
    if (this.pendingRotation) {
      this.rotateCamera(this.pendingRotation.x, this.pendingRotation.y)
      if (this.effectiveCameraMode === 'local') {
        this.safeLookAtTarget()
        // Update camera.up from the quaternion, which safeLookAtTarget just changed:
        // LocalRenderer aims its camera with up and lookAt.
        this.camera.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion)
      }
      this.pendingRotation = null // Clear the pending rotation after applying it
      didChange = true
    }

    if (this.pendingZoom) {
      if (this.camera instanceof PerspectiveCamera) {
        // move camera towards or away from the target
        const distance = this.camera.position.distanceTo(this.target)
        const newDistance = distance * this.pendingZoom
        const direction = this.camera.position
          .clone()
          .sub(this.target)
          .normalize()
        const newPosition = this.target
          .clone()
          .add(direction.multiplyScalar(newDistance))
        this.camera.position.copy(newPosition)

        this.camera.updateProjectionMatrix()
        this.pendingZoom = null // Clear the pending zoom after applying it
      } else {
        // TODO change ortho zoom
        this.camera.zoom = this.camera.zoom / this.pendingZoom
        this.pendingZoom = null

        this.camera.updateProjectionMatrix()
        // Keep mouse world point fixed during zoom (without this zooming is pivoted around the camera position,
        // regardless of current mouse position)
        if (this._zoomFocus && this._zoomFocusPoint) {
          // The new focused point in world space after zooming
          const newFocus = this.screenToWorld(this._zoomFocusPoint)
          const diff = this._zoomFocus.clone().sub(newFocus)
          this.camera.position.add(diff)
          this.target.add(diff)

          this._zoomFocus = null
          this._zoomFocusPoint = null
        }
      }
      didChange = true
    }

    if (this.pendingPan) {
      if (this.camera instanceof PerspectiveCamera) {
        // move camera left/right and up/down
        const forward = this.camera.position
          .clone()
          .sub(this.target)
          .normalize()
        const cameraQuaternion = this.camera.quaternion
        const up = new Vector3(0, 1, 0).applyQuaternion(cameraQuaternion)
        const right = new Vector3().crossVectors(up, forward)
        right.multiplyScalar(this.pendingPan.x)
        up.multiplyScalar(this.pendingPan.y)
        const newPosition = this.camera.position.clone().add(right).add(up)
        this.target.add(right)
        this.target.add(up)
        this.camera.position.copy(newPosition)
      } else {
        const newPos = this.cameraDown.position.clone().sub(this.pendingPan)
        const oldPos = this.camera.position.clone()
        this.camera.position.copy(newPos)
        this.target.add(this.camera.position.clone().sub(oldPos))
      }
      this.pendingPan = null
      didChange = true
    }

    // Update the camera's matrices
    this.camera.updateMatrixWorld()
    if (didChange || forceUpdate) {
      this.onCameraChange(forceUpdate)
    }

    // damping would be implemented here in update if we choose to add it.
  }

  rotateCamera = (deltaX: number, deltaY: number) => {
    const quat = new Quaternion().setFromUnitVectors(
      new Vector3(0, 0, 1),
      new Vector3(0, 1, 0)
    )
    const quatInverse = quat.clone().invert()

    const angleX = deltaX * this.rotationSpeed // rotationSpeed is a constant that defines how fast the camera rotates
    const angleY = deltaY * this.rotationSpeed

    // Convert angles to radians
    const radianX = MathUtils.degToRad(angleX)
    const radianY = MathUtils.degToRad(angleY)

    // Get the offset from the camera to the target
    const offset = new Vector3().subVectors(this.camera.position, this.target)

    // spherical is a y-up paradigm, need to conform to that for now
    offset.applyQuaternion(quat)

    // Convert offset to spherical coordinates
    const spherical = new Spherical().setFromVector3(offset)

    // Apply the rotations
    spherical.theta -= radianX
    spherical.phi -= radianY

    // Restrict the phi angle to avoid the camera flipping at the poles
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi))

    // Convert back to Cartesian coordinates
    offset.setFromSpherical(spherical)

    // put the offset back into the z-up paradigm
    offset.applyQuaternion(quatInverse)

    // Update the camera's position
    this.camera.position.copy(this.target).add(offset)

    // Look at the target
    this.camera.updateMatrixWorld()
  }

  async getCameraView(signal?: AbortSignal): Promise<CameraViewState | Error> {
    if (signal?.aborted) {
      return new Error('Camera capture cancelled')
    }
    if (this.effectiveCameraMode === 'local') {
      return getLocalCameraView(
        this.camera,
        this.target,
        this.lastPerspectiveFov
      )
    }

    const connection = this.engineCommandManager.connection
    const cmdId = uuidv4()
    const request = this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: cmdId,
      cmd: { type: 'default_camera_get_view' },
    })

    const cancelRequest = () => {
      if (this.engineCommandManager.connection === connection) {
        this.engineCommandManager.rejectPendingCommand({
          cmdId,
          message: 'Camera capture cancelled',
        })
      }
    }

    signal?.addEventListener('abort', cancelRequest, { once: true })
    if (signal?.aborted) {
      cancelRequest()
    }

    const response = await request.finally(() => {
      signal?.removeEventListener('abort', cancelRequest)
    })

    // Check valid response from the engine.
    const singleResponse = isArray(response) ? response[0] : response
    if (!singleResponse || !isModelingResponse(singleResponse)) {
      return new Error('Failed to get camera view state: no valid response.')
    }
    if (!isModelingResponse(singleResponse)) {
      return new Error('Failed to get camera view state: wrong response type.')
    }
    const data = singleResponse.resp.data
    const noModelingResponse = !('modeling_response' in data)

    if (noModelingResponse) {
      return new Error(
        'Failed to get camera view state: no `modeling_response`.'
      )
    }

    // Check that we have the expected response type and the nested data.
    const modelingResponse = data.modeling_response
    const noData = !('data' in modelingResponse)
    const wrongResponseType =
      modelingResponse.type !== 'default_camera_get_view'

    if (noData || wrongResponseType) {
      return new Error('Failed to get camera view state: invalid response.')
    }

    return modelingResponse.data.view
  }

  async setCameraView(view: CameraViewState): Promise<void> {
    if (this.effectiveCameraMode === 'local') {
      await this.setLocalCameraView(view)
      return
    }

    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_view',
        view,
      },
    })

    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
  }

  /** Applies a view to the client camera as Camera::setView does in the engine. */
  private async setLocalCameraView(view: CameraViewState) {
    this.lastPerspectiveFov = view.fov_y
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.fov = view.fov_y
    }
    await this.setCameraProjection(
      view.is_ortho ? 'orthographic' : 'perspective'
    )
    setLocalCameraPose(this.camera, this.target, view)
    this.onCameraChange()
  }

  /**
   * Points the camera from `vantage` at `center`, keeping its projection, as
   * the engine's default_camera_look_at does.
   */
  async lookAt(look: {
    center: Point3d
    vantage: Point3d
    up: Point3d
  }): Promise<void> {
    if (this.effectiveCameraMode === 'local') {
      lookAtLocalCamera(this.camera, this.target, look, this.lastPerspectiveFov)
      this.onCameraChange()
      return
    }

    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        ...look,
      },
    })
    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
  }

  /**
   * Frames the model without turning the camera, as the engine's zoom_to_fit
   * does. `padding` grows the model's bounds by that fraction of their size.
   */
  async zoomToFit({ padding }: { padding: number }): Promise<void> {
    if (this.effectiveCameraMode === 'local') {
      const bounds = this.getLocalScene()?.getFitBounds()
      if (bounds) {
        frameLocalCamera(
          this.camera,
          this.target,
          bounds,
          padding,
          this.lastPerspectiveFov,
          this.normalizedViewportAspect()
        )
        this.onCameraChange()
      }
      return
    }

    await engineStreamZoomToFit({
      engineCommandManager: this.engineCommandManager,
      padding,
    })
  }

  /**
   * Looks at the model from the isometric direction and frames it, as the
   * engine's view_isometric does.
   */
  async viewIsometric({ padding }: { padding: number }): Promise<void> {
    if (this.effectiveCameraMode === 'local') {
      const bounds = this.getLocalScene()?.getFitBounds()
      if (bounds) {
        // The engine's isometric view looks along (-1, 1, -1) with Z up.
        this.camera.quaternion.setFromRotationMatrix(
          new Matrix4().lookAt(
            new Vector3(1, -1, 1),
            new Vector3(),
            new Vector3(0, 0, 1)
          )
        )
        frameLocalCamera(
          this.camera,
          this.target,
          bounds,
          padding,
          this.lastPerspectiveFov,
          this.normalizedViewportAspect()
        )
        this.onCameraChange()
      }
      return
    }

    await engineViewIsometric({
      engineCommandManager: this.engineCommandManager,
      padding,
    })
  }

  /**
   * Looks at the center of the selection, or at the origin when nothing is
   * selected, keeping the view's direction and distance, as the engine's
   * default_camera_center_to_selection does.
   */
  async centerOnSelection(): Promise<void> {
    if (this.effectiveCameraMode === 'local') {
      const center =
        this.getLocalScene()?.getSelectionBounds()?.getCenter(new Vector3()) ??
        new Vector3()
      this.camera.position.add(center).sub(this.target)
      this.target.copy(center)
      this.onCameraChange()
      return
    }

    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_center_to_selection',
        camera_movement: 'vantage',
      },
    })
  }

  private async setCameraViewAlongZ(
    direction: StandardView,
    overrides?: { pivotPosition?: Point3d; eyeOffset?: number }
  ) {
    // Sets the camera view along the Z axis, giving us a top-down or bottom-up view.
    // The approach first retrieves current camera setup, then alters pivot params,
    // ultimately preserving other camera settings, e.g., ortho vs. perspective projection.

    // Note: this assumes right handed, Z-up, X positive to the right.
    const Z_AXIS_QUATERNIONS = {
      [StandardView.TOP]: { x: 0, y: 0, z: 0, w: 1 },
      [StandardView.BOTTOM]: { x: 1, y: 0, z: 0, w: 0 },
    } as const

    const cameraView = await this.getCameraView()

    if (err(cameraView)) {
      return
    }

    // Handle unexpected world coordinate system; should delete this eventually.
    if (cameraView.world_coord_system !== EXPECTED_WORLD_COORD_SYSTEM) {
      console.warn(
        `Camera is not in the expected ${EXPECTED_WORLD_COORD_SYSTEM} world coordinate system.
        Resulting view may not match expectations.`
      )
    }

    const cameraViewTarget: CameraViewState = {
      ...cameraView,
      pivot_rotation: Z_AXIS_QUATERNIONS[direction],
      pivot_position: overrides?.pivotPosition ?? {
        x: this.target.x,
        y: this.target.y,
        z: this.target.z,
      },
    }

    // `eye_offset` is the target-to-eye distance.
    if (overrides?.eyeOffset !== undefined) {
      cameraViewTarget.eye_offset = overrides.eyeOffset
    }

    await this.setCameraView(cameraViewTarget)
  }

  async updateCameraToAxis(
    axis: 'x' | 'y' | 'z' | '-x' | '-y' | '-z'
  ): Promise<void> {
    await this.setCameraToAxis({ axis })
  }

  async setCameraToAxis({
    axis,
    target,
    distance,
  }: {
    axis: 'x' | 'y' | 'z' | '-x' | '-y' | '-z'
    target?: Point3d
    distance?: number
  }): Promise<void> {
    const center = target ?? {
      x: this.target.x,
      y: this.target.y,
      z: this.target.z,
    }
    const eyeDistance = distance ?? this.camera.position.distanceTo(this.target)

    if (axis === 'z' || axis === '-z') {
      await this.setCameraViewAlongZ(
        axis === 'z' ? StandardView.TOP : StandardView.BOTTOM,
        { pivotPosition: center, eyeOffset: distance }
      )
      return
    }

    const vantage = { ...center }
    if (axis === 'x') {
      vantage.x += eyeDistance
    } else if (axis === 'y') {
      vantage.y += eyeDistance
    } else if (axis === '-x') {
      vantage.x -= eyeDistance
    } else if (axis === '-y') {
      vantage.y -= eyeDistance
    }

    await this.lookAt({ center, vantage, up: { x: 0, y: 0, z: 1 } })
  }

  async resetCameraPosition(): Promise<void> {
    await this.lookAt({
      center: this.target,
      vantage: {
        x: this.target.x,
        y: this.target.y - 128,
        z: this.target.z + 64,
      },
      up: { x: 0, y: 0, z: 1 },
    })
    await this.zoomToFit({ padding: 0.2 })
  }

  /**
   * A helper function that will override this.oldCameraState
   * with the current setting's camera projection. If these are desynced
   * that is okay but when the camera restores we want the user to be in the correct
   * camera projection which is the settings value. Not this old state.
   *
   * Gotcha: This is not to be confused with Named Views, those have correct state.
   */
  overrideOldCameraStateToPreventDesync() {
    if (!this.getSettings) {
      return
    }

    // Engine idle disconnection happened, we saved off the camera state
    // If the settings camera projection is different from the saved camera state we need to override it.
    const settings = this.getSettings()
    const cameraProjection = settings.modeling.cameraProjection.current
    const isOrtho = cameraProjection === 'orthographic' ? true : false

    if (this.oldCameraState) {
      // Leave a log to know when this desyncs
      console.log(`restoring camera projection setting:${cameraProjection}`)
      console.log(
        `oldCameraState projection:${isOrtho ? 'orthographic' : 'perspective'}, ortho_scaled_enabled:${this.oldCameraState.ortho_scale_enabled}`
      )

      if (this.oldCameraState.is_ortho !== isOrtho) {
        console.log(
          'oldCameraState is_ortho desynced',
          this.oldCameraState.is_ortho,
          isOrtho
        )
      }

      this.oldCameraState.is_ortho = isOrtho
      // Always keep this enabled!
      this.oldCameraState.ortho_scale_enabled = true
    }
  }

  async restoreRemoteCameraStateAndTriggerSync() {
    if (this.oldCameraState) {
      // Always write settings.modeling.cameraProjection to the restored camera view
      this.overrideOldCameraStateToPreventDesync()
      await this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_set_view',
          view: this.oldCameraState,
        },
      })
    }
    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
  }

  /**
   * After we successfully save the old camera state and then enable
   * it in the try connect loop, clear it. It shouldn't be set unless it idles
   */
  clearOldCameraState() {
    this.oldCameraState = undefined
  }

  async captureCameraForReconnect(
    signal: AbortSignal
  ): Promise<undefined | Error> {
    const connection = this.engineCommandManager.connection
    if (
      signal.aborted ||
      !connection ||
      connection.websocket?.readyState !== WebSocket.OPEN
    ) {
      return
    }

    this.reconnectCameraState = undefined
    const view = await this.getCameraView(signal)

    // Ignore the response after capture was cancelled or the connection changed.
    if (signal.aborted || this.engineCommandManager.connection !== connection) {
      return
    }

    if (isErr(view)) {
      return view
    }

    this.reconnectCameraState = view
  }

  saveRemoteCameraState(): Promise<void> {
    return new Promise((resolve, reject) => {
      // It's possible we've hit a disconnection, but the browser or nothing
      // indicates this, other than the amount of time between our request
      // and its response. Typically round-trip time is < 30ms. It seems safe
      // then to wait 1 magnitude of time before calling this request toasted.
      const timeoutId = setTimeout(reject, 300)
      ;(async () => {
        const cameraViewStateResponse =
          await this.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: { type: 'default_camera_get_view' },
          })
        if (!cameraViewStateResponse) return
        const r = isArray(cameraViewStateResponse)
          ? cameraViewStateResponse[0]
          : cameraViewStateResponse
        if (r && isModelingResponse(r)) {
          const mr = r.resp.data.modeling_response
          if ('data' in mr && 'view' in mr.data) {
            this.oldCameraState = mr.data.view
          }
        }

        clearTimeout(timeoutId)
        resolve()
      })().catch(reject)
    })
  }

  requestSketchCameraTransition(faceId?: string) {
    this.cancelSketchCameraTransition()
    this.pendingSketchCamera = { faceId }
  }

  cancelSketchCameraTransition() {
    this.pendingSketchCamera = undefined
  }

  /** Called once the sketch plane's world transform is available. */
  async transitionToSketch(sketch: Object3D, signal?: AbortSignal) {
    const request = this.pendingSketchCamera
    if (!request) return
    if (signal?.aborted) return Promise.reject(signal.reason)

    let faceCenter: Vector3 | undefined
    if (request.faceId) {
      const response = await this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: { type: 'face_get_center', object_id: request.faceId },
      })
      if (signal?.aborted) return Promise.reject(signal.reason)
      if (this.pendingSketchCamera !== request) return
      const single = isArray(response) ? response[0] : response
      const result =
        single && isModelingResponse(single)
          ? single.resp.data.modeling_response
          : undefined
      if (result?.type !== 'face_get_center') {
        return Promise.reject(new Error('Could not get the sketch face centre'))
      }
      const { pos } = result.data
      faceCenter = new Vector3(pos.x, pos.y, pos.z)
    }
    this.pendingSketchCamera = undefined

    const frame = getSketchCameraFrame(sketch, this.camera.position, faceCenter)
    this.pendingPan = null
    this.pendingRotation = null
    this.pendingZoom = null
    // In local mode this keeps the visible scale.
    this.useOrthographicCamera()
    if (!(this.camera instanceof OrthographicCamera)) return
    await this.setCameraToQuaternion(frame.quaternion, frame.target, {
      zoom: getLocalOrthoZoom(
        this.camera,
        frame.distance,
        this.lastPerspectiveFov
      ),
      distance: frame.distance,
    })
    this.enableRotate = this._setting_allowOrbitInSketchMode
  }

  async setCameraToQuaternion(
    targetQuaternion: Quaternion,
    targetPosition = new Vector3(),
    sketch?: { zoom: number; distance: number }
  ): Promise<void> {
    if (this.effectiveCameraMode === 'engineToClient')
      console.warn(
        'setCameraToQuaternion is not designed for engineToClient syncDirection.'
      )
    const distance =
      sketch?.distance ?? this.target.distanceTo(this.camera.position)
    this.camera.position
      .set(0, 0, 1)
      .applyQuaternion(targetQuaternion)
      .multiplyScalar(distance)
      .add(targetPosition)
    this.camera.up.set(0, 1, 0).applyQuaternion(targetQuaternion).normalize()
    this.camera.quaternion.copy(targetQuaternion)
    this.target.copy(targetPosition)
    if (sketch) this.camera.zoom = sketch.zoom
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
    this.onCameraChange()

    if (this.localCameraMode) return

    // A final reliable update must be acknowledged before handing control back
    // to the engine; a queued interactive frame is not a completion signal.
    this.engineCameraFrame.reset()
    await sendCameraCommand(this.engineCommandManager, {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        ...convertThreeCamValuesToEngineCam(
          {
            position: this.camera.position,
            quaternion: this.camera.quaternion,
            zoom: this.camera.zoom,
            isPerspective: this.isPerspective,
            target: this.target,
          },
          this.perspectiveFovBeforeOrtho || this.lastPerspectiveFov || 45
        ),
      },
    })
  }

  disableSketchMode() {
    return sendCameraCommand(this.engineCommandManager, {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'sketch_mode_disable' },
    })
  }

  snapToPerspectiveBeforeHandingBackControlToEngine = async () => {
    if (this.localCameraMode) {
      await this.disableSketchMode()
      this._usePerspectiveCamera()
      await this.dollyZoom(this.perspectiveFovBeforeOrtho)
      return
    }
    if (this.syncDirection === 'engineToClient') {
      console.warn(
        'animate To Perspective not design to work with engineToClient syncDirection.'
      )
    }
    const connection = this.engineCommandManager.connection
    const isCurrentOwner = () =>
      this.engineCommandManager.connection === connection &&
      this.syncDirection === 'clientToEngine'
    const ownershipError = new Error(
      'Camera ownership changed while exiting sketch mode'
    )
    const flushInput = () => {
      this.moveFrame.flush()
      this.zoomFrame.flush()
      this.engineCameraFrame.flush()
    }
    flushInput()
    let synchronizedVersion = this.cameraWriteVersion
    const drainInput = async () => {
      if (!isCurrentOwner()) return Promise.reject(ownershipError)
      flushInput()
      // An authoritative response must not discard a newer queued gesture.
      // Read back after its reliable write, including one sent by an earlier RAF.
      while (synchronizedVersion !== this.cameraWriteVersion) {
        synchronizedVersion = this.cameraWriteVersion
        await sendCameraCommand(this.engineCommandManager, {
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: { type: 'default_camera_get_settings' },
        })
        if (!isCurrentOwner()) return Promise.reject(ownershipError)
        flushInput()
      }
    }
    this.isFovAnimationInProgress = true
    try {
      const camera = this.createPerspectiveCamera()
      camera.position.copy(this.camera.position)
      camera.quaternion.copy(this.camera.quaternion)
      const target = this.target.clone()
      const fov = this.perspectiveFovBeforeOrtho
      dollyZoomCamera(camera, target, fov)
      await sendCameraCommands(this.engineCommandManager, [
        { cmd_id: uuidv4(), cmd: { type: 'sketch_mode_disable' } },
        {
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_perspective_settings',
            ...convertThreeCamValuesToEngineCam(
              {
                position: camera.position,
                quaternion: camera.quaternion,
                zoom: camera.zoom,
                isPerspective: true,
                target,
              },
              fov
            ),
            fov_y: fov,
          },
        },
        { cmd_id: uuidv4(), cmd: { type: 'default_camera_get_settings' } },
      ])
      await drainInput()
      if (this.camera instanceof PerspectiveCamera)
        this.lastPerspectiveFov = this.camera.fov
    } catch (failure) {
      try {
        await drainInput()
      } catch {
        // Preserve the original exit failure if its connection also retired.
      }
      return Promise.reject(failure)
    } finally {
      this.isFovAnimationInProgress = false
    }
  }

  get reactCameraProperties(): ReactCameraProperties {
    return {
      type: this.isPerspective ? 'perspective' : 'orthographic',
      [this.isPerspective ? 'fov' : 'zoom']:
        this.camera instanceof PerspectiveCamera
          ? this.camera.fov
          : this.camera.zoom,
      position: [
        roundOff(this.camera.position.x, 2),
        roundOff(this.camera.position.y, 2),
        roundOff(this.camera.position.z, 2),
      ],
      target: [
        roundOff(this.target.x, 2),
        roundOff(this.target.y, 2),
        roundOff(this.target.z, 2),
      ],
      quaternion: [
        roundOff(this.camera.quaternion.x, 2),
        roundOff(this.camera.quaternion.y, 2),
        roundOff(this.camera.quaternion.z, 2),
        roundOff(this.camera.quaternion.w, 2),
      ],
    }
  }
  reactCameraPropertiesCallback: (a: ReactCameraProperties) => void = () => {}
  setReactCameraPropertiesCallback = (
    cb: (a: ReactCameraProperties) => void
  ) => {
    this.reactCameraPropertiesCallback = cb
  }

  private updateCameraClippingPlanes = () => {
    const distance = this.target.distanceTo(this.camera.position)
    if (this.effectiveCameraMode === 'local') {
      updateLocalCameraDepth(this.camera, this.target, this.lastPerspectiveFov)
    } else if (
      this.camera.far / 2.1 < distance ||
      this.camera.far / 1.9 > distance
    ) {
      this.camera.far = distance * 2
      this.camera.near = distance / 10
      this.camera.updateProjectionMatrix()
    }
  }

  private notifyCameraSubscribers = () => {
    this.reactCameraFrame.send(() => {
      this.reactCameraPropertiesCallback(this.reactCameraProperties)
    })
    this.cameraChange.dispatch()
  }

  onCameraChange = (forceUpdate = false) => {
    this.updateCameraClippingPlanes()
    if (
      !this.localCameraMode &&
      (this.syncDirection === 'clientToEngine' || forceUpdate)
    ) {
      this.updateEngineCamera({
        quaternion: this.camera.quaternion,
        position: this.camera.position,
        zoom: this.camera.zoom,
        isPerspective: this.isPerspective,
        target: this.target,
      })
    }
    this.notifyCameraSubscribers()
  }
  getInteractionType = (
    event: PointerEvent | WheelEvent | MouseEvent
  ): CameraDragInteractionType | 'none' => {
    // We just need to send any start value to the engine for touch.
    // I chose "rotate" because it's the 1-finger gesture
    const initialInteractionType =
      'pointerType' in event && event.pointerType === 'touch'
        ? 'rotate'
        : _getInteractionType(
            this.interactionGuards,
            event,
            this.enablePan,
            this.enableRotate,
            this.enableZoom
          )
    if (
      initialInteractionType === 'rotate' &&
      this.getSettings?.().modeling.cameraOrbit.current === 'trackball'
    ) {
      return 'rotatetrackball'
    }
    return initialInteractionType
  }

  /**
   * Set up HammerJS, a small library for multi-touch listeners,
   * and use it for the camera controls if touch is available.
   *
   * Note: users cannot change touch controls; this implementation
   * treats them as distinct from the mouse control scheme. This is because
   * a device may both have mouse controls and touch available.
   *
   * TODO: Add support for sketch mode touch camera movements
   */
  private setUpTouchControls = (domElement: HTMLCanvasElement) => {
    /** Amount in px needed to pan before recognizer runs */
    const panDistanceThreshold = 3
    /** Amount in scale delta needed to pinch before recognizer runs */
    const zoomScaleThreshold = 0.01
    /**
     * Max speed a pinch can be moving (not the pinch but its XY drift) before it's considered a pan.
     * The closer to this value, the more we reduce the calculated zoom transformation to reduce jitter.
     */
    const velocityLimit = 0.5
    /** Amount of pixel delta of calculated zoom transform needed before we send to the engine */
    const normalizedScaleThreshold = 5
    const hammertime = new Hammer(domElement, {
      recognizers: [
        [Hammer.Pan, { pointers: 1, direction: Hammer.DIRECTION_ALL }],
        [
          Hammer.Pan,
          {
            event: 'doublepan',
            pointers: 2,
            direction: Hammer.DIRECTION_ALL,
            threshold: panDistanceThreshold,
          },
        ],
        [Hammer.Pinch, { enable: true, threshold: zoomScaleThreshold }],
      ],
    })

    // TODO: get the engine to coalesce simultaneous zoom/pan/orbit events,
    // then we won't have to worry about jitter at all. Local mode applies them
    // together in one client update, so this only affects the engine stream.
    // https://github.com/KittyCAD/engine/issues/3528
    hammertime.get('pinch').recognizeWith(hammertime.get('doublepan'))

    // Both renderers share drag ownership; local mode applies the orbit here.
    hammertime.on('pan', (ev) => {
      if (
        ev.maxPointers === 1 &&
        this.enableRotate &&
        this.effectiveCameraMode !== 'clientToEngine' &&
        ev.srcEvent instanceof PointerEvent
      ) {
        this.dragTo(ev.srcEvent, this.getInteractionType(ev.srcEvent))
      }
    })
    hammertime.on('panend pancancel', (ev) => {
      if (ev.srcEvent instanceof PointerEvent) this.onMouseUpInner(ev.srcEvent)
    })

    const centerOfHammerInput = (ev: HammerInput) => ({
      clientX: ev.center.x,
      clientY: ev.center.y,
    })

    // Pan gesture is a 2-finger gesture I named "doublepan". It follows the
    // center between the fingers. onMouseDown anchored the drag where the
    // second finger touched down, so re-anchor it at the center.
    hammertime.on('doublepanstart', (ev) => {
      this.setDragAnchor(centerOfHammerInput(ev))
    })
    hammertime.on('doublepan', (ev) => {
      // clientToEngine is sketch mode with the engine stream: no touch support yet.
      if (this.effectiveCameraMode !== 'clientToEngine' && this.enablePan) {
        const center = centerOfHammerInput(ev)
        this.dragTo(center, 'pan')
        // An orthographic pan uses the anchor's camera, so re-anchor after each
        // move to account for a pinch changing the zoom meanwhile.
        this.setDragAnchor(center)
      }
    })

    // Zoom is a pinch, which is very similar to a 2-finger pan
    // and must therefore be heuristically determined. My heuristics is:
    // A zoom should only occur if the gesture velocity is low and the scale delta is high
    let lastScale = 1
    hammertime.on('pinchmove', (ev) => {
      // Local mode zooms by the change in finger spread since the last event.
      if (this.effectiveCameraMode === 'local') {
        if (this.enableZoom) {
          const center = centerOfHammerInput(ev)
          this.pendingZoom = lastScale / ev.scale
          // Like the mouse wheel, orthographic zoom keeps the point under the
          // fingers in place; perspective zooms toward the target.
          if (this.camera instanceof OrthographicCamera) {
            this._zoomFocus = this.screenToWorld(center)
            this._zoomFocusPoint = center
          }
          this.update()
          // A pan in this gesture must start from the zoomed camera.
          this.setDragAnchor(center)
        }
        lastScale = ev.scale
        return
      }

      const scaleDelta = lastScale - ev.scale
      const isUnderVelocityLimit = ev.velocity < velocityLimit
      // The faster you move the less you zoom
      const velocityFactor =
        Math.abs(
          velocityLimit - Math.min(velocityLimit, Math.abs(ev.velocity))
        ) * 0.5
      const normalizedScale = Math.ceil(scaleDelta * 2000 * velocityFactor)
      const isOverNormalizedScaleLimit =
        Math.abs(normalizedScale) > normalizedScaleThreshold

      if (
        this.syncDirection === 'engineToClient' &&
        this.enableZoom &&
        isUnderVelocityLimit &&
        isOverNormalizedScaleLimit
      ) {
        this.queueEngineInteraction(this.zoomFrame, () => {
          this.doZoom(normalizedScale)
        })
        lastScale = ev.scale
      }
    })
    hammertime.on('pinchend pinchcancel', () => {
      lastScale = 1
    })

    hammertime.on('pinchend pinchcancel doublepanend', (event) => {
      this.onMouseUpInner(event.srcEvent as PointerEvent)
    })

    return hammertime
  }

  initTouchControls = (shouldEnable?: boolean) => {
    if (this.touchControlManager === null) {
      this.touchControlManager = this.setUpTouchControls(this.domElement)
    }

    this.touchControlManager.set({ enable: shouldEnable })
  }
}

// Pure function helpers

function calculateNearFarFromFOV(fov: number) {
  // const nearFarRatio = (fov - 3) / (45 - 3)
  // const z_near = 0.1 + nearFarRatio * (5 - 0.1)
  // const z_far = 1000 + nearFarRatio * (100000 - 1000)
  return { z_near: 0.01, z_far: 1000 }
}

const viewHeightFactor = (fov: number) => {
  /*       *
          /|
         / |
        /  |
       /   |
      /    | viewHeight/2
     /     |
    /      |
   /↙fov/2 |
  /________|
  \        |
   \._._._.|
  */
  return Math.tan(deg2Rad(fov / 2))
}

function dollyZoomCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  newFov: number
) {
  const direction = target.clone().sub(camera.position).normalize()
  const distance = camera.position.distanceTo(target)
  const scale = viewHeightFactor(camera.fov) / viewHeightFactor(newFov)
  camera.fov = newFov
  camera.updateProjectionMatrix()
  camera.position.copy(
    target.clone().add(direction.multiplyScalar(-distance * scale))
  )
}

function convertThreeCamValuesToEngineCam(
  { target, position, quaternion, zoom, isPerspective }: ThreeCamValues,
  perspectiveFovY = 45
): {
  center: Vector3
  up: Vector3
  vantage: Vector3
} {
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')

  const upVector = new Vector3(0, 1, 0).applyEuler(euler).normalize()
  if (isPerspective) {
    return {
      center: target.clone(),
      up: upVector,
      vantage: position.clone(),
    }
  }

  // Orthographic: derive engine eye_offset consistent with createProjectionMatrix
  const effectiveHalfHeight = ORTHOGRAPHIC_CAMERA_SIZE / zoom
  const eyeOffset = effectiveHalfHeight / viewHeightFactor(perspectiveFovY)

  const viewDir = position.clone().sub(target).normalize()
  const vantage = target.clone().add(viewDir.multiplyScalar(eyeOffset))

  return {
    center: target.clone(),
    up: upVector,
    vantage,
  }
}

function _getInteractionType(
  interactionGuards: MouseGuard,
  event: MouseEvent | WheelEvent,
  enablePan: boolean,
  enableRotate: boolean,
  enableZoom: boolean
): interactionType | 'none' {
  if (event instanceof WheelEvent) {
    if (enableZoom && interactionGuards.zoom.scrollCallback(event))
      return 'zoom'
  } else {
    if (enablePan && interactionGuards.pan.callback(event)) return 'pan'
    if (enableRotate && interactionGuards.rotate.callback(event))
      return 'rotate'
    if (enableZoom && interactionGuards.zoom.dragCallback(event)) return 'zoom'
  }
  return 'none'
}

/**
 * Enter sketch mode without camera animation, then synchronize the client camera
 * from the acknowledged engine settings.
 *
 * @param engineCommandManager Our websocket singleton
 * @param entityId - The ID of face or sketchPlane.
 */

export async function enterSketchModeAndSyncCamera(
  engineCommandManager: ConnectionManager,
  entityId: string,
  cameraControls?: CameraControls,
  onFace = false
) {
  if (engineCommandManager.geometryOnly) {
    if (!cameraControls)
      return Promise.reject(new Error('Missing local sketch camera'))
    cameraControls.requestSketchCameraTransition(onFace ? entityId : undefined)
    await sendCameraCommand(engineCommandManager, {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'enable_sketch_mode',
        adjust_camera: false,
        animated: false,
        ortho: true,
        entity_id: entityId,
      },
    })
    return
  }
  const requests: ModelingCmdReq[] = [
    {
      cmd_id: uuidv4(),
      cmd: {
        type: 'enable_sketch_mode',
        adjust_camera: true,
        animated: false,
        ortho: true,
        entity_id: entityId,
      },
    },
    {
      cmd_id: uuidv4(),
      cmd: { type: 'default_camera_get_settings' },
    },
  ]
  await sendCameraCommands(engineCommandManager, requests)
}

async function sendCameraCommands(
  engineCommandManager: ConnectionManager,
  requests: ModelingCmdReq[]
) {
  // The engine executes the batch in order and stops on the first failure.
  // The acknowledgements and subscribed camera update arrive in one trip.
  const response = await engineCommandManager
    .sendSceneCommand(
      {
        type: 'modeling_cmd_batch_req',
        batch_id: uuidv4(),
        requests,
        responses: true,
      },
      true
    )
    .catch((failure: unknown) =>
      Promise.reject(
        new Error(
          getResponseErrorMessage(
            failure,
            'Sketch camera batch was not acknowledged'
          )
        )
      )
    )
  const singleResponse = isArray(response) ? response[0] : response
  const responses =
    singleResponse &&
    typeof singleResponse === 'object' &&
    isModelingBatchResponse(singleResponse) &&
    singleResponse.success
      ? singleResponse.resp.data.responses
      : undefined
  for (const request of requests) {
    const result = responses?.[request.cmd_id]
    if (
      !result ||
      !('response' in result) ||
      result.response.type !== request.cmd.type
    ) {
      return Promise.reject(
        new Error(
          getResponseErrorMessage(
            result && 'errors' in result ? [result] : response,
            `Camera command ${request.cmd.type} was not acknowledged`
          )
        )
      )
    }
  }
}

async function sendCameraCommand(
  engineCommandManager: ConnectionManager,
  command: Extract<EngineCommand, { type: 'modeling_cmd_req' }>
): Promise<void> {
  // Final camera changes must use the acknowledged websocket path. Interactive
  // perspective updates otherwise use the unreliable channel and return null.
  const response = await engineCommandManager.sendSceneCommand(command, true)
  const singleResponse = isArray(response) ? response[0] : response
  if (
    !singleResponse ||
    typeof singleResponse !== 'object' ||
    !isModelingResponse(singleResponse) ||
    !singleResponse.success ||
    singleResponse.resp.data.modeling_response.type !== command.cmd.type
  ) {
    return Promise.reject(
      new Error(
        getResponseErrorMessage(
          response,
          `Camera command ${command.cmd.type} was not acknowledged`
        )
      )
    )
  }
}

function _lookAt(position: Vector3, target: Vector3, up: Vector3): Quaternion {
  // Direction from position to target, normalized.
  let direction = new Vector3().subVectors(target, position).normalize()

  // Calculate a new "effective" up vector that is orthogonal to the direction.
  // This step ensures that the up vector does not affect the direction the camera is looking.
  let right = new Vector3().crossVectors(direction, up).normalize()
  let orthogonalUp = new Vector3().crossVectors(right, direction).normalize()

  // Create a lookAt matrix using the position, and the recalculated orthogonal up vector.
  let lookAtMatrix = new Matrix4()
  lookAtMatrix.lookAt(position, target, orthogonalUp)

  // Create a quaternion from the lookAt matrix.
  let quaternion = new Quaternion().setFromRotationMatrix(lookAtMatrix)

  return quaternion
}

// Local mode helpers. The client camera stands in for the engine's, so these
// follow the engine's camera. Both look along the camera's local -Z with +Y up.
// `perspectiveFov` is the field of view an orthographic camera's zoom is
// measured against, as the engine keeps its fov_y in orthographic mode.

/**
 * Orbits like the engine's spherical orbit: dragging can continue through
 * both poles, unlike the cube gizmo's clamped rotation. `delta` is in pixels.
 */
function orbitLocalCamera(
  camera: Camera,
  target: Vector3,
  delta: Vector2,
  viewport: Pick<HTMLElement, 'clientWidth' | 'clientHeight'>,
  dragUpInverted: boolean
) {
  const rotation = camera.quaternion
  const worldUp = new Vector3(0, 0, 1)
  const back = new Vector3(0, 0, 1).applyQuaternion(rotation)
  const up = new Vector3(0, 1, 0).applyQuaternion(rotation)
  const distance = camera.position.distanceTo(target)

  // Remove roll for spherical orbit while retaining the current up/down
  // hemisphere. At a pole keep the existing orientation: lookAt is singular.
  if (Math.abs(back.dot(worldUp)) < 1 - 1e-10) {
    const upright = worldUp.clone().multiplyScalar(up.z < 0 ? -1 : 1)
    rotation.setFromRotationMatrix(
      new Matrix4().lookAt(back, new Vector3(), upright)
    )
  }

  const right = new Vector3(1, 0, 0).applyQuaternion(rotation)
  // Engine drag speeds are calibrated to a 1024 x 768 viewport.
  const yaw = MathUtils.degToRad(
    -delta.x *
      0.25 *
      (1024 / Math.max(viewport.clientWidth, 1)) *
      (dragUpInverted ? -1 : 1)
  )
  const pitch = MathUtils.degToRad(
    -delta.y * 0.25 * (768 / Math.max(viewport.clientHeight, 1))
  )
  rotation
    .premultiply(
      new Quaternion()
        .setFromAxisAngle(worldUp, yaw)
        .multiply(new Quaternion().setFromAxisAngle(right, pitch))
    )
    .normalize()

  camera.position.set(0, 0, distance).applyQuaternion(rotation).add(target)
  // The local renderer copies up as well as position; don't force Z-up here.
  camera.up.set(0, 1, 0).applyQuaternion(rotation)
}

/**
 * The zoom at which an orthographic camera shows what the engine's does from
 * `eyeOffset` away: a view 2 * tan(fovY / 2) * eyeOffset high.
 */
function getLocalOrthoZoom(
  camera: OrthographicCamera,
  eyeOffset: number,
  perspectiveFov: number
) {
  return (
    (camera.top - camera.bottom) /
    (2 * Math.max(eyeOffset, 0.001) * viewHeightFactor(perspectiveFov))
  )
}

/** The engine's eye offset for an orthographic camera's zoom. */
function getLocalOrthoEyeOffset(
  camera: OrthographicCamera,
  perspectiveFov: number
) {
  return (
    (camera.top - camera.bottom) /
    (2 * camera.zoom * viewHeightFactor(perspectiveFov))
  )
}

/** Places the camera at the engine's eye offset and clips as the engine does. */
function updateLocalCameraDepth(
  camera: PerspectiveCamera | OrthographicCamera,
  target: Vector3,
  perspectiveFov: number
) {
  let eyeOffset = camera.position.distanceTo(target)
  if (camera instanceof OrthographicCamera) {
    // Match engine orthographic zoom, derived from FOV and eye distance.
    // Keep these in sync so entry/exit preserves zoom after wheel navigation.
    eyeOffset = getLocalOrthoEyeOffset(camera, perspectiveFov)
    camera.position.sub(target).setLength(eyeOffset).add(target)
    camera.updateMatrixWorld()
  }
  const scale = getLocalCameraSceneScale(eyeOffset)
  // Match engine clipping, including the mirrored orthographic near plane.
  // Distances here are in mm.
  const far = scale * 10000
  const near = camera instanceof OrthographicCamera ? -far : scale
  if (camera.near !== near || camera.far !== far) {
    camera.near = near
    camera.far = far
    camera.updateProjectionMatrix()
  }
}

/**
 * The camera's view as the engine's Camera::getView describes its own: the
 * camera looks along its local -Z from eye_offset away on its local +Z.
 */
function getLocalCameraView(
  camera: PerspectiveCamera | OrthographicCamera,
  target: Vector3,
  perspectiveFov: number
): CameraViewState {
  const { quaternion } = camera
  const isOrtho = camera instanceof OrthographicCamera
  const fovY = isOrtho ? perspectiveFov : camera.fov
  // An orthographic view's height comes from the eye offset, as in the
  // engine; updateLocalCameraDepth() keeps the camera that far away.
  const eyeOffset = isOrtho
    ? getLocalOrthoEyeOffset(camera, fovY)
    : camera.position.distanceTo(target)
  return {
    pivot_rotation: {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    },
    pivot_position: { x: target.x, y: target.y, z: target.z },
    eye_offset: eyeOffset,
    fov_y: fovY,
    is_ortho: isOrtho,
    // The engine's camera has none of these, and its views always carry the
    // defaults.
    ortho_scale_factor: 1.6,
    ortho_scale_enabled: true,
    world_coord_system: EXPECTED_WORLD_COORD_SYSTEM,
  }
}

/**
 * Applies a view's pose, and its scale to an orthographic camera, as the
 * engine's Camera::setView does. The caller sets the projection first.
 */
function setLocalCameraPose(
  camera: PerspectiveCamera | OrthographicCamera,
  target: Vector3,
  view: CameraViewState
) {
  const { pivot_rotation: rotation, pivot_position: pivot } = view
  target.set(pivot.x, pivot.y, pivot.z)
  camera.quaternion
    .set(rotation.x, rotation.y, rotation.z, rotation.w)
    .normalize()
  camera.position
    .set(0, 0, view.eye_offset)
    .applyQuaternion(camera.quaternion)
    .add(target)
  // The local renderer orients its camera from up, position and target.
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion)
  if (camera instanceof OrthographicCamera) {
    camera.zoom = getLocalOrthoZoom(camera, view.eye_offset, view.fov_y)
  }
  camera.updateProjectionMatrix()
}

/**
 * Points the camera from `vantage` at `center` as the engine's lookAt does. An
 * orthographic camera shows what the engine's would from that distance.
 */
function lookAtLocalCamera(
  camera: PerspectiveCamera | OrthographicCamera,
  target: Vector3,
  { center, vantage, up }: { center: Point3d; vantage: Point3d; up: Point3d },
  perspectiveFov: number
) {
  target.set(center.x, center.y, center.z)
  camera.position.set(vantage.x, vantage.y, vantage.z)
  camera.up.set(up.x, up.y, up.z)
  camera.lookAt(target)
  // The local renderer orients its camera from up, position and target.
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion)
  if (camera instanceof OrthographicCamera) {
    camera.zoom = getLocalOrthoZoom(
      camera,
      camera.position.distanceTo(target),
      perspectiveFov
    )
  }
  camera.updateProjectionMatrix()
}

/**
 * Frames `bounds` without turning the camera, as the engine's
 * Camera::frameObject does. The bounds grow by `padding` times their size.
 * Half their diagonal then fills half the view's height, or half its width
 * when the viewport is taller than it is wide.
 */
function frameLocalCamera(
  camera: PerspectiveCamera | OrthographicCamera,
  target: Vector3,
  bounds: Box3,
  padding: number,
  perspectiveFov: number,
  aspect: number
) {
  const fov = camera instanceof PerspectiveCamera ? camera.fov : perspectiveFov
  const radius = 0.5 * (1 + padding) * bounds.getSize(new Vector3()).length()
  let eyeOffset = radius / viewHeightFactor(fov)
  if (aspect < 1) {
    eyeOffset /= aspect
  }
  bounds.getCenter(target)
  camera.position
    .set(0, 0, eyeOffset)
    .applyQuaternion(camera.quaternion)
    .add(target)
  // The local renderer orients its camera from up, position and target.
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion)
  if (camera instanceof OrthographicCamera) {
    camera.zoom = getLocalOrthoZoom(camera, eyeOffset, perspectiveFov)
  }
  camera.updateProjectionMatrix()
}
