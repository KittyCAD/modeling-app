import {
  AmbientLight,
  Color,
  Euler,
  GridHelper,
  LineBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  Raycaster,
  Vector2,
  Group,
  PlaneGeometry,
  MeshBasicMaterial,
  Mesh,
  DoubleSide,
  Intersection,
  Object3D,
  Object3DEventMap,
  BoxGeometry,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { EngineCommand, engineCommandManager } from 'lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { isReducedMotion, roundOff, throttle } from 'lib/utils'
import { compareVec2Epsilon2 } from 'lang/std/sketch'
import { useModelingContext } from 'hooks/useModelingContext'
import { deg2Rad } from 'lib/utils2d'
import * as TWEEN from '@tweenjs/tween.js'
import { MouseGuard, cameraMouseDragGuards } from 'lib/cameraControls'
import { SourceRange } from 'lang/wasm'
import { Axis } from 'lib/selections'
import { BaseUnit, SETTINGS_PERSIST_KEY } from 'machines/settingsMachine'
import { CameraControls } from './CameraControls'

type SendType = ReturnType<typeof useModelingContext>['send']

// 63.5 is definitely a bit of a magic number, play with it until it looked right
// if it were 64, that would feel like it's something in the engine where a random
// power of 2 is used, but it's the 0.5 seems to make things look much more correct
export const ZOOM_MAGIC_NUMBER = 63.5
const FRAMES_TO_ANIMATE_IN = 30
const ORTHOGRAPHIC_CAMERA_SIZE = 20

export const INTERSECTION_PLANE_LAYER = 1
export const SKETCH_LAYER = 2
export const DEBUG_SHOW_INTERSECTION_PLANE = false
export const DEBUG_SHOW_BOTH_SCENES = true

export const RAYCASTABLE_PLANE = 'raycastable-plane'
export const DEFAULT_PLANES = 'default-planes'

export const X_AXIS = 'xAxis'
export const Y_AXIS = 'yAxis'
export const AXIS_GROUP = 'axisGroup'
export const SKETCH_GROUP_SEGMENTS = 'sketch-group-segments'
export const ARROWHEAD = 'arrowhead'

const tempQuaternion = new Quaternion() // just used for maths

interface ThreeCamValues {
  position: Vector3
  quaternion: Quaternion
  zoom: number
  isPerspective: boolean
  target: Vector3
}

const lastCmdDelay = 50

let lastCmd: EngineCommand | null = null
let lastCmdTime: number = Date.now()
let lastCmdTimeoutId: number | null = null

const sendLastReliableChannel = () => {
  if (lastCmd && Date.now() - lastCmdTime >= lastCmdDelay) {
    engineCommandManager.sendSceneCommand(lastCmd, true)
    lastCmdTime = Date.now()
  }
}

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
  lastCmd = cmd
  lastCmdTime = Date.now()

  if (lastCmdTimeoutId !== null) {
    clearTimeout(lastCmdTimeoutId)
  }
  lastCmdTimeoutId = setTimeout(
    sendLastReliableChannel,
    lastCmdDelay
  ) as any as number
}, 1000 / 30)

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
  1000 / 15
)

interface BaseCallbackArgs2 {
  object: any
  event: any
}
interface BaseCallbackArgs {
  event: any
}
interface OnDragCallbackArgs extends BaseCallbackArgs {
  object: any
  intersection2d: Vector2
  intersectPoint: Vector3
  intersection: Intersection<Object3D<Object3DEventMap>>
}
interface OnClickCallbackArgs extends BaseCallbackArgs {
  intersection2d?: Vector2
  intersectPoint: Vector3
  intersection: Intersection<Object3D<Object3DEventMap>>
  object?: any
}

interface onMoveCallbackArgs {
  event: any
  intersection2d: Vector2
  intersectPoint: Vector3
  intersection: Intersection<Object3D<Object3DEventMap>>
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

// This singleton class is responsible for all of the under the hood setup for the client side scene.
// That is the cameras and switching between them, raycasters for click mouse events and their abstractions (onClick etc), setting up controls.
// Anything that added the the scene for the user to interact with is probably in SceneEntities.ts
class SceneInfra {
  static instance: SceneInfra
  scene: Scene
  camera: PerspectiveCamera | OrthographicCamera = new PerspectiveCamera()
  renderer: WebGLRenderer
  controls: OrbitControls = {} as any
  cameraControls: CameraControls
  isPerspective = true
  fov = 45
  fovBeforeAnimate = 45
  isFovAnimationInProgress = false
  cube: Mesh
  interactionGuards: MouseGuard = cameraMouseDragGuards.KittyCAD
  onDragCallback: (arg: OnDragCallbackArgs) => void = () => {}
  onMoveCallback: (arg: onMoveCallbackArgs) => void = () => {}
  onClickCallback: (arg?: OnClickCallbackArgs) => void = () => {}
  onMouseEnter: (arg: BaseCallbackArgs2) => void = () => {}
  onMouseLeave: (arg: BaseCallbackArgs2) => void = () => {}
  setCallbacks = (callbacks: {
    onDrag?: (arg: OnDragCallbackArgs) => void
    onMove?: (arg: onMoveCallbackArgs) => void
    onClick?: (arg?: OnClickCallbackArgs) => void
    onMouseEnter?: (arg: BaseCallbackArgs2) => void
    onMouseLeave?: (arg: BaseCallbackArgs2) => void
  }) => {
    this.onDragCallback = callbacks.onDrag || this.onDragCallback
    this.onMoveCallback = callbacks.onMove || this.onMoveCallback
    this.onClickCallback = callbacks.onClick || this.onClickCallback
    this.onMouseEnter = callbacks.onMouseEnter || this.onMouseEnter
    this.onMouseLeave = callbacks.onMouseLeave || this.onMouseLeave
    this.selected = null // following selections between callbacks being set is too tricky
  }
  resetMouseListeners = () => {
    sceneInfra.setCallbacks({
      onDrag: () => {},
      onMove: () => {},
      onClick: () => {},
      onMouseEnter: () => {},
      onMouseLeave: () => {},
    })
  }
  highlightCallback: (a: SourceRange) => void = () => {}
  setHighlightCallback(cb: (a: SourceRange) => void) {
    this.highlightCallback = cb
  }

  modelingSend: SendType = (() => {}) as any
  setSend(send: SendType) {
    this.modelingSend = send
  }

  hoveredObject: null | any = null
  raycaster = new Raycaster()
  planeRaycaster = new Raycaster()
  currentMouseVector = new Vector2()
  selected: {
    mouseDownVector: Vector2
    object: any
    hasBeenDragged: boolean
  } | null = null
  selectedObject: null | any = null
  mouseDownVector: null | Vector2 = null

  // reacts hooks into some of this singleton's properties
  reactCameraProperties: ReactCameraProperties = {
    type: 'perspective',
    fov: 12,
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
  }
  reactCameraPropertiesCallback: (a: ReactCameraProperties) => void = () => {}
  setReactCameraPropertiesCallback = (
    cb: (a: ReactCameraProperties) => void
  ) => {
    this.reactCameraPropertiesCallback = cb
  }
  setCam = (camProps: ReactCameraProperties) => {
    if (
      camProps.type === 'perspective' &&
      this.camera instanceof OrthographicCamera
    ) {
      this.cameraControls.usePerspectiveCamera()
    } else if (
      camProps.type === 'orthographic' &&
      this.camera instanceof PerspectiveCamera
    ) {
      this.cameraControls.useOrthographicCamera()
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
    this.controls.update()
  }

  constructor() {
    // SCENE
    this.scene = new Scene()
    this.scene.background = new Color(0x000000)
    this.scene.background = null

    // RENDERER
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true }) // Enable transparency
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x000000, 0) // Set clear color to black with 0 alpha (fully transparent)
    window.addEventListener('resize', this.onWindowResize)

    // CAMERA
    const camHeightDistanceRatio = 0.5
    const baseUnit: BaseUnit =
      JSON.parse(localStorage?.getItem(SETTINGS_PERSIST_KEY) || ('{}' as any))
        .baseUnit || 'mm'
    const baseRadius = 5.6
    const length = baseUnitTomm(baseUnit) * baseRadius
    const ang = Math.atan(camHeightDistanceRatio)
    const x = Math.cos(ang) * length
    const y = Math.sin(ang) * length

    this.cameraControls = new CameraControls(false, this.renderer.domElement, {
      onCameraChange: () => this.onCameraChange(),
    })
    this.cameraControls.camera.layers.enable(SKETCH_LAYER)
    this.cameraControls.camera.position.set(0, -x, y)
    if (DEBUG_SHOW_INTERSECTION_PLANE)
      this.cameraControls.camera.layers.enable(INTERSECTION_PLANE_LAYER)

    // RAYCASTERS
    this.raycaster.layers.enable(SKETCH_LAYER)
    this.raycaster.layers.disable(0)
    this.planeRaycaster.layers.enable(INTERSECTION_PLANE_LAYER)

    // CONTROLS
    // this.controls = this.setupOrbitControls()

    // GRID
    const size = 100
    const divisions = 10
    const gridHelperMaterial = new LineBasicMaterial({
      color: 0x0000ff,
      transparent: true,
      opacity: 0.5,
    })

    // add a basic cube to the scene, debug delete soon
    const geo = new BoxGeometry(1, 1, 1)
    const mat = new MeshBasicMaterial({ color: 0x00ff00 })
    this.cube = new Mesh(geo, mat)
    this.cube.position.set(0, 0, 0)
    this.cube.layers.enable(SKETCH_LAYER)

    this.scene.add(this.cube)

    const gridHelper = new GridHelper(size, divisions, 0x0000ff, 0xffffff)
    gridHelper.material = gridHelperMaterial
    gridHelper.rotation.x = Math.PI / 2
    // this.scene.add(gridHelper) // more of a debug thing, but maybe useful

    const light = new AmbientLight(0x505050) // soft white light
    this.scene.add(light)

    SceneInfra.instance = this
  }
  private _isCamMovingCallback: (isMoving: boolean, isTween: boolean) => void =
    () => {}
  setIsCamMovingCallback(cb: (isMoving: boolean, isTween: boolean) => void) {
    this._isCamMovingCallback = cb
  }
  private _onCamChange: () => void = () => {}
  setOnCamChange(cb: () => void) {
    this._onCamChange = cb
  }
  setInteractionGuards = (guard: MouseGuard) => {
    this.interactionGuards = guard
    this.cameraControls.interactionGuards = guard
  }
  private createPerspectiveCamera = () => {
    const { z_near, z_far } = calculateNearFarFromFOV(this.fov)
    this.camera = new PerspectiveCamera(
      this.fov,
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
  setupOrbitControls = (target?: [number, number, number]): OrbitControls => {
    if (this.controls) this.controls.dispose()
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    if (target) {
      // if we're swapping from perspective to orthographic,
      // we'll need to recreate the orbit controls
      // and most likely want the target to be the same
      this.controls.target.set(...target)
    }
    this.controls.update()
    // this.controls.addEventListener('change', this.onCameraChange)
    // debounce is needed because the start and end events are fired too often for zoom on scroll
    let debounceTimer = 0
    const handleStart = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      this._isCamMovingCallback(true, false)
    }
    const handleEnd = () => {
      debounceTimer = setTimeout(() => {
        this._isCamMovingCallback(false, false)
      }, 400) as any as number
    }
    this.controls.addEventListener('start', handleStart)
    this.controls.addEventListener('end', handleEnd)

    // setMouseGuards is oun patch-package patch to orbit controls
    // see patches/three+0.160.0.patch
    // ;(this.controls as any).setMouseGuards(this.interactionGuards)
    return this.controls
  }
  onStreamStart = () => this.onCameraChange()

  deferReactUpdate = throttle((a: ReactCameraProperties) => {
    this.reactCameraPropertiesCallback(a)
  }, 200)

  onCameraChange = () => {
    const scale = getSceneScale(
      this.cameraControls.camera,
      this.cameraControls.target
    )
    const planesGroup = this.scene.getObjectByName(DEFAULT_PLANES)
    const axisGroup = this.scene
      .getObjectByName(AXIS_GROUP)
      ?.getObjectByName('gridHelper')
    planesGroup && planesGroup.scale.set(scale, scale, scale)
    axisGroup?.name === 'gridHelper' && axisGroup.scale.set(scale, scale, scale)

    const distance = this.cameraControls.target.distanceTo(
      this.cameraControls.camera.position
    )
    if (
      sceneInfra.cameraControls.camera.far / 2.1 < distance ||
      sceneInfra.cameraControls.camera.far / 1.9 > distance
    ) {
      this.cameraControls.camera.far = distance * 2
      this.cameraControls.camera.near = distance / 10
      this.cameraControls.camera.updateProjectionMatrix()
    }

    throttledUpdateEngineCamera({
      quaternion: this.cameraControls.camera.quaternion,
      position: this.cameraControls.camera.position,
      zoom: this.cameraControls.camera.zoom,
      isPerspective: this.cameraControls.isPerspective,
      target: this.cameraControls.target,
    })
    this.deferReactUpdate({
      type: this.cameraControls.isPerspective ? 'perspective' : 'orthographic',
      [this.cameraControls.isPerspective ? 'fov' : 'zoom']:
        this.cameraControls.camera instanceof PerspectiveCamera
          ? this.cameraControls.camera.fov
          : this.cameraControls.camera.zoom,
      position: [
        roundOff(this.cameraControls.camera.position.x, 2),
        roundOff(this.cameraControls.camera.position.y, 2),
        roundOff(this.cameraControls.camera.position.z, 2),
      ],
      quaternion: [
        roundOff(this.cameraControls.camera.quaternion.x, 2),
        roundOff(this.cameraControls.camera.quaternion.y, 2),
        roundOff(this.cameraControls.camera.quaternion.z, 2),
        roundOff(this.cameraControls.camera.quaternion.w, 2),
      ],
    })
    this._onCamChange()
  }

  onWindowResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  animate = () => {
    requestAnimationFrame(this.animate)
    TWEEN.update() // This will update all tweens during the animation loop
    if (!this.isFovAnimationInProgress) {
      // console.log('animation frame', this.cameraControls.camera)
      this.cameraControls.update()
      this.renderer.render(this.scene, this.cameraControls.camera)
    }
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
      this._isCamMovingCallback(true, true)
      const initialQuaternion = camera.quaternion.clone()
      const isVertical = isQuaternionVertical(targetQuaternion)
      let tweenEnd = isVertical ? 0.99 : 1
      const controlsTarget = this.controls.target.clone()
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
        this.controls.target.copy(controlsTarget)
        this.controls.update()
        this.camera.updateProjectionMatrix()
      }

      const onComplete = async () => {
        if (isReducedMotion() && toOrthographic) {
          cameraAtTime(0.99)
          this.useOrthographicCamera()
        } else if (toOrthographic) {
          await this.animateToOrthographic()
        }
        if (isVertical) cameraAtTime(1)
        this.camera.up.set(0, 0, 1)
        this.controls.enableRotate = false
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
      this.isFovAnimationInProgress = true
      let currentFov = this.fov
      this.fovBeforeAnimate = this.fov

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
      this.isFovAnimationInProgress = true
      // Immediately set the camera to perspective with a very low FOV
      this.fov = 4
      let currentFov = 4
      this.camera.updateProjectionMatrix()
      const targetFov = this.fovBeforeAnimate // Target FOV for perspective
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
  dispose = () => {
    // Dispose of scene resources, renderer, and controls
    this.renderer.dispose()
    window.removeEventListener('resize', this.onWindowResize)
    // Dispose of any other resources like geometries, materials, textures
  }

  useOrthographicCamera = () => {
    this.isPerspective = false
    const { x: px, y: py, z: pz } = this.camera.position
    const { x: qx, y: qy, z: qz, w: qw } = this.camera.quaternion
    const { x: tx, y: ty, z: tz } = this.controls.target
    const aspect = window.innerWidth / window.innerHeight
    const { z_near, z_far } = calculateNearFarFromFOV(this.fov)
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
    const distance = this.camera.position.distanceTo(new Vector3(tx, ty, tz))
    const fovFactor = 45 / this.fov
    this.camera.zoom = (ZOOM_MAGIC_NUMBER * fovFactor * 0.8) / distance

    // this.setupOrbitControls([tx, ty, tz])
    this.camera.quaternion.set(qx, qy, qz, qw)
    this.camera.updateProjectionMatrix()
    this.controls.update()
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_orthographic',
      },
    })
  }
  usePerspectiveCamera = () => {
    this.isPerspective = true
    const { x: px, y: py, z: pz } = this.camera.position
    const { x: qx, y: qy, z: qz, w: qw } = this.camera.quaternion
    const { x: tx, y: ty, z: tz } = this.controls.target
    const zoom = this.camera.zoom
    this.camera = this.createPerspectiveCamera()

    this.camera.position.set(px, py, pz)
    this.camera.quaternion.set(qx, qy, qz, qw)
    const zoomFudgeFactor = 2280
    const distance = zoomFudgeFactor / (zoom * this.fov)
    const direction = new Vector3().subVectors(
      this.camera.position,
      this.controls.target
    )
    direction.normalize()
    this.camera.position
      .copy(this.controls.target)
      .addScaledVector(direction, distance)

    // this.setupOrbitControls([tx, ty, tz])

    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_perspective',
        parameters: {
          fov_y: this.camera.fov,
          ...calculateNearFarFromFOV(this.fov),
        },
      },
    })
    this.onCameraChange()
    return this.camera
  }

  dollyZoom = (newFov: number) => {
    if (!(this.camera instanceof PerspectiveCamera)) {
      console.warn('Dolly zoom is only applicable to perspective cameras.')
      return
    }
    this.fov = newFov

    // Calculate the direction vector from the camera towards the controls target
    const direction = new Vector3()
      .subVectors(this.controls.target, this.camera.position)
      .normalize()

    // Calculate the distance to the controls target before changing the FOV
    const distanceBefore = this.camera.position.distanceTo(this.controls.target)

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

    const newPosition = this.controls.target
      .clone()
      .add(direction.multiplyScalar(-distanceAfter))
    this.camera.position.copy(newPosition)

    const { z_near, z_far } = calculateNearFarFromFOV(this.fov)
    this.camera.near = z_near
    this.camera.far = z_far

    throttledUpdateEngineFov({
      fov: newFov,
      position: newPosition,
      quaternion: this.camera.quaternion,
      zoom: this.camera.zoom,
      target: this.controls.target,
    })
  }
  getPlaneIntersectPoint = (): {
    intersection2d?: Vector2
    intersectPoint: Vector3
    intersection: Intersection<Object3D<Object3DEventMap>>
  } | null => {
    this.planeRaycaster.setFromCamera(
      this.currentMouseVector,
      sceneInfra.cameraControls.camera
    )
    const planeIntersects = this.planeRaycaster.intersectObjects(
      this.scene.children,
      true
    )
    if (
      planeIntersects.length > 0 &&
      planeIntersects[0].object.userData.type !== RAYCASTABLE_PLANE
    ) {
      const intersect = planeIntersects[0]
      return {
        intersectPoint: intersect.point,
        intersection: intersect,
      }
    }
    if (
      !(
        planeIntersects.length > 0 &&
        planeIntersects[0].object.userData.type === RAYCASTABLE_PLANE
      )
    )
      return null
    const planePosition = planeIntersects[0].object.position
    const inversePlaneQuaternion = planeIntersects[0].object.quaternion
      .clone()
      .invert()
    const intersectPoint = planeIntersects[0].point
    let transformedPoint = intersectPoint.clone()
    if (transformedPoint) {
      transformedPoint.applyQuaternion(inversePlaneQuaternion)
      transformedPoint?.sub(
        new Vector3(...planePosition).applyQuaternion(inversePlaneQuaternion)
      )
    }

    return {
      intersection2d: new Vector2(transformedPoint.x, transformedPoint.y), // z should be 0
      intersectPoint,
      intersection: planeIntersects[0],
    }
  }
  onMouseMove = (event: MouseEvent) => {
    this.currentMouseVector.x = (event.clientX / window.innerWidth) * 2 - 1
    this.currentMouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1

    const planeIntersectPoint = this.getPlaneIntersectPoint()

    if (this.selected) {
      const hasBeenDragged = !compareVec2Epsilon2(
        [this.currentMouseVector.x, this.currentMouseVector.y],
        [this.selected.mouseDownVector.x, this.selected.mouseDownVector.y],
        0.02
      )
      if (!this.selected.hasBeenDragged && hasBeenDragged) {
        this.selected.hasBeenDragged = true
        // this is where we could fire a onDragStart event
        // console.log('onDragStart', this.selected)
      }
      if (
        hasBeenDragged &&
        planeIntersectPoint &&
        planeIntersectPoint.intersection2d
      ) {
        // // console.log('onDrag', this.selected)

        this.onDragCallback({
          object: this.selected.object,
          event,
          intersection2d: planeIntersectPoint.intersection2d,
          ...planeIntersectPoint,
        })
      }
    } else if (planeIntersectPoint && planeIntersectPoint.intersection2d) {
      this.onMoveCallback({
        event,
        intersection2d: planeIntersectPoint.intersection2d,
        ...planeIntersectPoint,
      })
    }

    const intersect = this.raycastRing()

    if (intersect) {
      const firstIntersectObject = intersect.object
      if (this.hoveredObject !== firstIntersectObject) {
        if (this.hoveredObject) {
          this.onMouseLeave({
            object: this.hoveredObject,
            event,
          })
        }
        this.hoveredObject = firstIntersectObject
        this.onMouseEnter({
          object: this.hoveredObject,
          event,
        })
      }
    } else {
      if (this.hoveredObject) {
        this.onMouseLeave({
          object: this.hoveredObject,
          event,
        })
        this.hoveredObject = null
      }
    }
  }

  raycastRing = (
    pixelRadius = 8,
    rayRingCount = 32
  ): Intersection<Object3D<Object3DEventMap>> | undefined => {
    const mouseDownVector = this.currentMouseVector.clone()
    let closestIntersection:
      | Intersection<Object3D<Object3DEventMap>>
      | undefined = undefined
    let closestDistance = Infinity

    const updateClosestIntersection = (
      intersections: Intersection<Object3D<Object3DEventMap>>[]
    ) => {
      let intersection = null
      for (let i = 0; i < intersections.length; i++) {
        if (intersections[i].object.type !== 'GridHelper') {
          intersection = intersections[i]
          break
        }
      }
      if (!intersection) return

      if (intersection.distance < closestDistance) {
        closestDistance = intersection.distance
        closestIntersection = intersection
      }
    }

    // Check the center point
    this.raycaster.setFromCamera(mouseDownVector, this.camera)
    updateClosestIntersection(
      this.raycaster.intersectObjects(this.scene.children, true)
    )

    // Check the ring points
    for (let i = 0; i < rayRingCount; i++) {
      const angle = (i / rayRingCount) * Math.PI * 2

      const offsetX = ((pixelRadius * Math.cos(angle)) / window.innerWidth) * 2
      const offsetY = ((pixelRadius * Math.sin(angle)) / window.innerHeight) * 2
      const ringVector = new Vector2(
        mouseDownVector.x + offsetX,
        mouseDownVector.y - offsetY
      )
      this.raycaster.setFromCamera(ringVector, this.camera)
      updateClosestIntersection(
        this.raycaster.intersectObjects(this.scene.children, true)
      )
    }
    return closestIntersection
  }

  onMouseDown = (event: MouseEvent) => {
    this.currentMouseVector.x = (event.clientX / window.innerWidth) * 2 - 1
    this.currentMouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1

    const mouseDownVector = this.currentMouseVector.clone()
    const intersect = this.raycastRing()

    if (intersect) {
      const intersectParent = intersect?.object?.parent as Group
      this.selected = intersectParent.isGroup
        ? {
            mouseDownVector,
            object: intersect?.object,
            hasBeenDragged: false,
          }
        : null
    }
  }

  onMouseUp = (event: MouseEvent) => {
    this.currentMouseVector.x = (event.clientX / window.innerWidth) * 2 - 1
    this.currentMouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1
    const planeIntersectPoint = this.getPlaneIntersectPoint()

    if (this.selected) {
      if (this.selected.hasBeenDragged) {
        // this is where we could fire a onDragEnd event
        // console.log('onDragEnd', this.selected)
      } else if (planeIntersectPoint) {
        // fire onClick event as there was no drags
        this.onClickCallback({
          object: this.selected?.object,
          event,
          ...planeIntersectPoint,
        })
      } else {
        this.onClickCallback()
      }
      // Clear the selected state whether it was dragged or not
      this.selected = null
    } else if (planeIntersectPoint) {
      this.onClickCallback({
        event,
        ...planeIntersectPoint,
      })
    } else {
      this.onClickCallback()
    }
  }
  showDefaultPlanes() {
    const addPlane = (
      rotation: { x: number; y: number; z: number }, //
      type: DefaultPlane
    ): Mesh => {
      const planeGeometry = new PlaneGeometry(100, 100)
      const planeMaterial = new MeshBasicMaterial({
        color: defaultPlaneColor(type),
        transparent: true,
        opacity: 0.0,
        side: DoubleSide,
        depthTest: false, // needed to avoid transparency issues
      })
      const plane = new Mesh(planeGeometry, planeMaterial)
      plane.rotation.x = rotation.x
      plane.rotation.y = rotation.y
      plane.rotation.z = rotation.z
      plane.userData.type = type
      plane.name = type
      return plane
    }
    const planes = [
      addPlane({ x: 0, y: Math.PI / 2, z: 0 }, YZ_PLANE),
      addPlane({ x: 0, y: 0, z: 0 }, XY_PLANE),
      addPlane({ x: -Math.PI / 2, y: 0, z: 0 }, XZ_PLANE),
    ]
    const planesGroup = new Group()
    planesGroup.userData.type = DEFAULT_PLANES
    planesGroup.name = DEFAULT_PLANES
    planesGroup.add(...planes)
    planesGroup.traverse((child) => {
      if (child instanceof Mesh) {
        child.layers.enable(SKETCH_LAYER)
      }
    })
    planesGroup.layers.enable(SKETCH_LAYER)
    const sceneScale = getSceneScale(
      this.cameraControls.camera,
      this.cameraControls.target
    )
    planesGroup.scale.set(sceneScale, sceneScale, sceneScale)
    this.scene.add(planesGroup)
  }
  removeDefaultPlanes() {
    const planesGroup = this.scene.children.find(
      ({ userData }) => userData.type === DEFAULT_PLANES
    )
    if (planesGroup) this.scene.remove(planesGroup)
  }
  updateOtherSelectionColors = (otherSelections: Axis[]) => {
    const axisGroup = sceneInfra.scene.children.find(
      ({ userData }) => userData?.type === AXIS_GROUP
    )
    const axisMap: { [key: string]: Axis } = {
      [X_AXIS]: 'x-axis',
      [Y_AXIS]: 'y-axis',
    }
    axisGroup?.children.forEach((_mesh) => {
      const mesh = _mesh as Mesh
      const mat = mesh.material as MeshBasicMaterial
      if (otherSelections.includes(axisMap[mesh.userData?.type])) {
        mat.color.set(mesh?.userData?.baseColor)
        mat.color.offsetHSL(0, 0, 0.2)
        mesh.userData.isSelected = true
      } else {
        mat.color.set(mesh?.userData?.baseColor)
        mesh.userData.isSelected = false
      }
    })
  }
}

export const sceneInfra = new SceneInfra()

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

function calculateNearFarFromFOV(fov: number) {
  const nearFarRatio = (fov - 3) / (45 - 3)
  // const z_near = 0.1 + nearFarRatio * (5 - 0.1)
  const z_far = 1000 + nearFarRatio * (100000 - 1000)
  return { z_near: 0.1, z_far }
}

export function getSceneScale(
  camera: PerspectiveCamera | OrthographicCamera,
  target: Vector3
): number {
  const distance =
    camera instanceof PerspectiveCamera
      ? camera.position.distanceTo(target)
      : 63.7942123 / camera.zoom

  if (distance <= 20) return 0.1
  else if (distance > 20 && distance <= 200) return 1
  else if (distance > 200 && distance <= 2000) return 10
  else if (distance > 2000 && distance <= 20000) return 100
  else if (distance > 20000) return 1000

  return 1
}

function baseUnitTomm(baseUnit: BaseUnit) {
  switch (baseUnit) {
    case 'mm':
      return 1
    case 'cm':
      return 10
    case 'm':
      return 1000
    case 'in':
      return 25.4
    case 'ft':
      return 304.8
    case 'yd':
      return 914.4
  }
}

export function isQuaternionVertical(q: Quaternion) {
  const v = new Vector3(0, 0, 1).applyQuaternion(q)
  // no x or y components means it's vertical
  return compareVec2Epsilon2([v.x, v.y], [0, 0])
}

export type DefaultPlane =
  | 'xy-default-plane'
  | 'xz-default-plane'
  | 'yz-default-plane'

export const XY_PLANE: DefaultPlane = 'xy-default-plane'
export const XZ_PLANE: DefaultPlane = 'xz-default-plane'
export const YZ_PLANE: DefaultPlane = 'yz-default-plane'

export function defaultPlaneColor(
  plane: DefaultPlane,
  lowCh = 0.1,
  highCh = 0.7
): Color {
  switch (plane) {
    case XY_PLANE:
      return new Color(highCh, lowCh, lowCh)
    case XZ_PLANE:
      return new Color(lowCh, lowCh, highCh)
    case YZ_PLANE:
      return new Color(lowCh, highCh, lowCh)
  }
  return new Color(lowCh, lowCh, lowCh)
}
