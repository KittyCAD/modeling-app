import { MouseGuard } from 'lib/cameraControls'
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
import {
  DEBUG_SHOW_INTERSECTION_PLANE,
  INTERSECTION_PLANE_LAYER,
  SKETCH_LAYER,
  ZOOM_MAGIC_NUMBER,
  isQuaternionVertical,
} from './sceneInfra'
import { EngineCommand, engineCommandManager } from 'lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { deg2Rad } from 'lib/utils2d'
import { isReducedMotion, throttle } from 'lib/utils'
import * as TWEEN from '@tweenjs/tween.js'

const ORTHOGRAPHIC_CAMERA_SIZE = 20

const tempQuaternion = new Quaternion() // just used for maths

interface Callbacks {
  onCameraChange?: () => void
  isCamMoving?: (isMoving: boolean, isTween: boolean) => void
}

// there two of these now, delete one
interface ThreeCamValues {
  position: Vector3
  quaternion: Quaternion
  zoom: number
  isPerspective: boolean
  target: Vector3
}

const lastCmdDelay = 50

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

// there two of these now, delete one
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
  1000 / 15
)

export class CameraControls {
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
  callbacks: Callbacks
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
  get isPerspective() {
    return this.camera instanceof PerspectiveCamera
  }

  constructor(
    isOrtho = false,
    domElement: HTMLCanvasElement,
    callbacks: Callbacks
  ) {
    this.callbacks = callbacks
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
  }

  onMouseMove = (event: MouseEvent) => {
    if (this.isDragging) {
      this.mouseNewPosition.set(event.clientX, event.clientY)
      const deltaMove = this.mouseNewPosition
        .clone()
        .sub(this.mouseDownPosition)
      this.mouseDownPosition.copy(this.mouseNewPosition)

      let state: 'pan' | 'rotate' | 'zoom' = 'pan'

      if (this.interactionGuards.pan.callback(event as any)) {
        if (this.enablePan === false) return
        // handleMouseDownPan(event)
        state = 'pan'
      } else if (this.interactionGuards.rotate.callback(event as any)) {
        if (this.enableRotate === false) return
        // handleMouseDownRotate(event)
        state = 'rotate'
      } else if (this.interactionGuards.zoom.dragCallback(event as any)) {
        if (this.enableZoom === false) return
        // handleMouseDownDolly(event)
        state = 'zoom'
      } else {
        return
      }

      // Implement camera movement logic here based on deltaMove
      // For example, for rotating the camera around the target:
      if (state === 'rotate') {
        this.pendingRotation = this.pendingRotation
          ? this.pendingRotation
          : new Vector2()
        this.pendingRotation.x += deltaMove.x
        this.pendingRotation.y += deltaMove.y
      } else if (state === 'zoom') {
        this.pendingZoom = this.pendingZoom ? this.pendingZoom : 1
        this.pendingZoom *= 1 + deltaMove.y * 0.01
      } else if (state === 'pan') {
        this.pendingPan = this.pendingPan ? this.pendingPan : new Vector2()
        let distance = this.camera.position.distanceTo(this.target)
        if (this.camera instanceof OrthographicCamera) {
          const zoomFudgeFactor = 2280
          distance = zoomFudgeFactor / (this.camera.zoom * 45)
        }
        const panSpeed = (distance / 1000 / 45) * this.lastPerspectiveFov
        this.pendingPan.x += -deltaMove.x * panSpeed
        this.pendingPan.y += deltaMove.y * panSpeed
      }
    }
  }

  onMouseUp = (event: MouseEvent) => {
    this.isDragging = false
  }

  onMouseWheel = (event: WheelEvent) => {
    this.pendingZoom = this.pendingZoom ? this.pendingZoom : 1
    const zoomSpeed = 0.1
    this.pendingZoom *= 1 + (event.deltaY > 0 ? zoomSpeed : -zoomSpeed)
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
    this.callbacks.onCameraChange?.()
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
  usePerspectiveCamera = () => {
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

    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_perspective',
        parameters: {
          fov_y: this.camera.fov,
          ...calculateNearFarFromFOV(this.lastPerspectiveFov),
        },
      },
    })
    this.callbacks.onCameraChange?.()
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

  update = () => {
    // If there are any changes that need to be applied to the camera, apply them here.
    // This could include rotations, panning, zooming, etc.

    // For example, if you have a pending rotation that needs to be applied:
    let didChange = false
    if (this.pendingRotation) {
      this.rotateCamera(this.pendingRotation.x, this.pendingRotation.y)
      this.pendingRotation = null // Clear the pending rotation after applying it
      didChange = true
    }

    // // If you have a zoom level that needs to be applied:
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
      // const distance = offset.length()
      const direction = offset.clone().normalize()
      const right = new Vector3().crossVectors(this.camera.up, direction)
      const up = this.camera.up.clone()
      right.multiplyScalar(this.pendingPan.x)
      up.multiplyScalar(this.pendingPan.y)
      const newPosition = this.camera.position.clone().add(right).add(up)
      this.target.add(right)
      this.target.add(up)
      this.camera.position.copy(newPosition)
      this.camera.lookAt(this.target)
      this.pendingPan = null
      didChange = true
    }

    // Always look at the target
    // TODO, we might need to implement this if it doesn't respect z-up
    // most importantly when it's looking straight up or down as that's gimbal lock situation
    this.camera.lookAt(this.target)

    // Update the camera's matrices
    this.camera.updateMatrixWorld()
    if (didChange) {
      this.callbacks.onCameraChange?.()
    }

    // If you're using damping or easing, you would apply it here as well
    // This would typically involve interpolating between the current camera state and the desired state
  }

  // Additional methods for camera manipulation can be added here
  // For example, rotateCamera, zoomCamera, etc.
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
    this.camera.lookAt(this.target)

    this.camera.up.set(0, 0, 1)
    this.camera.updateMatrixWorld()
  }

  async tweenCameraToQuaternion(
    targetQuaternion: Quaternion,
    duration = 500,
    toOrthographic = true
  ): Promise<void> {
    const isVertical = isQuaternionVertical(targetQuaternion)
    let _duration = duration
    if (isVertical) {
      _duration = duration * 0.6
      await this._tweenCameraToQuaternion(new Quaternion(), _duration, false)
    }
    await this._tweenCameraToQuaternion(
      targetQuaternion,
      _duration,
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
      this.callbacks.isCamMoving?.(true, true)
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
      }

      const onComplete = async () => {
        if (isReducedMotion() && toOrthographic) {
          cameraAtTime(0.99)
          this.useOrthographicCamera()
        } else if (toOrthographic) {
          this.useOrthographicCamera()
          // todo reimplement animate to orthographic
          // await this.animateToOrthographic()
        }
        if (isVertical) cameraAtTime(1)
        this.camera.up.set(0, 0, 1)
        this.enableRotate = false
        this.callbacks.isCamMoving?.(false, true)
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
}

// currently duplicated, delete one
function calculateNearFarFromFOV(fov: number) {
  const nearFarRatio = (fov - 3) / (45 - 3)
  // const z_near = 0.1 + nearFarRatio * (5 - 0.1)
  const z_far = 1000 + nearFarRatio * (100000 - 1000)
  return { z_near: 0.1, z_far }
}

// currently duplicated, delete one
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
