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
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { useRef, useEffect } from 'react'
import { engineCommandManager } from 'lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { throttle } from 'lib/utils'
import { compareVec2Epsilon2 } from 'lang/std/sketch'
import { useModelingContext } from 'hooks/useModelingContext'
import { deg2Rad } from 'lib/utils2d'
import * as TWEEN from '@tweenjs/tween.js'

// 63.5 is definitely a bit of a magic number, play with it until it looked right
// if it were 64, that would feel like it's something in the engine where a random
// power of 2 is used, but it's the 0.5 seems to make things look much more correct
const ZOOM_MAGIC_NUMBER = 63.5
const FRAMES_TO_ANIMATE_IN = 30
const ORTHOGRAPHIC_CAMERA_SIZE = 20

export const INTERSECTION_PLANE_LAYER = 1
export const SKETCH_LAYER = 2
const DEBUG_SHOW_INTERSECTION_PLANE = false

const tempQuaternion = new Quaternion() // just used for maths

interface ThreeCamValues {
  position: Vector3
  quaternion: Quaternion
  zoom: number
  isPerspective: boolean
}

const throttledUpdateEngineCamera = throttle(
  (threeValues: ThreeCamValues) =>
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        ...convertThreeCamValuesToEngineCam(threeValues),
      },
    }),
  1000 / 30
)

const throttledUpdateEngineFov = throttle(
  (vals: {
    position: Vector3
    quaternion: Quaternion
    zoom: number
    fov: number
  }) => updateEngineFov(vals),
  1000 / 15
)

class SetupSingleton {
  static instance: SetupSingleton
  scene: Scene
  camera: PerspectiveCamera | OrthographicCamera
  renderer: WebGLRenderer
  controls: OrbitControls
  isPerspective = true
  fov = 45
  fovBeforeAnimate = 45
  isFovAnimationInProgress = false
  onDragCallback: (arg: {
    object: any
    event: any
    intersectPoint: Vector3
    intersection2d: Vector2
  }) => void = () => {}
  setOnDragCallback = (
    callback: (arg: {
      object: any
      event: any
      intersectPoint: Vector3
      intersection2d: Vector2
    }) => void
  ) => {
    this.onDragCallback = callback
  }

  hoveredObject: null | Group = null
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

  constructor() {
    // SCENE
    this.scene = new Scene()
    this.scene.background = new Color(0x000000)
    this.scene.background = null

    // CAMERA
    this.camera = this.createPerspectiveCamera()
    this.camera.position.set(0, -128, 64)
    if (DEBUG_SHOW_INTERSECTION_PLANE)
      this.camera.layers.enable(INTERSECTION_PLANE_LAYER)

    // RENDERER
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true }) // Enable transparency
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x000000, 0) // Set clear color to black with 0 alpha (fully transparent)
    window.addEventListener('resize', this.onWindowResize)

    // RAYCASTERS
    this.raycaster.layers.enable(SKETCH_LAYER)
    this.planeRaycaster.layers.enable(INTERSECTION_PLANE_LAYER)

    // CONTROLS
    this.controls = this.setupOrbitControls()

    // GRID
    const size = 100
    const divisions = 10
    const gridHelperMaterial = new LineBasicMaterial({
      color: 0x0000ff,
      transparent: true,
      opacity: 0.5,
    })

    const gridHelper = new GridHelper(size, divisions, 0x0000ff, 0xffffff)
    gridHelper.material = gridHelperMaterial
    gridHelper.rotation.x = Math.PI / 2
    this.scene.add(gridHelper) // more of a debug thing, but maybe useful

    const light = new AmbientLight(0x505050) // soft white light
    this.scene.add(light)

    window.addEventListener('mousemove', this.onMouseMove, false)
    window.addEventListener('mousedown', this.onMouseDown, false)
    window.addEventListener('mouseup', this.onMouseUp, false)

    SetupSingleton.instance = this
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
    this.controls.addEventListener('change', this.updateEngineCamera)
    return this.controls
  }
  onStreamStart = () => this.updateEngineCamera()

  updateEngineCamera = () =>
    throttledUpdateEngineCamera({
      quaternion: this.camera.quaternion,
      position: this.camera.position,
      zoom: this.camera.zoom,
      isPerspective: this.isPerspective,
    })

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
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  animate = () => {
    requestAnimationFrame(this.animate)
    TWEEN.update() // This will update all tweens during the animation loop
    if (!this.isFovAnimationInProgress)
      this.renderer.render(this.scene, this.camera)
  }
  tweenCameraToQuaternion(
    targetQuaternion: Quaternion,
    duration: number = 500
  ) {
    const camera = this.camera
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
      this.camera.position
        .set(0, 0, 1)
        .applyQuaternion(currentQ)
        .multiplyScalar(initialDistance)
        .add(controlsTarget)
      this.camera.up.set(0, 1, 0).applyQuaternion(currentQ).normalize()
      this.camera.quaternion.copy(currentQ)
      this.controls.target.copy(controlsTarget)
      this.controls.update()
    }

    new TWEEN.Tween({ t: 0 })
      .to({ t: tweenEnd }, duration)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onUpdate(({ t }) => cameraAtTime(t))
      .onComplete(() => {
        this.useOrthographicCamera()
        if (isVertical) cameraAtTime(1)
        this.camera.up.set(0, 0, 1)
      })
      .start()
  }

  animateToOrthographic = () => {
    this.isFovAnimationInProgress = true
    let currentFov = this.fov
    this.fovBeforeAnimate = this.fov

    const targetFov = 4
    const fovAnimationStep = (currentFov - targetFov) / FRAMES_TO_ANIMATE_IN

    const animateFovChange = () => {
      if (this.camera instanceof PerspectiveCamera) {
        if (this.camera.fov > targetFov) {
          // Decrease the FOV
          currentFov = Math.max(currentFov - fovAnimationStep, targetFov)
          this.camera.updateProjectionMatrix()
          this.dollyZoom(currentFov)
          requestAnimationFrame(animateFovChange) // Continue the animation
        } else {
          setTimeout(() => {
            // Once the target FOV is reached, switch to the orthographic camera
            // Needs to wait a frame a couple frames after the FOV animation is complete
            this.useOrthographicCamera()
            this.isFovAnimationInProgress = false
          }, 50)
        }
      }
    }

    animateFovChange() // Start the animation
  }
  animateToPerspective = () => {
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
      }
    }
    animateFovChange() // Start the animation
  }
  dispose = () => {
    // Dispose of scene resources, renderer, and controls
    this.renderer.dispose()
    window.removeEventListener('resize', this.onWindowResize)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
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

    this.setupOrbitControls([tx, ty, tz])
    // in the case where I want to set the quaternion looking up i.e. new Quaternion(1, 0, 0, 0)
    this.camera.quaternion.set(qx, qy, qz, qw)
    this.camera.updateProjectionMatrix()
    this.controls.update()

    engineCommandManager.sendSceneCommand({
      // we have to change set the perspective camera first purely to update the z_near
      // after which we set the orthographic camera
      // TODO make an engine issue that allows z_near, z_far to be set on the orthographic camera
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_perspective',
        parameters: {
          fov_y: this.fov,
          z_near: 0.1,
          z_far: 1000,
        },
      },
    })
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_orthographic',
      },
    })
    this.updateEngineCamera()
  }
  usePerspectiveCamera = () => {
    this.isPerspective = true
    const { x: px, y: py, z: pz } = this.camera.position
    const { x: qx, y: qy, z: qz, w: qw } = this.camera.quaternion
    const { x: tx, y: ty, z: tz } = this.controls.target
    this.camera = this.createPerspectiveCamera()

    this.camera.position.set(px, py, pz)
    this.camera.quaternion.set(qx, qy, qz, qw)

    this.setupOrbitControls([tx, ty, tz])

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
    this.updateEngineCamera()
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

    // Update the camera position
    this.camera.position.copy(newPosition)

    const { z_near, z_far } = calculateNearFarFromFOV(this.fov)
    this.camera.near = z_near
    this.camera.far = z_far

    throttledUpdateEngineFov({
      fov: newFov,
      position: newPosition,
      quaternion: this.camera.quaternion,
      zoom: this.camera.zoom,
    })
  }
  onMouseMove = (event: MouseEvent) => {
    this.currentMouseVector.x = (event.clientX / window.innerWidth) * 2 - 1
    this.currentMouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1

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
      if (hasBeenDragged) {
        // TODO - this is where we could fire a onDrag event
        this.planeRaycaster.setFromCamera(
          this.currentMouseVector,
          setupSingleton.camera
        )
        const intersects = this.planeRaycaster.intersectObjects(
          this.scene.children,
          true
        )
        // console.log('onDrag', this.selected)
        if (
          intersects.length > 0 &&
          intersects[0].object.userData.type === 'raycastable-plane'
        ) {
          const planePosition = intersects[0].object.position
          const inversePlaneQuaternion = intersects[0].object.quaternion
            .clone()
            .invert()
          const intersectPoint = intersects[0].point
          let transformedPoint = intersectPoint.clone()
          if (transformedPoint) {
            transformedPoint.applyQuaternion(inversePlaneQuaternion)
            transformedPoint?.sub(
              new Vector3(...planePosition).applyQuaternion(
                inversePlaneQuaternion
              )
            )
          }

          const intersection2d = new Vector2(
            transformedPoint.x,
            transformedPoint.y
          ) // z should be 0

          this.onDragCallback({
            object: this.selected.object,
            event,
            intersectPoint,
            intersection2d,
          })
        }
      }
    }

    // TODO hover logic later
    // Update the raycaster with the camera and mouse position
    this.raycaster.setFromCamera(this.currentMouseVector, this.camera)

    // Calculate objects intersecting the picking ray
    const intersects = this.raycaster.intersectObjects(
      this.scene.children,
      true
    )

    if (intersects.length > 0) {
      // console.log('hover on', intersects[0])
    }

    // const intersect = intersects[0]?.object

    // if (intersects.length > 0) {
    //   const intersectParent = intersect.parent as Group
    //   if (!intersectParent.isGroup) {
    //     console.warn('intersectParent is not a group', intersectParent)
    //   }
    //   // give priority to something being dragged
    //   if (this.mouseDownVector ) {
    //     // Potentially mouse move need to get the epsilon value from mouseDownVector
    //     const isDragged = compareVec2Epsilon([this.currentMouseVector.x, this.currentMouseVector.y], [this.mouseDownVector.x, this.mouseDownVector.y])
    //   }

    //   console.log('intersectParent', intersectParent)

    //   // console.log(intersects)
    //   if (this.hoveredObject !== intersectParent) {
    //     // leave logic needed for oldHoveredObject
    //     this.hoveredObject = intersectParent
    //     // enter logic needed for newHoveredObject

    //     // Mouse leave
    //     // this.hoveredObject?.userData?.onMouseLeave?.(this.hoveredObject)
    //     // // Mouse enter
    //     // intersect.userData.onMouseEnter?.(this.hoveredObject)
    //   } if (this.hoveredObject === null) {
    //     // Mouse enter logic needed for newHoveredObject
    //   }

    // } else {
    //   // Mouse leave
    //   // this.hoveredObject?.userData?.onMouseLeave?.(this.hoveredObject)
    //   this.hoveredObject = null
    // }
  }

  onMouseDown = (event: MouseEvent) => {
    this.currentMouseVector.x = (event.clientX / window.innerWidth) * 2 - 1
    this.currentMouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1

    const mouseDownVector = this.currentMouseVector.clone()
    this.raycaster.setFromCamera(mouseDownVector, this.camera)

    // Calculate objects intersecting the picking ray
    const intersects = this.raycaster.intersectObjects(
      this.scene.children,
      true
    )

    if (intersects.length > 0) {
      const intersectParent = intersects?.[0]?.object?.parent as Group
      this.selected = intersectParent.isGroup
        ? {
            mouseDownVector,
            object: intersects?.[0]?.object,
            hasBeenDragged: false,
          }
        : null
    }
  }

  onMouseUp = (event: MouseEvent) => {
    if (this.selected && this.selected.hasBeenDragged) {
      // this is where we could fire a onDragEnd event
      // console.log('onDragEnd', this.selected)
      this.selected = null
    }
  }
}

export const setupSingleton = new SetupSingleton()

export const ClientSideScene = () => {
  const canvasRef = useRef<HTMLDivElement>(null)
  const { state } = useModelingContext()

  useEffect(() => {
    if (!canvasRef.current) return
    canvasRef.current.appendChild(setupSingleton.renderer.domElement)
    setupSingleton.animate()
  }, [])

  return (
    <div
      ref={canvasRef}
      className={`absolute inset-0 h-full w-full ${
        state.matches('Sketch') ? 'bg-black/80' : ''
      }`}
    ></div>
  )
}

function convertThreeCamValuesToEngineCam({
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
      center: lookAtVector,
      up: upVector,
      vantage: position,
    }
  }
  const zoomFactor = -ZOOM_MAGIC_NUMBER / zoom
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
  const z_near = 0.1 + nearFarRatio * (5 - 0.1)
  const z_far = 1000 + nearFarRatio * (100000 - 1000)
  return { z_near: 0.1, z_far }
}

function updateEngineFov(args: {
  position: Vector3
  quaternion: Quaternion
  zoom: number
  fov: number
}) {
  engineCommandManager.sendSceneCommand(
    {
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_perspective_settings',
        ...convertThreeCamValuesToEngineCam({
          ...args,
          isPerspective: true,
        }),
        fov_y: args.fov,
        ...calculateNearFarFromFOV(args.fov),
      },
    } as any /* TODO - this command isn't in the spec yet, remove any when it is */
  )
}

export function isQuaternionVertical(q: Quaternion) {
  const v = new Vector3(0, 0, 1).applyQuaternion(q)
  // no x or y components means it's vertical
  return compareVec2Epsilon2([v.x, v.y], [0, 0])
}
