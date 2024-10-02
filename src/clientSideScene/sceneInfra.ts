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
  MeshBasicMaterial,
  Mesh,
  Intersection,
  Object3D,
  Object3DEventMap,
  TextureLoader,
  Texture,
} from 'three'
import { Coords2d, compareVec2Epsilon2 } from 'lang/std/sketch'
import { useModelingContext } from 'hooks/useModelingContext'
import * as TWEEN from '@tweenjs/tween.js'
import { Axis } from 'lib/selections'
import { type BaseUnit } from 'lib/settings/settingsTypes'
import { CameraControls } from './CameraControls'
import { EngineCommandManager } from 'lang/std/engineConnection'
import { MouseState, SegmentOverlayPayload } from 'machines/modelingMachine'
import { getAngle, throttle } from 'lib/utils'
import { Themes } from 'lib/theme'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import * as constants from './constants'

type SendType = ReturnType<typeof useModelingContext>['send']

export * from './constants'

export interface OnMouseEnterLeaveArgs {
  selected: Object3D<Object3DEventMap>
  dragSelected?: Object3D<Object3DEventMap>
  mouseEvent: MouseEvent
}

interface OnDragCallbackArgs extends OnMouseEnterLeaveArgs {
  intersectionPoint: {
    twoD: Vector2
    threeD: Vector3
  }
  intersects: Intersection<Object3D<Object3DEventMap>>[]
}
export interface OnClickCallbackArgs {
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

type Voidish = void | Promise<void>
export class SceneInfra {
  static instance: SceneInfra
  scene: Scene
  renderer: WebGLRenderer
  labelRenderer: CSS2DRenderer
  camControls: CameraControls
  isPerspective = true
  fov = 45
  fovBeforeAnimate = 45
  isFovAnimationInProgress = false
  _baseUnit: BaseUnit = 'mm'
  _baseUnitMultiplier = 1
  _theme: Themes = Themes.System
  extraSegmentTexture: Texture
  lastMouseState: MouseState = { type: 'idle' }
  onDragStartCallback: (arg: OnDragCallbackArgs) => Voidish = () => {}
  onDragEndCallback: (arg: OnDragCallbackArgs) => Voidish = () => {}
  onDragCallback: (arg: OnDragCallbackArgs) => Voidish = () => {}
  onMoveCallback: (arg: OnMoveCallbackArgs) => Voidish = () => {}
  onClickCallback: (arg: OnClickCallbackArgs) => Voidish = () => {}
  onMouseEnter: (arg: OnMouseEnterLeaveArgs) => Voidish = () => {}
  onMouseLeave: (arg: OnMouseEnterLeaveArgs) => Voidish = () => {}
  setCallbacks = (callbacks: {
    onDragStart?: (arg: OnDragCallbackArgs) => Voidish
    onDragEnd?: (arg: OnDragCallbackArgs) => Voidish
    onDrag?: (arg: OnDragCallbackArgs) => Voidish
    onMove?: (arg: OnMoveCallbackArgs) => Voidish
    onClick?: (arg: OnClickCallbackArgs) => Voidish
    onMouseEnter?: (arg: OnMouseEnterLeaveArgs) => Voidish
    onMouseLeave?: (arg: OnMouseEnterLeaveArgs) => Voidish
  }) => {
    this.onDragStartCallback = callbacks.onDragStart || this.onDragStartCallback
    this.onDragEndCallback = callbacks.onDragEnd || this.onDragEndCallback
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
  set theme(theme: Themes) {
    this._theme = theme
  }
  resetMouseListeners = () => {
    this.setCallbacks({
      onDragStart: () => {},
      onDragEnd: () => {},
      onDrag: () => {},
      onMove: () => {},
      onClick: () => {},
      onMouseEnter: () => {},
      onMouseLeave: () => {},
    })
  }

  modelingSend: SendType = (() => {}) as any
  throttledModelingSend: any = (() => {}) as any
  setSend(send: SendType) {
    this.modelingSend = send
    this.throttledModelingSend = throttle(send, 100)
  }
  overlayTimeout = 0
  callbacks: (() => SegmentOverlayPayload | null)[] = []
  _overlayCallbacks(callbacks: (() => SegmentOverlayPayload | null)[]) {
    const segmentOverlayPayload: SegmentOverlayPayload = {
      type: 'set-many',
      overlays: {},
    }
    callbacks.forEach((cb) => {
      const overlay = cb()
      if (overlay?.type === 'set-one') {
        segmentOverlayPayload.overlays[overlay.pathToNodeString] = overlay.seg
      }
    })
    this.modelingSend({
      type: 'Set Segment Overlays',
      data: segmentOverlayPayload,
    })
  }
  overlayCallbacks(
    callbacks: (() => SegmentOverlayPayload | null)[],
    instant = false
  ) {
    if (instant) {
      this._overlayCallbacks(callbacks)
      return
    }
    this.callbacks = callbacks
    if (this.overlayTimeout) clearTimeout(this.overlayTimeout)
    this.overlayTimeout = setTimeout(() => {
      this._overlayCallbacks(this.callbacks)
    }, 100) as unknown as number
  }

  overlayThrottleMap: { [pathToNodeString: string]: number } = {}
  updateOverlayDetails({
    arrowGroup,
    group,
    isHandlesVisible,
    from,
    to,
    angle,
  }: {
    arrowGroup: Group
    group: Group
    isHandlesVisible: boolean
    from: Coords2d
    to: Coords2d
    angle?: number
  }): SegmentOverlayPayload | null {
    if (!group.userData.draft && group.userData.pathToNode && arrowGroup) {
      const vector = new Vector3(0, 0, 0)

      // Get the position of the object3D in world space
      // console.log('arrowGroup', arrowGroup)
      arrowGroup.getWorldPosition(vector)

      // Project that position to screen space
      vector.project(this.camControls.camera)

      const _angle = typeof angle === 'number' ? angle : getAngle(from, to)

      const x = (vector.x * 0.5 + 0.5) * window.innerWidth
      const y = (-vector.y * 0.5 + 0.5) * window.innerHeight
      const pathToNodeString = JSON.stringify(group.userData.pathToNode)
      return {
        type: 'set-one',
        pathToNodeString,
        seg: {
          windowCoords: [x, y],
          angle: _angle,
          group,
          pathToNode: group.userData.pathToNode,
          visible: isHandlesVisible,
        },
      }
    }
    return null
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

  constructor(engineCommandManager: EngineCommandManager) {
    // SCENE
    this.scene = new Scene()
    this.scene.background = new Color(0x000000)
    this.scene.background = null

    // RENDERER
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true }) // Enable transparency
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x000000, 0) // Set clear color to black with 0 alpha (fully transparent)

    // LABEL RENDERER
    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight)
    this.labelRenderer.domElement.style.position = 'absolute'
    this.labelRenderer.domElement.style.top = '0px'
    this.labelRenderer.domElement.style.pointerEvents = 'none'
    window.addEventListener('resize', this.onWindowResize)

    this.camControls = new CameraControls(
      false,
      this.renderer.domElement,
      engineCommandManager
    )
    this.camControls.subscribeToCamChange(() => this.onCameraChange())
    this.camControls.camera.layers.enable(constants.SKETCH_LAYER)
    if (constants.DEBUG_SHOW_INTERSECTION_PLANE)
      this.camControls.camera.layers.enable(constants.INTERSECTION_PLANE_LAYER)

    // RAYCASTERS
    this.raycaster.layers.enable(constants.SKETCH_LAYER)
    this.raycaster.layers.disable(0)
    this.planeRaycaster.layers.enable(constants.INTERSECTION_PLANE_LAYER)

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

    const textureLoader = new TextureLoader()
    this.extraSegmentTexture = textureLoader.load(
      './clientSideSceneAssets/extra-segment-texture.png'
    )
    this.extraSegmentTexture.anisotropy =
      this.renderer?.capabilities?.getMaxAnisotropy?.()

    SceneInfra.instance = this
  }

  onCameraChange = () => {
    const scale = getSceneScale(
      this.camControls.camera,
      this.camControls.target
    )
    const axisGroup = this.scene
      .getObjectByName(constants.AXIS_GROUP)
      ?.getObjectByName('gridHelper')
    axisGroup?.name === 'gridHelper' && axisGroup.scale.set(scale, scale, scale)
  }

  onWindowResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight)
  }

  animate = () => {
    TWEEN.update() // This will update all tweens during the animation loop
    if (!this.isFovAnimationInProgress) {
      // console.log('animation frame', this.cameraControls.camera)
      this.camControls.update()
      this.renderer.render(this.scene, this.camControls.camera)
      this.labelRenderer.render(this.scene, this.camControls.camera)
    }
    requestAnimationFrame(this.animate)
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
      this.camControls.camera
    )
    const planeIntersects = this.planeRaycaster.intersectObjects(
      this.scene.children,
      true
    )
    const recastablePlaneIntersect = planeIntersects.find(
      (intersect) => intersect.object.name === constants.RAYCASTABLE_PLANE
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
    }
    const twoD = new Vector2(
      // I think the intersection plane doesn't get scale when nearly everything else does, maybe that should change
      transformedPoint.x / this._baseUnitMultiplier,
      transformedPoint.y / this._baseUnitMultiplier
    ) // z should be 0
    const planePositionCorrected = new Vector3(
      ...planePosition
    ).applyQuaternion(inversePlaneQuaternion)
    twoD.sub(new Vector2(...planePositionCorrected))

    return {
      twoD,
      threeD: intersectPoint.divideScalar(this._baseUnitMultiplier),
      intersection: planeIntersects[0],
    }
  }
  onMouseMove = async (mouseEvent: MouseEvent) => {
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
        await this.onDragCallback({
          mouseEvent,
          intersectionPoint: {
            twoD: planeIntersectPoint.twoD,
            threeD: planeIntersectPoint.threeD,
          },
          intersects,
          selected: this.selected.object,
        })
        this.updateMouseState({
          type: 'isDragging',
          on: this.selected.object,
        })
      }
    } else if (
      planeIntersectPoint &&
      planeIntersectPoint.twoD &&
      planeIntersectPoint.threeD
    ) {
      await this.onMoveCallback({
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
        const hoveredObj = this.hoveredObject
        this.hoveredObject = null
        await this.onMouseLeave({
          selected: hoveredObj,
          mouseEvent: mouseEvent,
        })
        this.hoveredObject = firstIntersectObject
        await this.onMouseEnter({
          selected: this.hoveredObject,
          dragSelected: this.selected?.object,
          mouseEvent: mouseEvent,
        })
        if (!this.selected)
          this.updateMouseState({
            type: 'isHovering',
            on: this.hoveredObject,
          })
      }
    } else {
      if (this.hoveredObject) {
        const hoveredObj = this.hoveredObject
        this.hoveredObject = null
        await this.onMouseLeave({
          selected: hoveredObj,
          dragSelected: this.selected?.object,
          mouseEvent: mouseEvent,
        })
        if (!this.selected) this.updateMouseState({ type: 'idle' })
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
  updateMouseState(mouseState: MouseState) {
    if (this.lastMouseState.type === mouseState.type) return
    this.lastMouseState = mouseState
    this.modelingSend({ type: 'Set mouse state', data: mouseState })
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

  onMouseUp = async (mouseEvent: MouseEvent) => {
    this.currentMouseVector.x = (mouseEvent.clientX / window.innerWidth) * 2 - 1
    this.currentMouseVector.y =
      -(mouseEvent.clientY / window.innerHeight) * 2 + 1
    const planeIntersectPoint = this.getPlaneIntersectPoint()
    const intersects = this.raycastRing()

    if (this.selected) {
      if (this.selected.hasBeenDragged) {
        // TODO do the types properly here
        await this.onDragEndCallback({
          intersectionPoint: {
            twoD: planeIntersectPoint?.twoD as any,
            threeD: planeIntersectPoint?.threeD as any,
          },
          intersects,
          mouseEvent,
          selected: this.selected as any,
        })
        if (intersects.length) {
          this.updateMouseState({
            type: 'isHovering',
            on: intersects[0].object,
          })
        } else {
          this.updateMouseState({
            type: 'idle',
          })
        }
      } else if (planeIntersectPoint?.twoD && planeIntersectPoint?.threeD) {
        // fire onClick event as there was no drags
        await this.onClickCallback({
          mouseEvent,
          intersectionPoint: {
            twoD: planeIntersectPoint.twoD,
            threeD: planeIntersectPoint.threeD,
          },
          intersects,
          selected: this.selected.object,
        })
      } else if (planeIntersectPoint) {
        await this.onClickCallback({
          mouseEvent,
          intersects,
        })
      } else {
        await this.onClickCallback({ mouseEvent, intersects })
      }
      // Clear the selected state whether it was dragged or not
      this.selected = null
    } else if (planeIntersectPoint?.twoD && planeIntersectPoint?.threeD) {
      await this.onClickCallback({
        mouseEvent,
        intersectionPoint: {
          twoD: planeIntersectPoint.twoD,
          threeD: planeIntersectPoint.threeD,
        },
        intersects,
      })
    } else {
      await this.onClickCallback({ mouseEvent, intersects })
    }
  }
  updateOtherSelectionColors = (otherSelections: Axis[]) => {
    const axisGroup = this.scene.children.find(
      ({ userData }) => userData?.type === constants.AXIS_GROUP
    )
    const axisMap: { [key: string]: Axis } = {
      [constants.X_AXIS]: 'x-axis',
      [constants.Y_AXIS]: 'y-axis',
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
