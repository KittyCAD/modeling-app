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
  EdgesGeometry,
  MeshBasicMaterial,
  Mesh,
  LineSegments,
  DoubleSide,
  Intersection,
  Object3D,
  Object3DEventMap,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { useRef, useEffect, useState } from 'react'
import { engineCommandManager } from 'lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { isReducedMotion, throttle } from 'lib/utils'
import { compareVec2Epsilon2 } from 'lang/std/sketch'
import { useModelingContext } from 'hooks/useModelingContext'
import { deg2Rad } from 'lib/utils2d'
import * as TWEEN from '@tweenjs/tween.js'
import { MouseGuard, cameraMouseDragGuards } from 'lib/cameraControls'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'
import { SourceRange } from 'lang/wasm'
import { useStore } from 'useStore'

type SendType = ReturnType<typeof useModelingContext>['send']

// 63.5 is definitely a bit of a magic number, play with it until it looked right
// if it were 64, that would feel like it's something in the engine where a random
// power of 2 is used, but it's the 0.5 seems to make things look much more correct
const ZOOM_MAGIC_NUMBER = 63.5
const FRAMES_TO_ANIMATE_IN = 30
const ORTHOGRAPHIC_CAMERA_SIZE = 20

export const INTERSECTION_PLANE_LAYER = 1
export const SKETCH_LAYER = 2
const DEBUG_SHOW_INTERSECTION_PLANE = false
export const DEBUG_SHOW_BOTH_SCENES = false

export const RAYCASTABLE_PLANE = 'raycastable-plane'
export const DEFAULT_PLANES = 'default-planes'

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
    this.raycaster.layers.disable(0)
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
    // this.scene.add(gridHelper) // more of a debug thing, but maybe useful

    const light = new AmbientLight(0x505050) // soft white light
    this.scene.add(light)

    SetupSingleton.instance = this
  }
  private _isCamMovingCallback: (isMoving: boolean, isTween: boolean) => void =
    () => {}
  setIsCamMovingCallback(cb: (isMoving: boolean, isTween: boolean) => void) {
    this._isCamMovingCallback = cb
  }
  setInteractionGuards = (guard: MouseGuard) => {
    this.interactionGuards = guard
    // setMouseGuards is oun patch-package patch to orbit controls
    // see patches/three+0.160.0.patch
    ;(this.controls as any).setMouseGuards(guard)
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
    // debounce is needed because the start and end events are fired too often for zoom on scroll
    let debounceTimer = 0
    const handleStart = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      this._isCamMovingCallback(true, false)
    }
    const handleEnd = () => {
      debounceTimer = setTimeout(() => {
        this._isCamMovingCallback(false, false)
      }, 200) as any as number
    }
    this.controls.addEventListener('start', handleStart)
    this.controls.addEventListener('end', handleEnd)

    // setMouseGuards is oun patch-package patch to orbit controls
    // see patches/three+0.160.0.patch
    ;(this.controls as any).setMouseGuards(this.interactionGuards)
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

    new TWEEN.Tween({ t: 0 })
      .to({ t: tweenEnd }, duration)
      .easing(TWEEN.Easing.Quadratic.InOut)
      .onUpdate(({ t }) => cameraAtTime(t))
      .onComplete(async () => {
        if (isReducedMotion()) {
          this.useOrthographicCamera()
        } else {
          await this.animateToOrthographic()
        }
        if (isVertical) cameraAtTime(1)
        this.camera.up.set(0, 0, 1)
        this.controls.enableRotate = false
        this._isCamMovingCallback(false, true)
      })
      .start()
  }

  animateToOrthographic = () =>
    new Promise((resolve) => {
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
              resolve(true)
            }, 100)
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

    this.setupOrbitControls([tx, ty, tz])
    // in the case where I want to set the quaternion looking up i.e. new Quaternion(1, 0, 0, 0)
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
  getPlaneIntersectPoint = (): {
    intersection2d?: Vector2
    intersectPoint: Vector3
    intersection: Intersection<Object3D<Object3DEventMap>>
  } | null => {
    this.planeRaycaster.setFromCamera(
      this.currentMouseVector,
      setupSingleton.camera
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
      if (
        intersections.length > 0 &&
        intersections[0].distance < closestDistance
      ) {
        closestDistance = intersections[0].distance
        closestIntersection = intersections[0]
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
      const planeEdges = new EdgesGeometry(planeGeometry)
      const lineMaterial = new LineBasicMaterial({
        color: defaultPlaneColor(type, 0.45, 1),
        opacity: 0.9,
      })
      const planeMaterial = new MeshBasicMaterial({
        color: defaultPlaneColor(type),
        transparent: true,
        opacity: 0.35,
        side: DoubleSide,
        // blendAlpha: true,
      })
      const plane = new Mesh(planeGeometry, planeMaterial)
      const edges = new LineSegments(planeEdges, lineMaterial)
      plane.add(edges)
      plane.rotation.x = rotation.x
      plane.rotation.y = rotation.y
      plane.rotation.z = rotation.z
      plane.userData.type = type
      return plane
    }
    const planes = [
      addPlane({ x: 0, y: Math.PI / 2, z: 0 }, YZ_PLANE),
      addPlane({ x: 0, y: 0, z: 0 }, XY_PLANE),
      addPlane({ x: -Math.PI / 2, y: 0, z: 0 }, XZ_PLANE),
    ]
    const planesGroup = new Group()
    planesGroup.userData.type = DEFAULT_PLANES
    planesGroup.add(...planes)
    planesGroup.traverse((child) => {
      if (child instanceof Mesh) {
        child.layers.enable(SKETCH_LAYER)
      }
    })
    planesGroup.layers.enable(SKETCH_LAYER)
    this.scene.add(planesGroup)
  }
  removeDefaultPlanes() {
    const planesGroup = this.scene.children.find(
      ({ userData }) => userData.type === DEFAULT_PLANES
    )
    if (planesGroup) this.scene.remove(planesGroup)
  }
}

export const setupSingleton = new SetupSingleton()

function useShouldHideScene(): { hideClient: boolean; hideServer: boolean } {
  const [isCamMoving, setIsCamMoving] = useState(false)
  const [isTween, setIsTween] = useState(false)

  const { state } = useModelingContext()

  useEffect(() => {
    setupSingleton.setIsCamMovingCallback((isMoving, isTween) => {
      setIsCamMoving(isMoving)
      setIsTween(isTween)
    })
  }, [])

  if (DEBUG_SHOW_BOTH_SCENES || !isCamMoving)
    return { hideClient: false, hideServer: false }
  let hideServer = state.matches('Sketch')
  if (isTween) {
    hideServer = false
  }

  return { hideClient: !hideServer, hideServer }
}

export const ClientSideScene = ({
  cameraControls,
}: {
  cameraControls: ReturnType<
    typeof useGlobalStateContext
  >['settings']['context']['cameraControls']
}) => {
  const canvasRef = useRef<HTMLDivElement>(null)
  const { state, send } = useModelingContext()
  const { hideClient, hideServer } = useShouldHideScene()
  const { setHighlightRange } = useStore((s) => ({
    setHighlightRange: s.setHighlightRange,
    highlightRange: s.highlightRange,
  }))

  // Listen for changes to the camera controls setting
  // and update the client-side scene's controls accordingly.
  useEffect(() => {
    setupSingleton.setInteractionGuards(cameraMouseDragGuards[cameraControls])
  }, [cameraControls])

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    canvas.appendChild(setupSingleton.renderer.domElement)
    setupSingleton.animate()
    setupSingleton.setHighlightCallback(setHighlightRange)
    canvas.addEventListener('mousemove', setupSingleton.onMouseMove, false)
    canvas.addEventListener('mousedown', setupSingleton.onMouseDown, false)
    canvas.addEventListener('mouseup', setupSingleton.onMouseUp, false)
    setupSingleton.setSend(send)
    return () => {
      canvas?.removeEventListener('mousemove', setupSingleton.onMouseMove)
      canvas?.removeEventListener('mousedown', setupSingleton.onMouseDown)
      canvas?.removeEventListener('mouseup', setupSingleton.onMouseUp)
    }
  }, [])

  return (
    <div
      ref={canvasRef}
      className={`absolute inset-0 h-full w-full transition-all duration-300 ${
        hideClient ? 'opacity-0' : 'opacity-100'
      } ${hideServer ? 'bg-black' : ''} ${
        !hideClient && !hideServer && state.matches('Sketch')
          ? 'bg-black/80'
          : ''
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
