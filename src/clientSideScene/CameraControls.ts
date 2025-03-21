import type { CameraDragInteractionType_type } from '@kittycad/lib/dist/types/src/models'
import * as TWEEN from '@tweenjs/tween.js'
import {
  Euler,
  MathUtils,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Spherical,
  Vector2,
  Vector3,
} from 'three'

import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'

import { isQuaternionVertical } from '@src/clientSideScene/helpers'
import {
  DEBUG_SHOW_INTERSECTION_PLANE,
  INTERSECTION_PLANE_LAYER,
  SKETCH_LAYER,
  ZOOM_MAGIC_NUMBER,
} from '@src/clientSideScene/sceneUtils'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import type {
  EngineCommandManager,
  Subscription,
  UnreliableSubscription,
} from '@src/lang/std/engineConnection'
import type { MouseGuard } from '@src/lib/cameraControls'
import { cameraMouseDragGuards } from '@src/lib/cameraControls'
import { reportRejection } from '@src/lib/trap'
import {
  getNormalisedCoordinates,
  isReducedMotion,
  roundOff,
  throttle,
  toSync,
  uuidv4,
} from '@src/lib/utils'
import { deg2Rad } from '@src/lib/utils2d'

const ORTHOGRAPHIC_CAMERA_SIZE = 20
const FRAMES_TO_ANIMATE_IN = 30
const ORTHOGRAPHIC_MAGIC_FOV = 4

const tempQuaternion = new Quaternion() // just used for maths

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

const lastCmdDelay = 50

class CameraRateLimiter {
  lastSend?: Date = undefined
  rateLimitMs: number = 16 //60 FPS

  send = (f: () => void) => {
    let now = new Date()

    if (
      this.lastSend === undefined ||
      now.getTime() - this.lastSend.getTime() > this.rateLimitMs
    ) {
      f()
      this.lastSend = now
    }
  }

  reset = () => {
    this.lastSend = undefined
  }
}

export class CameraControls {
  engineCommandManager: EngineCommandManager
  syncDirection: 'clientToEngine' | 'engineToClient' = 'engineToClient'
  camera: PerspectiveCamera | OrthographicCamera
  target: Vector3
  domElement: HTMLCanvasElement
  isDragging: boolean
  wasDragging: boolean
  mouseDownPosition: Vector2
  mouseNewPosition: Vector2
  oldCameraState: undefined | CameraViewState_type
  rotationSpeed = 0.3
  enableRotate = true
  enablePan = true
  enableZoom = true
  moveSender: CameraRateLimiter = new CameraRateLimiter()
  zoomSender: CameraRateLimiter = new CameraRateLimiter()
  lastPerspectiveFov: number = 45
  pendingZoom: number | null = null
  pendingRotation: Vector2 | null = null
  pendingPan: Vector2 | null = null
  interactionGuards: MouseGuard = cameraMouseDragGuards.Zoo
  isFovAnimationInProgress = false
  perspectiveFovBeforeOrtho = 45

  // NOTE: Duplicated state across Provider and singleton. Mapped from settingsMachine
  _setting_allowOrbitInSketchMode = false
  get isPerspective() {
    return this.camera instanceof PerspectiveCamera
  }

  setEngineCameraProjection(projection: CameraProjectionType) {
    if (projection === 'orthographic') {
      this.useOrthographicCamera()
    } else {
      this.usePerspectiveCamera(true).catch(reportRejection)
    }
  }

  handleStart = () => {
    this._isCamMovingCallback(true, false)
  }
  handleEnd = () => {
    this._isCamMovingCallback(false, false)
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

  throttledEngCmd = throttle((cmd: EngineCommand) => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.engineCommandManager.sendSceneCommand(cmd)
  }, 1000 / 30)

  throttledUpdateEngineCamera = throttle((threeValues: ThreeCamValues) => {
    const cmd: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        ...convertThreeCamValuesToEngineCam(threeValues),
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.engineCommandManager.sendSceneCommand(cmd)
  }, 1000 / 15)

  lastPerspectiveCmd: EngineCommand | null = null
  lastPerspectiveCmdTime: number = Date.now()
  lastPerspectiveCmdTimeoutId: number | null = null

  sendLastPerspectiveReliableChannel = () => {
    if (
      this.lastPerspectiveCmd &&
      Date.now() - this.lastPerspectiveCmdTime >= lastCmdDelay
    ) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.engineCommandManager.sendSceneCommand(this.lastPerspectiveCmd, true)
      this.lastPerspectiveCmdTime = Date.now()
    }
  }

  doMove = (interaction: any, coordinates: any) => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd: {
        type: 'camera_drag_move',
        interaction: interaction,
        window: {
          x: coordinates[0],
          y: coordinates[1],
        },
      },
      cmd_id: uuidv4(),
    })
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
    isOrtho = false,
    domElement: HTMLCanvasElement,
    engineCommandManager: EngineCommandManager
  ) {
    this.engineCommandManager = engineCommandManager
    this.camera = isOrtho ? new OrthographicCamera() : new PerspectiveCamera()
    this.camera.up.set(0, 0, 1)
    this.camera.far = 20000
    this.target = new Vector3()
    this.domElement = domElement
    this.isDragging = false
    this.wasDragging = false
    this.mouseDownPosition = new Vector2()
    this.mouseNewPosition = new Vector2()

    this.domElement.addEventListener('pointerdown', this.onMouseDown)
    this.domElement.addEventListener('pointermove', this.onMouseMove)
    this.domElement.addEventListener('pointerup', this.onMouseUp)
    this.domElement.addEventListener('wheel', this.onMouseWheel)

    window.addEventListener('resize', this.onWindowResize)
    this.onWindowResize()

    this.update()
    this._usePerspectiveCamera()

    type CallBackParam = Parameters<
      (
        | Subscription<
            | 'default_camera_zoom'
            | 'camera_drag_end'
            | 'default_camera_get_settings'
            | 'zoom_to_fit'
          >
        | UnreliableSubscription<'camera_drag_move'>
      )['callback']
    >[0]

    const cb = ({ data, type }: CallBackParam) => {
      // We're reconnecting, so ignore this init proces.
      if (this.oldCameraState) {
        return
      }

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
        this.useOrthographicCamera()
      }
      if (this.camera instanceof OrthographicCamera && !camSettings.ortho) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.usePerspectiveCamera()
      }
      if (this.camera instanceof PerspectiveCamera && camSettings.fov_y) {
        this.camera.fov = camSettings.fov_y
      } else if (
        this.camera instanceof OrthographicCamera &&
        camSettings.ortho_scale
      ) {
        const distanceToTarget = new Vector3(
          camSettings.pos.x,
          camSettings.pos.y,
          camSettings.pos.z
        ).distanceTo(
          new Vector3(
            camSettings.center.x,
            camSettings.center.y,
            camSettings.center.z
          )
        )
        this.camera.zoom = (camSettings.ortho_scale * 40) / distanceToTarget
      }
      this.onCameraChange()
    }

    setTimeout(() => {
      this.engineCommandManager.subscribeTo({
        event: 'camera_drag_end',
        callback: cb,
      })
      this.engineCommandManager.subscribeTo({
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
    })
  }

  private _isCamMovingCallback: (isMoving: boolean, isTween: boolean) => void =
    () => {}
  setIsCamMovingCallback(cb: (isMoving: boolean, isTween: boolean) => void) {
    this._isCamMovingCallback = cb
  }
  private _camChangeCallbacks: { [key: string]: () => void } = {}
  subscribeToCamChange(cb: () => void) {
    const cbId = uuidv4()
    this._camChangeCallbacks[cbId] = cb
    const unsubscribe = () => {
      delete this._camChangeCallbacks[cbId]
    }
    return unsubscribe
  }

  onWindowResize = () => {
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = window.innerWidth / window.innerHeight
    } else if (this.camera instanceof OrthographicCamera) {
      const aspect = window.innerWidth / window.innerHeight
      this.camera.left = -ORTHOGRAPHIC_CAMERA_SIZE * aspect
      this.camera.right = ORTHOGRAPHIC_CAMERA_SIZE * aspect
      this.camera.top = ORTHOGRAPHIC_CAMERA_SIZE
      this.camera.bottom = -ORTHOGRAPHIC_CAMERA_SIZE
    }
    this.camera.updateProjectionMatrix()
  }

  onMouseDown = (event: PointerEvent) => {
    this.domElement.setPointerCapture(event.pointerId)
    this.isDragging = true
    // Reset the wasDragging flag to false when starting a new drag
    this.wasDragging = false
    this.mouseDownPosition.set(event.clientX, event.clientY)
    let interaction = this.getInteractionType(event)
    if (interaction === 'none') return
    this.handleStart()

    if (this.syncDirection === 'engineToClient') {
      void this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'camera_drag_start',
          interaction,
          window: { x: event.clientX, y: event.clientY },
        },
        cmd_id: uuidv4(),
      })
    }
  }

  onMouseMove = (event: PointerEvent) => {
    if (this.isDragging) {
      this.mouseNewPosition.set(event.clientX, event.clientY)
      const deltaMove = this.mouseNewPosition
        .clone()
        .sub(this.mouseDownPosition)
      this.mouseDownPosition.copy(this.mouseNewPosition)

      let interaction = this.getInteractionType(event)
      if (interaction === 'none') return

      // If there's a valid interaction and the mouse is moving,
      // our past (and current) interaction was a drag.
      this.wasDragging = true

      if (this.syncDirection === 'engineToClient') {
        this.moveSender.send(() => {
          this.doMove(interaction, [event.clientX, event.clientY])
        })
        return
      }

      // else "clientToEngine" (Sketch Mode) or forceUpdate
      // Implement camera movement logic here based on deltaMove
      // For example, for rotating the camera around the target:
      if (interaction === 'rotate') {
        this.pendingRotation = this.pendingRotation
          ? this.pendingRotation
          : new Vector2()
        this.pendingRotation.x += deltaMove.x
        this.pendingRotation.y += deltaMove.y
      } else if (interaction === 'zoom') {
        this.pendingZoom = this.pendingZoom ? this.pendingZoom : 1
        this.pendingZoom *= 1 + deltaMove.y * 0.01
      } else if (interaction === 'pan') {
        this.pendingPan = this.pendingPan ? this.pendingPan : new Vector2()
        let distance = this.camera.position.distanceTo(this.target)
        if (this.camera instanceof OrthographicCamera) {
          const zoomFudgeFactor = 2280
          distance = zoomFudgeFactor / (this.camera.zoom * 45)
        }
        const panSpeed = (distance / 1000 / 45) * this.perspectiveFovBeforeOrtho
        this.pendingPan.x += -deltaMove.x * panSpeed
        this.pendingPan.y += deltaMove.y * panSpeed
      }
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

        const { videoRef } = engineStreamActor.getSnapshot().context
        // Nonsense to do anything until the video stream is established.
        if (!videoRef.current) return

        const { x, y } = getNormalisedCoordinates(
          event,
          videoRef.current,
          this.engineCommandManager.streamDimensions
        )
        this.throttledEngCmd({
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

  onMouseUp = (event: PointerEvent) => {
    this.domElement.releasePointerCapture(event.pointerId)
    this.isDragging = false
    this.handleEnd()
    if (this.syncDirection === 'engineToClient') {
      const interaction = this.getInteractionType(event)
      if (interaction === 'none') return
      void this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'camera_drag_end',
          interaction,
          window: { x: event.clientX, y: event.clientY },
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

    if (this.syncDirection === 'engineToClient') {
      if (interaction === 'zoom') {
        this.zoomSender.send(() => {
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

    // else "clientToEngine" (Sketch Mode) or forceUpdate

    // We need to simulate similar behavior as when we send
    // zoom commands to engine. This means dropping some zoom
    // commands too.
    // From onMouseMove zoom handling which seems to be really smooth

    this.handleStart()
    if (interaction === 'zoom') {
      this.pendingZoom = 1 + (deltaY / window.devicePixelRatio) * 0.001
    } else {
      // This case will get handled when we add pan and rotate using Apple trackpad.
      console.error(
        `Unexpected interaction type for wheel event: ${interaction}`
      )
    }
    this.handleEnd()
  }

  useOrthographicCamera = () => {
    if (this.camera instanceof OrthographicCamera) return
    const { x: px, y: py, z: pz } = this.camera.position
    const { x: qx, y: qy, z: qz, w: qw } = this.camera.quaternion
    const oldCamUp = this.camera.up.clone()
    const aspect = window.innerWidth / window.innerHeight
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
    this.camera.zoom = (ZOOM_MAGIC_NUMBER * fovFactor * 0.8) / distance

    this.camera.quaternion.set(qx, qy, qz, qw)
    this.camera.updateProjectionMatrix()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_orthographic',
      },
    })
    this.onCameraChange()
  }
  private createPerspectiveCamera = () => {
    const { z_near, z_far } = calculateNearFarFromFOV(this.lastPerspectiveFov)
    const previousCamUp = this.camera.up.clone()
    this.camera = new PerspectiveCamera(
      this.lastPerspectiveFov,
      window.innerWidth / window.innerHeight,
      z_near,
      z_far
    )
    this.camera.up.copy(previousCamUp)
    this.camera.layers.enable(SKETCH_LAYER)
    if (DEBUG_SHOW_INTERSECTION_PLANE)
      this.camera.layers.enable(INTERSECTION_PLANE_LAYER)

    return this.camera
  }
  _usePerspectiveCamera = () => {
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
  usePerspectiveCamera = async (forceSend = false) => {
    this._usePerspectiveCamera()
    if (forceSend || this.syncDirection === 'clientToEngine') {
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

  dollyZoom = async (newFov: number, splitEngineCalls = false) => {
    if (!(this.camera instanceof PerspectiveCamera)) {
      console.warn('Dolly zoom is only applicable to perspective cameras.')
      return
    }
    this.lastPerspectiveFov = newFov

    // Calculate the direction vector from the camera towards the controls target
    const direction = new Vector3()
      .subVectors(this.target, this.camera.position)
      .normalize()

    // Calculate the distance to the controls target before changing the FOV
    const distanceBefore = this.camera.position.distanceTo(this.target)

    // Calculate the scale factor for the new FOV compared to the old one
    // This needs to be calculated before updating the camera's FOV
    const oldFov = this.camera.fov

    const viewHeightFactor = (fov: number) => {
      /*       *
              /|
             / |
            /  |
           /   |
          /    | viewHeight/2
         /     |
        /      |
       /↙️fov/2 |
      /________|
      \        |
       \._._._.|
      */
      return Math.tan(deg2Rad(fov / 2))
    }
    const scaleFactor = viewHeightFactor(oldFov) / viewHeightFactor(newFov)

    this.camera.fov = newFov
    this.camera.updateProjectionMatrix()

    const distanceAfter = distanceBefore * scaleFactor

    const newPosition = this.target
      .clone()
      .add(direction.multiplyScalar(-distanceAfter))
    this.camera.position.copy(newPosition)

    if (splitEngineCalls) {
      await this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_look_at',
          ...convertThreeCamValuesToEngineCam({
            isPerspective: true,
            position: newPosition,
            quaternion: this.camera.quaternion,
            zoom: this.camera.zoom,
            target: this.target,
          }),
        },
      })
      await this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_set_perspective',
          parameters: {
            fov_y: newFov,
          },
        },
      })
    } else {
      await this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_perspective_settings',
          ...convertThreeCamValuesToEngineCam({
            isPerspective: true,
            position: newPosition,
            quaternion: this.camera.quaternion,
            zoom: this.camera.zoom,
            target: this.target,
          }),
          fov_y: newFov,
        },
      })
    }
  }

  update = (forceUpdate = false) => {
    // If there are any changes that need to be applied to the camera, apply them here.

    let didChange = false
    if (this.pendingRotation) {
      this.rotateCamera(this.pendingRotation.x, this.pendingRotation.y)
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
      }
      didChange = true
    }

    if (this.pendingPan) {
      // move camera left/right and up/down
      const offset = this.camera.position.clone().sub(this.target)
      const direction = offset.clone().normalize()
      const cameraQuaternion = this.camera.quaternion
      const up = new Vector3(0, 1, 0).applyQuaternion(cameraQuaternion)
      const right = new Vector3().crossVectors(up, direction)
      right.multiplyScalar(this.pendingPan.x)
      up.multiplyScalar(this.pendingPan.y)
      const newPosition = this.camera.position.clone().add(right).add(up)
      this.target.add(right)
      this.target.add(up)
      this.camera.position.copy(newPosition)
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

  safeLookAtTarget(up = new Vector3(0, 0, 1)) {
    const quaternion = _lookAt(this.camera.position, this.target, up)
    this.camera.quaternion.copy(quaternion)
    this.camera.updateMatrixWorld()
  }

  tweenCamToNegYAxis(
    // -90 degrees from the x axis puts the camera on the negative y axis
    targetAngle = -Math.PI / 2,
    duration = 500
  ): Promise<void> {
    return new Promise((resolve) => {
      // should tween the camera so that it has an xPosition of 0, and forcing it's yPosition to be negative
      // zPosition should stay the same
      const xyRadius = Math.sqrt(
        (this.target.x - this.camera.position.x) ** 2 +
          (this.target.y - this.camera.position.y) ** 2
      )
      const xyAngle = Math.atan2(
        this.camera.position.y - this.target.y,
        this.camera.position.x - this.target.x
      )
      const camAtTime = (obj: { angle: number }) => {
        const x = xyRadius * Math.cos(obj.angle)
        const y = xyRadius * Math.sin(obj.angle)
        this.camera.position.set(
          this.target.x + x,
          this.target.y + y,
          this.camera.position.z
        )
        this.update()
        this.onCameraChange()
      }
      const onComplete = (obj: { angle: number }) => {
        camAtTime(obj)
        this._isCamMovingCallback(false, true)

        // resolve after a couple of frames
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      }
      this._isCamMovingCallback(true, true)

      if (isReducedMotion()) {
        onComplete({ angle: targetAngle })
        return
      }

      new TWEEN.Tween({ angle: xyAngle })
        .to({ angle: targetAngle }, duration)
        .onUpdate(camAtTime)
        .onComplete(onComplete)
        .start()
    })
  }

  async updateCameraToAxis(
    axis: 'x' | 'y' | 'z' | '-x' | '-y' | '-z'
  ): Promise<void> {
    const distance = this.camera.position.distanceTo(this.target)

    const vantage = this.target.clone()
    let up = { x: 0, y: 0, z: 1 }

    if (axis === 'x') {
      vantage.x += distance
    } else if (axis === 'y') {
      vantage.y += distance
    } else if (axis === 'z') {
      vantage.z += distance
      up = { x: -1, y: 0, z: 0 }
    } else if (axis === '-x') {
      vantage.x -= distance
    } else if (axis === '-y') {
      vantage.y -= distance
    } else if (axis === '-z') {
      vantage.z -= distance
      up = { x: -1, y: 0, z: 0 }
    }

    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        center: this.target,
        vantage: vantage,
        up: up,
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

  async resetCameraPosition(): Promise<void> {
    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        center: this.target,
        vantage: {
          x: this.target.x,
          y: this.target.y - 128,
          z: this.target.z + 64,
        },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'zoom_to_fit',
        object_ids: [], // leave empty to zoom to all objects
        padding: 0.2, // padding around the objects
        animated: false, // don't animate the zoom for now
      },
    })
  }

  async restoreRemoteCameraStateAndTriggerSync() {
    if (!this.oldCameraState) return

    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_view',
        view: this.oldCameraState,
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

  async saveRemoteCameraState() {
    const cameraViewStateResponse = await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'default_camera_get_view' },
    })
    if (!cameraViewStateResponse) return
    if ('resp' in cameraViewStateResponse
      && 'modeling_response' in cameraViewStateResponse.resp.data
      && 'data' in cameraViewStateResponse.resp.data.modeling_response
      && 'view' in cameraViewStateResponse.resp.data.modeling_response.data) {
      this.oldCameraState = cameraViewStateResponse.resp.data.modeling_response.data.view
    }
  }

  async tweenCameraToQuaternion(
    targetQuaternion: Quaternion,
    targetPosition = new Vector3(),
    duration = 500,
    toOrthographic = true
  ): Promise<void> {
    if (this.syncDirection === 'engineToClient')
      console.warn(
        'tweenCameraToQuaternion not design to work with engineToClient syncDirection.'
      )
    const isVertical = isQuaternionVertical(targetQuaternion)
    let remainingDuration = duration
    if (isVertical) {
      remainingDuration = duration * 0.5
      const orbitRotationDuration = duration * 0.65
      let targetAngle = -Math.PI / 2
      const v = new Vector3(0, 0, 1).applyQuaternion(targetQuaternion)
      if (v.z < 0) targetAngle = Math.PI / 2
      await this.tweenCamToNegYAxis(targetAngle, orbitRotationDuration)
    }
    await this._tweenCameraToQuaternion(
      targetQuaternion,
      targetPosition,
      remainingDuration,
      toOrthographic
    )
  }
  _tweenCameraToQuaternion(
    targetQuaternion: Quaternion,
    targetPosition: Vector3,
    duration = 500,
    toOrthographic = false
  ): Promise<void> {
    return new Promise((resolve) => {
      const camera = this.camera
      this._isCamMovingCallback(true, true)
      const initialQuaternion = camera.quaternion.clone()
      const initialTarget = this.target.clone()
      const isVertical = isQuaternionVertical(targetQuaternion)
      let tweenEnd = isVertical ? 0.99 : 1
      const tempVec = new Vector3()
      const initialDistance = initialTarget.distanceTo(camera.position.clone())

      const cameraAtTime = (animationProgress: number /* 0 - 1 */) => {
        const currentQ = tempQuaternion.slerpQuaternions(
          initialQuaternion,
          targetQuaternion,
          animationProgress
        )
        const up = new Vector3(0, 0, 1).applyQuaternion(currentQ)
        this.camera.up.copy(up)
        const currentTarget = tempVec.lerpVectors(
          initialTarget,
          targetPosition,
          animationProgress
        )
        if (this.camera instanceof PerspectiveCamera)
          // changing the camera position back when it's orthographic doesn't do anything
          // and it messes up animating back to perspective later
          this.camera.position
            .set(0, 0, 1)
            .applyQuaternion(currentQ)
            .multiplyScalar(initialDistance)
            .add(currentTarget)

        this.camera.up.set(0, 1, 0).applyQuaternion(currentQ).normalize()
        this.camera.quaternion.copy(currentQ)
        this.target.copy(currentTarget)
        this.camera.updateProjectionMatrix()
        this.update()
        this.onCameraChange()
      }

      const onComplete = async () => {
        if (isReducedMotion() && toOrthographic) {
          cameraAtTime(0.9999)
          this.useOrthographicCamera()
        } else if (toOrthographic) {
          await this.animateToOrthographic()
        }
        this.enableRotate = false
        this._isCamMovingCallback(false, true)
        resolve()
      }

      if (isReducedMotion()) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        onComplete()
        return
      }

      new TWEEN.Tween({ t: 0 })
        .to({ t: tweenEnd }, duration)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onUpdate(({ t }) => cameraAtTime(t))
        .onComplete(toSync(onComplete, reportRejection))
        .start()
    })
  }

  animateToOrthographic = () =>
    new Promise((resolve) => {
      if (this.syncDirection === 'engineToClient')
        console.warn(
          'animate To Orthographic not design to work with engineToClient syncDirection.'
        )
      this.isFovAnimationInProgress = true
      let currentFov = this.lastPerspectiveFov
      this.perspectiveFovBeforeOrtho = currentFov

      const targetFov = ORTHOGRAPHIC_MAGIC_FOV
      const fovAnimationStep = (currentFov - targetFov) / FRAMES_TO_ANIMATE_IN
      let frameWaitOnFinish = 10

      const animateFovChange = () => {
        if (this.camera instanceof PerspectiveCamera) {
          if (this.camera.fov > targetFov) {
            // Decrease the FOV
            currentFov = Math.max(currentFov - fovAnimationStep, targetFov)
            this.camera.updateProjectionMatrix()
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.dollyZoom(currentFov)
            requestAnimationFrame(animateFovChange) // Continue the animation
          } else if (frameWaitOnFinish > 0) {
            frameWaitOnFinish--
            requestAnimationFrame(animateFovChange) // Continue the animation
          } else {
            // Once the target FOV is reached, switch to the orthographic camera
            // Needs to wait a couple frames after the FOV animation is complete
            this.useOrthographicCamera()
            this.isFovAnimationInProgress = false
            resolve(true)
          }
        }
      }

      animateFovChange() // Start the animation
    })
  animateToPerspective = (targetCamUp = new Vector3(0, 0, 1)) =>
    new Promise((resolve) => {
      if (this.syncDirection === 'engineToClient') {
        console.warn(
          'animate To Perspective not design to work with engineToClient syncDirection.'
        )
      }
      this.isFovAnimationInProgress = true
      const targetFov = this.perspectiveFovBeforeOrtho // Target FOV for perspective
      this.lastPerspectiveFov = ORTHOGRAPHIC_MAGIC_FOV
      let currentFov = ORTHOGRAPHIC_MAGIC_FOV
      const initialCameraUp = this.camera.up.clone()
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.usePerspectiveCamera()
      const tempVec = new Vector3()

      const cameraAtTime = (t: number) => {
        currentFov =
          this.lastPerspectiveFov + (targetFov - this.lastPerspectiveFov) * t
        const currentUp = tempVec.lerpVectors(initialCameraUp, targetCamUp, t)
        this.camera.up.copy(currentUp)
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.dollyZoom(currentFov)
      }

      const onComplete = () => {
        this.isFovAnimationInProgress = false
        resolve(true)
      }

      new TWEEN.Tween({ t: 0 })
        .to({ t: 1 }, isReducedMotion() ? 50 : FRAMES_TO_ANIMATE_IN * 16) // Assuming 60fps, hence 16ms per frame
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onUpdate(({ t }) => cameraAtTime(t))
        .onComplete(onComplete)
        .start()
    })
  snapToPerspectiveBeforeHandingBackControlToEngine = async (
    targetCamUp = new Vector3(0, 0, 1)
  ) => {
    if (this.syncDirection === 'engineToClient') {
      console.warn(
        'animate To Perspective not design to work with engineToClient syncDirection.'
      )
    }
    this.isFovAnimationInProgress = true
    const targetFov = this.perspectiveFovBeforeOrtho // Target FOV for perspective
    let currentFov = ORTHOGRAPHIC_MAGIC_FOV
    const initialCameraUp = this.camera.up.clone()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.usePerspectiveCamera()
    const tempVec = new Vector3()

    currentFov = this.lastPerspectiveFov + (targetFov - this.lastPerspectiveFov)
    const currentUp = tempVec.lerpVectors(initialCameraUp, targetCamUp, 1)
    this.camera.up.copy(currentUp)
    await this.dollyZoom(currentFov, true)

    this.isFovAnimationInProgress = false
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

  deferReactUpdate = throttle((a: ReactCameraProperties) => {
    this.reactCameraPropertiesCallback(a)
  }, 200)

  onCameraChange = (forceUpdate = false) => {
    const distance = this.target.distanceTo(this.camera.position)
    if (this.camera.far / 2.1 < distance || this.camera.far / 1.9 > distance) {
      this.camera.far = distance * 2
      this.camera.near = distance / 10
      this.camera.updateProjectionMatrix()
    }

    if (this.syncDirection === 'clientToEngine' || forceUpdate) {
      this.throttledUpdateEngineCamera({
        quaternion: this.camera.quaternion,
        position: this.camera.position,
        zoom: this.camera.zoom,
        isPerspective: this.isPerspective,
        target: this.target,
      })
    }
    this.deferReactUpdate(this.reactCameraProperties)
    Object.values(this._camChangeCallbacks).forEach((cb) => cb())
  }
  getInteractionType = (
    event: MouseEvent
  ): CameraDragInteractionType_type | 'none' => {
    const initialInteractionType = _getInteractionType(
      this.interactionGuards,
      event,
      this.enablePan,
      this.enableRotate,
      this.enableZoom
    )
    if (
      initialInteractionType === 'rotate' &&
      this.engineCommandManager.settings.cameraOrbit === 'trackball'
    ) {
      return 'rotatetrackball'
    }
    return initialInteractionType
  }
}

// Pure function helpers

function calculateNearFarFromFOV(fov: number) {
  // const nearFarRatio = (fov - 3) / (45 - 3)
  // const z_near = 0.1 + nearFarRatio * (5 - 0.1)
  // const z_far = 1000 + nearFarRatio * (100000 - 1000)
  return { z_near: 0.01, z_far: 1000 }
}

function convertThreeCamValuesToEngineCam({
  target,
  position,
  quaternion,
  zoom,
  isPerspective,
}: ThreeCamValues): {
  center: Vector3
  up: Vector3
  vantage: Vector3
} {
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')

  const upVector = new Vector3(0, 1, 0).applyEuler(euler).normalize()
  if (isPerspective) {
    return {
      center: target,
      up: upVector,
      vantage: position,
    }
  }

  // re-implementing stuff here, though this is a bunch of Mike's code
  // if we need to pull him in again, at least it will be familiar to him
  // and it's all simple functions.
  interface Coord3d {
    x: number
    y: number
    z: number
  }

  function buildLookAt(distance: number, center: Coord3d, eye: Coord3d) {
    const eyeVector = normalized(sub(eye, center))
    return { center: center, eye: add(center, mult(eyeVector, distance)) }
  }

  function mult(vecA: Coord3d, sc: number): Coord3d {
    return { x: vecA.x * sc, y: vecA.y * sc, z: vecA.z * sc }
  }

  function add(vecA: Coord3d, vecB: Coord3d): Coord3d {
    return { x: vecA.x + vecB.x, y: vecA.y + vecB.y, z: vecA.z + vecB.z }
  }

  function sub(vecA: Coord3d, vecB: Coord3d): Coord3d {
    return { x: vecA.x - vecB.x, y: vecA.y - vecB.y, z: vecA.z - vecB.z }
  }

  function dot(vecA: Coord3d, vecB: Coord3d) {
    return vecA.x * vecB.x + vecA.y * vecB.y + vecA.z * vecB.z
  }

  function length(vecA: Coord3d) {
    return Math.sqrt(dot(vecA, vecA))
  }

  function normalized(vecA: Coord3d) {
    return mult(vecA, 1.0 / length(vecA))
  }

  const lookAt = buildLookAt(64 / zoom, target, position)
  return {
    center: new Vector3(lookAt.center.x, lookAt.center.y, lookAt.center.z),
    up: new Vector3(upVector.x, upVector.y, upVector.z),
    vantage: new Vector3(lookAt.eye.x, lookAt.eye.y, lookAt.eye.z),
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
 * Tells the engine to fire it's animation waits for it to finish and then requests camera settings
 * to ensure the client-side camera is synchronized with the engine's camera state.
 *
 * @param engineCommandManager Our websocket singleton
 * @param entityId - The ID of face or sketchPlane.
 */

export async function letEngineAnimateAndSyncCamAfter(
  engineCommandManager: EngineCommandManager,
  entityId: string
) {
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'enable_sketch_mode',
      adjust_camera: true,
      animated: !isReducedMotion(),
      ortho: true,
      entity_id: entityId,
    },
  })
  // wait 600ms (animation takes 500, + 100 for safety)
  await new Promise((resolve) =>
    setTimeout(resolve, isReducedMotion() ? 100 : 600)
  )
  await engineCommandManager.sendSceneCommand({
    // CameraControls subscribes to default_camera_get_settings response events
    // firing this at connection ensure the camera's are synced initially
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_get_settings',
    },
  })
}
