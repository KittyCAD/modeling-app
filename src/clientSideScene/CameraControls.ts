import { MouseGuard } from 'lib/cameraControls'
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
import {
  DEBUG_SHOW_INTERSECTION_PLANE,
  INTERSECTION_PLANE_LAYER,
  SKETCH_LAYER,
  ZOOM_MAGIC_NUMBER,
} from './sceneInfra'
import {
  EngineCommand,
  Subscription,
  engineCommandManager,
} from 'lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { deg2Rad } from 'lib/utils2d'
import { isReducedMotion, roundOff, throttle } from 'lib/utils'
import * as TWEEN from '@tweenjs/tween.js'
import { isQuaternionVertical } from './helpers'

const ORTHOGRAPHIC_CAMERA_SIZE = 20
const FRAMES_TO_ANIMATE_IN = 30

const tempQuaternion = new Quaternion() // just used for maths

type interactionType = 'pan' | 'rotate' | 'zoom'

const throttledEngCmd = throttle((cmd: EngineCommand) => {
  engineCommandManager.sendSceneCommand(cmd)
}, 1000 / 15)

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
      quaternion: [number, number, number, number]
    }
  | {
      type: 'orthographic'
      zoom?: number
      position: [number, number, number]
      quaternion: [number, number, number, number]
    }

const lastCmdDelay = 50

const throttledUpdateEngineCamera = throttle((threeValues: ThreeCamValues) => {
  const cmd: EngineCommand = {
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_look_at',
      ...convertThreeCamValuesToEngineCam(threeValues),
    },
  }
  engineCommandManager.sendSceneCommand(cmd)
}, 1000 / 15)

let lastPerspectiveCmd: EngineCommand | null = null
let lastPerspectiveCmdTime: number = Date.now()
let lastPerspectiveCmdTimeoutId: number | null = null

const sendLastPerspectiveReliableChannel = () => {
  if (
    lastPerspectiveCmd &&
    Date.now() - lastPerspectiveCmdTime >= lastCmdDelay
  ) {
    engineCommandManager.sendSceneCommand(lastPerspectiveCmd, true)
    lastPerspectiveCmdTime = Date.now()
  }
}

const throttledUpdateEngineFov = throttle(
  (vals: {
    position: Vector3
    quaternion: Quaternion
    zoom: number
    fov: number
    target: Vector3
  }) => {
    const cmd: EngineCommand = {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_perspective_settings',
        ...convertThreeCamValuesToEngineCam({
          ...vals,
          isPerspective: true,
        }),
        fov_y: vals.fov,
        ...calculateNearFarFromFOV(vals.fov),
      },
    }
    engineCommandManager.sendSceneCommand(cmd)
    lastPerspectiveCmd = cmd
    lastPerspectiveCmdTime = Date.now()
    if (lastPerspectiveCmdTimeoutId !== null) {
      clearTimeout(lastPerspectiveCmdTimeoutId)
    }
    lastPerspectiveCmdTimeoutId = setTimeout(
      sendLastPerspectiveReliableChannel,
      lastCmdDelay
    ) as any as number
  },
  1000 / 30
)

export class CameraControls {
  syncDirection: 'clientToEngine' | 'engineToClient' = 'engineToClient'
  camera: PerspectiveCamera | OrthographicCamera
  target: Vector3
  domElement: HTMLCanvasElement
  isDragging: boolean
  mouseDownPosition: Vector2
  mouseNewPosition: Vector2
  rotationSpeed = 0.3
  enableRotate = true
  enablePan = true
  enableZoom = true
  lastPerspectiveFov: number = 45
  pendingZoom: number | null = null
  pendingRotation: Vector2 | null = null
  pendingPan: Vector2 | null = null
  interactionGuards: MouseGuard = {
    pan: {
      description: 'Right click + Shift + drag or middle click + drag',
      callback: (e) => !!(e.buttons & 4) && !e.ctrlKey,
    },
    zoom: {
      description: 'Scroll wheel or Right click + Ctrl + drag',
      dragCallback: (e) => e.button === 2 && e.ctrlKey,
      scrollCallback: () => true,
    },
    rotate: {
      description: 'Right click + drag',
      callback: (e) => {
        console.log('event', e)
        return !!(e.buttons & 2)
      },
    },
  }
  isFovAnimationInProgress = false
  fovBeforeOrtho = 45
  get isPerspective() {
    return this.camera instanceof PerspectiveCamera
  }
  private debounceTimer = 0

  handleStart = () => {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this._isCamMovingCallback(true, false)
  }
  handleEnd = () => {
    this.debounceTimer = setTimeout(() => {
      this._isCamMovingCallback(false, false)
    }, 400) as any as number
  }

  // reacts hooks into some of this singleton's properties
  reactCameraProperties: ReactCameraProperties = {
    type: 'perspective',
    fov: 12,
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
  }

  setCam = (camProps: ReactCameraProperties) => {
    if (
      camProps.type === 'perspective' &&
      this.camera instanceof OrthographicCamera
    ) {
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

  constructor(isOrtho = false, domElement: HTMLCanvasElement) {
    this.camera = isOrtho ? new OrthographicCamera() : new PerspectiveCamera()
    this.camera.up.set(0, 0, 1)
    this.camera.far = 20000
    this.target = new Vector3()
    this.domElement = domElement
    this.isDragging = false
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

    const cb: Subscription<
      'default_camera_zoom' | 'camera_drag_end' | 'default_camera_get_settings'
    >['callback'] = ({ data, type }) => {
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
      if (this.camera instanceof PerspectiveCamera && camSettings.fov_y) {
        this.camera.fov = camSettings.fov_y
      } else if (
        this.camera instanceof OrthographicCamera &&
        camSettings.ortho_scale
      ) {
        this.camera.zoom = camSettings.ortho_scale
      }
      this.onCameraChange()
    }
    setTimeout(() => {
      engineCommandManager.subscribeTo({
        event: 'camera_drag_end',
        callback: cb,
      })
      engineCommandManager.subscribeTo({
        event: 'default_camera_zoom',
        callback: cb,
      })
      engineCommandManager.subscribeTo({
        event: 'default_camera_get_settings',
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

  onMouseDown = (event: MouseEvent) => {
    this.isDragging = true
    this.mouseDownPosition.set(event.clientX, event.clientY)
    let interaction = this.getInteractionType(event)
    if (interaction === 'none') return
    this.handleStart()

    if (this.syncDirection === 'engineToClient') {
      void engineCommandManager.sendSceneCommand({
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

  onMouseMove = (event: MouseEvent) => {
    if (this.isDragging) {
      this.mouseNewPosition.set(event.clientX, event.clientY)
      const deltaMove = this.mouseNewPosition
        .clone()
        .sub(this.mouseDownPosition)
      this.mouseDownPosition.copy(this.mouseNewPosition)

      const interaction = this.getInteractionType(event)
      if (interaction === 'none') return

      if (this.syncDirection === 'engineToClient') {
        throttledEngCmd({
          type: 'modeling_cmd_req',
          cmd: {
            type: 'camera_drag_move',
            interaction,
            window: { x: event.clientX, y: event.clientY },
          },
          cmd_id: uuidv4(),
        })
        return
      }

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
        const panSpeed = (distance / 1000 / 45) * this.fovBeforeOrtho
        this.pendingPan.x += -deltaMove.x * panSpeed
        this.pendingPan.y += deltaMove.y * panSpeed
      }
    }
  }

  onMouseUp = (event: MouseEvent) => {
    this.isDragging = false
    this.handleEnd()
    if (this.syncDirection === 'engineToClient') {
      const interaction = this.getInteractionType(event)
      if (interaction === 'none') return
      void engineCommandManager.sendSceneCommand({
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
    // Assume trackpad if the deltas are small and integers
    this.handleStart()

    if (this.syncDirection === 'engineToClient') {
      const interactions = this.interactionGuards.zoom.scrollCallback(
        event as any
      )
      if (!interactions) {
        this.handleEnd()
        return
      }
      throttledEngCmd({
        type: 'modeling_cmd_req',
        cmd: {
          type: 'default_camera_zoom',
          magnitude: -event.deltaY * 0.4,
        },
        cmd_id: uuidv4(),
      })
      this.handleEnd()
      return
    }

    const isTrackpad = Math.abs(event.deltaY) <= 1 || event.deltaY % 1 === 0

    const zoomSpeed = isTrackpad ? 0.02 : 0.1 // Reduced zoom speed for trackpad
    this.pendingZoom = this.pendingZoom ? this.pendingZoom : 1
    this.pendingZoom *= 1 + (event.deltaY > 0 ? zoomSpeed : -zoomSpeed)
    this.handleEnd()
  }

  useOrthographicCamera = () => {
    if (this.camera instanceof OrthographicCamera) return
    const { x: px, y: py, z: pz } = this.camera.position
    const { x: qx, y: qy, z: qz, w: qw } = this.camera.quaternion
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
    this.camera.up.set(0, 0, 1)
    this.camera.layers.enable(SKETCH_LAYER)
    if (DEBUG_SHOW_INTERSECTION_PLANE)
      this.camera.layers.enable(INTERSECTION_PLANE_LAYER)
    this.camera.position.set(px, py, pz)
    const distance = this.camera.position.distanceTo(this.target.clone())
    const fovFactor = 45 / this.lastPerspectiveFov
    this.camera.zoom = (ZOOM_MAGIC_NUMBER * fovFactor * 0.8) / distance

    this.camera.quaternion.set(qx, qy, qz, qw)
    this.camera.updateProjectionMatrix()
    engineCommandManager.sendSceneCommand({
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
    this.camera = new PerspectiveCamera(
      this.lastPerspectiveFov,
      window.innerWidth / window.innerHeight,
      z_near,
      z_far
    )
    this.camera.up.set(0, 0, 1)
    this.camera.layers.enable(SKETCH_LAYER)
    if (DEBUG_SHOW_INTERSECTION_PLANE)
      this.camera.layers.enable(INTERSECTION_PLANE_LAYER)

    return this.camera
  }
  _usePerspectiveCamera = () => {
    const { x: px, y: py, z: pz } = this.camera.position
    const { x: qx, y: qy, z: qz, w: qw } = this.camera.quaternion
    const zoom = this.camera.zoom
    this.camera = this.createPerspectiveCamera()

    this.camera.position.set(px, py, pz)
    this.camera.quaternion.set(qx, qy, qz, qw)
    const zoomFudgeFactor = 2280
    const distance = zoomFudgeFactor / (zoom * this.lastPerspectiveFov)
    const direction = new Vector3().subVectors(
      this.camera.position,
      this.target
    )
    direction.normalize()
    this.camera.position.copy(this.target).addScaledVector(direction, distance)
  }
  usePerspectiveCamera = () => {
    this._usePerspectiveCamera()
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_perspective',
        parameters: {
          fov_y:
            this.camera instanceof PerspectiveCamera ? this.camera.fov : 45,
          ...calculateNearFarFromFOV(this.lastPerspectiveFov),
        },
      },
    })
    this.onCameraChange()
    this.update()
    return this.camera
  }

  dollyZoom = (newFov: number) => {
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

    const { z_near, z_far } = calculateNearFarFromFOV(this.lastPerspectiveFov)
    this.camera.near = z_near
    this.camera.far = z_far

    throttledUpdateEngineFov({
      fov: newFov,
      position: newPosition,
      quaternion: this.camera.quaternion,
      zoom: this.camera.zoom,
      target: this.target,
    })
  }

  update = (forceUpdate = false) => {
    // If there are any changes that need to be applied to the camera, apply them here.

    let didChange = forceUpdate
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

    this.safeLookAtTarget()

    // Update the camera's matrices
    this.camera.updateMatrixWorld()
    if (didChange) {
      this.onCameraChange()
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
    this._isCamMovingCallback(true, true)
    return new Promise((resolve) => {
      new TWEEN.Tween({ angle: xyAngle })
        .to({ angle: targetAngle }, duration)
        .onUpdate((obj) => {
          const x = xyRadius * Math.cos(obj.angle)
          const y = xyRadius * Math.sin(obj.angle)
          this.camera.position.set(
            this.target.x + x,
            this.target.y + y,
            this.camera.position.z
          )
          this.update()
          this.onCameraChange()
        })
        .onComplete((obj) => {
          const x = xyRadius * Math.cos(obj.angle)
          const y = xyRadius * Math.sin(obj.angle)
          this.camera.position.set(
            this.target.x + x,
            this.target.y + y,
            this.camera.position.z
          )
          this.update()
          this.onCameraChange()
          this._isCamMovingCallback(false, true)

          // resolve after a couple of frames
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve())
          })
        })
        .start()
    })
  }

  async tweenCameraToQuaternion(
    targetQuaternion: Quaternion,
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
      remainingDuration,
      toOrthographic
    )
  }
  _tweenCameraToQuaternion(
    targetQuaternion: Quaternion,
    duration = 500,
    toOrthographic = false
  ): Promise<void> {
    return new Promise((resolve) => {
      const camera = this.camera
      this._isCamMovingCallback(true, true)
      const initialQuaternion = camera.quaternion.clone()
      const isVertical = isQuaternionVertical(targetQuaternion)
      let tweenEnd = isVertical ? 0.99 : 1
      const controlsTarget = this.target.clone()
      const initialDistance = controlsTarget.distanceTo(camera.position.clone())

      const cameraAtTime = (animationProgress: number /* 0 - 1 */) => {
        const currentQ = tempQuaternion.slerpQuaternions(
          initialQuaternion,
          targetQuaternion,
          animationProgress
        )
        if (this.camera instanceof PerspectiveCamera)
          // changing the camera position back when it's orthographic doesn't do anything
          // and it messes up animating back to perspective later
          this.camera.position
            .set(0, 0, 1)
            .applyQuaternion(currentQ)
            .multiplyScalar(initialDistance)
            .add(controlsTarget)

        this.camera.up.set(0, 1, 0).applyQuaternion(currentQ).normalize()
        this.camera.quaternion.copy(currentQ)
        this.target.copy(controlsTarget)
        // this.controls.update()
        this.camera.updateProjectionMatrix()
        this.update()
        this.onCameraChange()
      }

      const onComplete = async () => {
        if (isReducedMotion() && toOrthographic) {
          cameraAtTime(0.99)
          this.useOrthographicCamera()
        } else if (toOrthographic) {
          await this.animateToOrthographic()
        }
        this.enableRotate = false
        this._isCamMovingCallback(false, true)
        resolve()
      }

      if (isReducedMotion()) {
        onComplete()
        return
      }

      new TWEEN.Tween({ t: 0 })
        .to({ t: tweenEnd }, duration)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onUpdate(({ t }) => cameraAtTime(t))
        .onComplete(onComplete)
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
      this.fovBeforeOrtho = currentFov

      const targetFov = 4
      const fovAnimationStep = (currentFov - targetFov) / FRAMES_TO_ANIMATE_IN
      let frameWaitOnFinish = 10

      const animateFovChange = () => {
        if (this.camera instanceof PerspectiveCamera) {
          if (this.camera.fov > targetFov) {
            // Decrease the FOV
            currentFov = Math.max(currentFov - fovAnimationStep, targetFov)
            this.camera.updateProjectionMatrix()
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
  animateToPerspective = () =>
    new Promise((resolve) => {
      if (this.syncDirection === 'engineToClient')
        console.warn(
          'animate To Perspective not design to work with engineToClient syncDirection.'
        )
      this.isFovAnimationInProgress = true
      // Immediately set the camera to perspective with a very low FOV
      const targetFov = this.fovBeforeOrtho // Target FOV for perspective
      this.lastPerspectiveFov = 4
      let currentFov = 4
      this.camera.updateProjectionMatrix()
      const fovAnimationStep = (targetFov - currentFov) / FRAMES_TO_ANIMATE_IN
      this.usePerspectiveCamera()

      const animateFovChange = () => {
        if (this.camera instanceof OrthographicCamera) return
        if (this.camera.fov < targetFov) {
          // Increase the FOV
          currentFov = Math.min(currentFov + fovAnimationStep, targetFov)
          // this.camera.fov = currentFov
          this.camera.updateProjectionMatrix()
          this.dollyZoom(currentFov)
          requestAnimationFrame(animateFovChange) // Continue the animation
        } else {
          // Set the flag to false as the FOV animation is complete
          this.isFovAnimationInProgress = false
          resolve(true)
        }
      }
      animateFovChange() // Start the animation
    })

  reactCameraPropertiesCallback: (a: ReactCameraProperties) => void = () => {}
  setReactCameraPropertiesCallback = (
    cb: (a: ReactCameraProperties) => void
  ) => {
    this.reactCameraPropertiesCallback = cb
  }

  deferReactUpdate = throttle((a: ReactCameraProperties) => {
    this.reactCameraPropertiesCallback(a)
  }, 200)

  onCameraChange = () => {
    const distance = this.target.distanceTo(this.camera.position)
    if (this.camera.far / 2.1 < distance || this.camera.far / 1.9 > distance) {
      this.camera.far = distance * 2
      this.camera.near = distance / 10
      this.camera.updateProjectionMatrix()
    }

    if (this.syncDirection === 'clientToEngine')
      throttledUpdateEngineCamera({
        quaternion: this.camera.quaternion,
        position: this.camera.position,
        zoom: this.camera.zoom,
        isPerspective: this.isPerspective,
        target: this.target,
      })
    this.deferReactUpdate({
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
      quaternion: [
        roundOff(this.camera.quaternion.x, 2),
        roundOff(this.camera.quaternion.y, 2),
        roundOff(this.camera.quaternion.z, 2),
        roundOff(this.camera.quaternion.w, 2),
      ],
    })
    Object.values(this._camChangeCallbacks).forEach((cb) => cb())
  }
  getInteractionType = (event: any) =>
    _getInteractionType(
      this.interactionGuards,
      event,
      this.enablePan,
      this.enableRotate,
      this.enableZoom
    )
}

// Pure function helpers

function calculateNearFarFromFOV(fov: number) {
  const nearFarRatio = (fov - 3) / (45 - 3)
  // const z_near = 0.1 + nearFarRatio * (5 - 0.1)
  const z_far = 1000 + nearFarRatio * (100000 - 1000)
  return { z_near: 0.1, z_far }
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
  // Something to consider is that the orbit controls have a target,
  // we're kind of deriving the target/lookAtVector here when it might not be needed
  // leaving for now since it's working but maybe revisit later
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')

  const lookAtVector = new Vector3(0, 0, -1)
    .applyEuler(euler)
    .normalize()
    .add(position)

  const upVector = new Vector3(0, 1, 0).applyEuler(euler).normalize()
  if (isPerspective) {
    return {
      center: target,
      up: upVector,
      vantage: position,
    }
  }
  const fudgeFactor2 = zoom * 0.9979224466814468 - 0.03473692325839295
  const zoomFactor = (-ZOOM_MAGIC_NUMBER + fudgeFactor2) / zoom
  const direction = lookAtVector.clone().sub(position).normalize()
  const newVantage = position.clone().add(direction.multiplyScalar(zoomFactor))
  return {
    center: lookAtVector,
    up: upVector,
    vantage: newVantage,
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
  event: any,
  enablePan: boolean,
  enableRotate: boolean,
  enableZoom: boolean
): interactionType | 'none' {
  let state: interactionType | 'none' = 'none'
  if (enablePan && interactionGuards.pan.callback(event)) return 'pan'
  if (enableRotate && interactionGuards.rotate.callback(event)) return 'rotate'
  if (enableZoom && interactionGuards.zoom.dragCallback(event)) return 'zoom'
  return state
}
