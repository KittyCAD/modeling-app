import {
  AmbientLight,
  Color,
  GridHelper,
  LineBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
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
} from 'three'
import { compareVec2Epsilon2 } from 'lang/std/sketch'
import { useModelingContext } from 'hooks/useModelingContext'
import * as TWEEN from '@tweenjs/tween.js'
import { SourceRange } from 'lang/wasm'
import { Axis } from 'lib/selections'
import { BaseUnit, SETTINGS_PERSIST_KEY } from 'machines/settingsMachine'
import { CameraControls } from './CameraControls'

type SendType = ReturnType<typeof useModelingContext>['send']

// 63.5 is definitely a bit of a magic number, play with it until it looked right
// if it were 64, that would feel like it's something in the engine where a random
// power of 2 is used, but it's the 0.5 seems to make things look much more correct
export const ZOOM_MAGIC_NUMBER = 63.5

export const INTERSECTION_PLANE_LAYER = 1
export const SKETCH_LAYER = 2
export const DEBUG_SHOW_INTERSECTION_PLANE = false
export const DEBUG_SHOW_BOTH_SCENES = false

export const RAYCASTABLE_PLANE = 'raycastable-plane'
export const DEFAULT_PLANES = 'default-planes'

export const X_AXIS = 'xAxis'
export const Y_AXIS = 'yAxis'
export const AXIS_GROUP = 'axisGroup'
export const SKETCH_GROUP_SEGMENTS = 'sketch-group-segments'
export const ARROWHEAD = 'arrowhead'

export interface OnMouseEnterLeaveArgs {
  selected: Object3D<Object3DEventMap>
  mouseEvent: MouseEvent
}

interface OnDragCallbackArgs extends OnMouseEnterLeaveArgs {
  intersectionPoint: {
    twoD: Vector2
    threeD: Vector3
  }
  intersects: Intersection<Object3D<Object3DEventMap>>[]
}
interface OnClickCallbackArgs {
  mouseEvent: MouseEvent
  intersectionPoint?: {
    twoD: Vector2
    threeD: Vector3
  }
  intersects: Intersection<Object3D<Object3DEventMap>>[]
  selected?: Object3D<Object3DEventMap>
}

interface OnMoveCallbackArgs {
  mouseEvent: MouseEvent
  intersectionPoint: {
    twoD: Vector2
    threeD: Vector3
  }
  intersects: Intersection<Object3D<Object3DEventMap>>[]
  selected?: Object3D<Object3DEventMap>
}

// This singleton class is responsible for all of the under the hood setup for the client side scene.
// That is the cameras and switching between them, raycasters for click mouse events and their abstractions (onClick etc), setting up controls.
// Anything that added the the scene for the user to interact with is probably in SceneEntities.ts
class SceneInfra {
  static instance: SceneInfra
  scene: Scene
  renderer: WebGLRenderer
  camControls: CameraControls
  isPerspective = true
  fov = 45
  fovBeforeAnimate = 45
  isFovAnimationInProgress = false
  _baseUnit: BaseUnit = 'mm'
  _baseUnitMultiplier = 1
  onDragCallback: (arg: OnDragCallbackArgs) => void = () => {}
  onMoveCallback: (arg: OnMoveCallbackArgs) => void = () => {}
  onClickCallback: (arg?: OnClickCallbackArgs) => void = () => {}
  onMouseEnter: (arg: OnMouseEnterLeaveArgs) => void = () => {}
  onMouseLeave: (arg: OnMouseEnterLeaveArgs) => void = () => {}
  setCallbacks = (callbacks: {
    onDrag?: (arg: OnDragCallbackArgs) => void
    onMove?: (arg: OnMoveCallbackArgs) => void
    onClick?: (arg?: OnClickCallbackArgs) => void
    onMouseEnter?: (arg: OnMouseEnterLeaveArgs) => void
    onMouseLeave?: (arg: OnMouseEnterLeaveArgs) => void
  }) => {
    this.onDragCallback = callbacks.onDrag || this.onDragCallback
    this.onMoveCallback = callbacks.onMove || this.onMoveCallback
    this.onClickCallback = callbacks.onClick || this.onClickCallback
    this.onMouseEnter = callbacks.onMouseEnter || this.onMouseEnter
    this.onMouseLeave = callbacks.onMouseLeave || this.onMouseLeave
    this.selected = null // following selections between callbacks being set is too tricky
  }
  set baseUnit(unit: BaseUnit) {
    this._baseUnit = unit
    this._baseUnitMultiplier = baseUnitTomm(unit)
    this.scene.scale.set(
      this._baseUnitMultiplier,
      this._baseUnitMultiplier,
      this._baseUnitMultiplier
    )
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
    object: Object3D<Object3DEventMap>
    hasBeenDragged: boolean
  } | null = null
  mouseDownVector: null | Vector2 = null

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

    this.camControls = new CameraControls(false, this.renderer.domElement)
    this.camControls.subscribeToCamChange(() => this.onCameraChange())
    this.camControls.camera.layers.enable(SKETCH_LAYER)
    this.camControls.camera.position.set(0, -x, y)
    if (DEBUG_SHOW_INTERSECTION_PLANE)
      this.camControls.camera.layers.enable(INTERSECTION_PLANE_LAYER)

    // RAYCASTERS
    this.raycaster.layers.enable(SKETCH_LAYER)
    this.raycaster.layers.disable(0)
    this.planeRaycaster.layers.enable(INTERSECTION_PLANE_LAYER)

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

    SceneInfra.instance = this
  }

  onCameraChange = () => {
    const scale = getSceneScale(
      this.camControls.camera,
      this.camControls.target
    )
    const planesGroup = this.scene.getObjectByName(DEFAULT_PLANES)
    const axisGroup = this.scene
      .getObjectByName(AXIS_GROUP)
      ?.getObjectByName('gridHelper')
    planesGroup &&
      planesGroup.scale.set(
        scale / sceneInfra._baseUnitMultiplier,
        scale / sceneInfra._baseUnitMultiplier,
        scale / sceneInfra._baseUnitMultiplier
      )
    axisGroup?.name === 'gridHelper' && axisGroup.scale.set(scale, scale, scale)
  }

  onWindowResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  animate = () => {
    requestAnimationFrame(this.animate)
    TWEEN.update() // This will update all tweens during the animation loop
    if (!this.isFovAnimationInProgress) {
      // console.log('animation frame', this.cameraControls.camera)
      this.camControls.update()
      this.renderer.render(this.scene, this.camControls.camera)
    }
  }

  dispose = () => {
    // Dispose of scene resources, renderer, and controls
    this.renderer.dispose()
    window.removeEventListener('resize', this.onWindowResize)
    // Dispose of any other resources like geometries, materials, textures
  }
  getPlaneIntersectPoint = (): {
    twoD?: Vector2
    threeD?: Vector3
    intersection: Intersection<Object3D<Object3DEventMap>>
  } | null => {
    this.planeRaycaster.setFromCamera(
      this.currentMouseVector,
      sceneInfra.camControls.camera
    )
    const planeIntersects = this.planeRaycaster.intersectObjects(
      this.scene.children,
      true
    )
    const recastablePlaneIntersect = planeIntersects.find(
      (intersect) => intersect.object.name === RAYCASTABLE_PLANE
    )
    if (!planeIntersects.length) return null
    if (!recastablePlaneIntersect) return { intersection: planeIntersects[0] }
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
      twoD: new Vector2(
        transformedPoint.x / this._baseUnitMultiplier,
        transformedPoint.y / this._baseUnitMultiplier
      ), // z should be 0
      threeD: intersectPoint.divideScalar(this._baseUnitMultiplier),
      intersection: planeIntersects[0],
    }
  }
  onMouseMove = (mouseEvent: MouseEvent) => {
    this.currentMouseVector.x = (mouseEvent.clientX / window.innerWidth) * 2 - 1
    this.currentMouseVector.y =
      -(mouseEvent.clientY / window.innerHeight) * 2 + 1

    const planeIntersectPoint = this.getPlaneIntersectPoint()
    const intersects = this.raycastRing()

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
        planeIntersectPoint.twoD &&
        planeIntersectPoint.threeD
      ) {
        // // console.log('onDrag', this.selected)

        this.onDragCallback({
          mouseEvent,
          intersectionPoint: {
            twoD: planeIntersectPoint.twoD,
            threeD: planeIntersectPoint.threeD,
          },
          intersects,
          selected: this.selected.object,
        })
      }
    } else if (
      planeIntersectPoint &&
      planeIntersectPoint.twoD &&
      planeIntersectPoint.threeD
    ) {
      this.onMoveCallback({
        mouseEvent,
        intersectionPoint: {
          twoD: planeIntersectPoint.twoD,
          threeD: planeIntersectPoint.threeD,
        },
        intersects,
      })
    }

    if (intersects[0]) {
      const firstIntersectObject = intersects[0].object
      if (this.hoveredObject !== firstIntersectObject) {
        if (this.hoveredObject) {
          this.onMouseLeave({
            selected: this.hoveredObject,
            mouseEvent: mouseEvent,
          })
        }
        this.hoveredObject = firstIntersectObject
        this.onMouseEnter({
          selected: this.hoveredObject,
          mouseEvent: mouseEvent,
        })
      }
    } else {
      if (this.hoveredObject) {
        this.onMouseLeave({
          selected: this.hoveredObject,
          mouseEvent: mouseEvent,
        })
        this.hoveredObject = null
      }
    }
  }

  raycastRing = (
    pixelRadius = 8,
    rayRingCount = 32
  ): Intersection<Object3D<Object3DEventMap>>[] => {
    const mouseDownVector = this.currentMouseVector.clone()
    const intersectionsMap = new Map<
      Object3D,
      Intersection<Object3D<Object3DEventMap>>
    >()

    const updateIntersectionsMap = (
      intersections: Intersection<Object3D<Object3DEventMap>>[]
    ) => {
      intersections.forEach((intersection) => {
        if (intersection.object.type !== 'GridHelper') {
          const existingIntersection = intersectionsMap.get(intersection.object)
          if (
            !existingIntersection ||
            existingIntersection.distance > intersection.distance
          ) {
            intersectionsMap.set(intersection.object, intersection)
          }
        }
      })
    }

    // Check the center point
    this.raycaster.setFromCamera(mouseDownVector, this.camControls.camera)
    updateIntersectionsMap(
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
      this.raycaster.setFromCamera(ringVector, this.camControls.camera)
      updateIntersectionsMap(
        this.raycaster.intersectObjects(this.scene.children, true)
      )
    }

    // Convert the map values to an array and sort by distance
    return Array.from(intersectionsMap.values()).sort(
      (a, b) => a.distance - b.distance
    )
  }

  onMouseDown = (event: MouseEvent) => {
    this.currentMouseVector.x = (event.clientX / window.innerWidth) * 2 - 1
    this.currentMouseVector.y = -(event.clientY / window.innerHeight) * 2 + 1

    const mouseDownVector = this.currentMouseVector.clone()
    const intersect = this.raycastRing()[0]

    if (intersect) {
      const intersectParent = intersect?.object?.parent as Group
      this.selected = intersectParent.isGroup
        ? {
            mouseDownVector,
            object: intersect.object,
            hasBeenDragged: false,
          }
        : null
    }
  }

  onMouseUp = (mouseEvent: MouseEvent) => {
    this.currentMouseVector.x = (mouseEvent.clientX / window.innerWidth) * 2 - 1
    this.currentMouseVector.y =
      -(mouseEvent.clientY / window.innerHeight) * 2 + 1
    const planeIntersectPoint = this.getPlaneIntersectPoint()
    const intersects = this.raycastRing()

    if (this.selected) {
      if (this.selected.hasBeenDragged) {
        // this is where we could fire a onDragEnd event
        // console.log('onDragEnd', this.selected)
      } else if (planeIntersectPoint?.twoD && planeIntersectPoint?.threeD) {
        // fire onClick event as there was no drags
        this.onClickCallback({
          mouseEvent,
          intersectionPoint: {
            twoD: planeIntersectPoint.twoD,
            threeD: planeIntersectPoint.threeD,
          },
          intersects,
          selected: this.selected.object,
        })
      } else if (planeIntersectPoint) {
        this.onClickCallback({
          mouseEvent,
          intersects,
        })
      } else {
        this.onClickCallback()
      }
      // Clear the selected state whether it was dragged or not
      this.selected = null
    } else if (planeIntersectPoint?.twoD && planeIntersectPoint?.threeD) {
      this.onClickCallback({
        mouseEvent,
        intersectionPoint: {
          twoD: planeIntersectPoint.twoD,
          threeD: planeIntersectPoint.threeD,
        },
        intersects,
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
      this.camControls.camera,
      this.camControls.target
    )
    planesGroup.scale.set(
      sceneScale / sceneInfra._baseUnitMultiplier,
      sceneScale / sceneInfra._baseUnitMultiplier,
      sceneScale / sceneInfra._baseUnitMultiplier
    )
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
