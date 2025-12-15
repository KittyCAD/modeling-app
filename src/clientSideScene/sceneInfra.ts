import * as TWEEN from '@tweenjs/tween.js'
import type { Intersection, Object3D, Object3DEventMap } from 'three'
import { Group } from 'three'
import {
  AmbientLight,
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

import { CameraControls } from '@src/clientSideScene/CameraControls'
import { orthoScale, perspScale } from '@src/clientSideScene/helpers'
import { PROFILE_START } from '@src/clientSideScene/sceneConstants'
import {
  AXIS_GROUP,
  DEBUG_SHOW_INTERSECTION_PLANE,
  INTERSECTION_PLANE_LAYER,
  RAYCASTABLE_PLANE,
  SKETCH_LAYER,
  X_AXIS,
  Y_AXIS,
} from '@src/clientSideScene/sceneUtils'
import type { useModelingContext } from '@src/hooks/useModelingContext'
import type { Coords2d } from '@src/lang/util'
import { vec2WithinDistance } from '@src/lang/std/sketch'
import type { Axis, NonCodeSelection } from '@src/machines/modelingSharedTypes'
import { type BaseUnit } from '@src/lib/settings/settingsTypes'
import { Signal } from '@src/lib/signal'
import { Themes } from '@src/lib/theme'
import { getAngle, getLength, throttle } from '@src/lib/utils'
import type {
  MouseState,
  SegmentOverlayPayload,
} from '@src/machines/modelingSharedTypes'

import type { ConnectionManager } from '@src/network/connectionManager'

type SendType = ReturnType<typeof useModelingContext>['send']

interface intersectionData {
  twoD: Vector2
  threeD: Vector3
}

export interface OnMouseEnterLeaveArgs {
  selected: Object3D<Object3DEventMap>
  mouseEvent: MouseEvent
  /** The intersection of the mouse with the THREEjs raycast plane */
  intersectionPoint?: Partial<intersectionData>
  /** Whether area select is currently active */
  isAreaSelectActive?: boolean
}

interface OnDragCallbackArgs extends OnMouseEnterLeaveArgs {
  intersectionPoint: intersectionData
  intersects: Intersection<Object3D<Object3DEventMap>>[]
}

export interface OnClickCallbackArgs {
  mouseEvent: MouseEvent
  intersectionPoint?: intersectionData
  intersects: Intersection<Object3D<Object3DEventMap>>[]
  selected?: Object3D<Object3DEventMap>
}

export interface OnMoveCallbackArgs {
  mouseEvent: MouseEvent
  intersectionPoint: intersectionData
  intersects: Intersection<Object3D<Object3DEventMap>>[]
  selected?: Object3D<Object3DEventMap>
}

export interface OnAreaSelectCallbackArgs {
  mouseEvent: MouseEvent
  startPoint: intersectionData
  currentPoint: intersectionData
  intersects: Intersection<Object3D<Object3DEventMap>>[]
}

// This singleton class is responsible for all of the under the hood setup for the client side scene.
// That is the cameras and switching between them, raycasters for click mouse events and their abstractions (onClick etc), setting up controls.
// Anything that added the the scene for the user to interact with is probably in SceneEntities.ts

type Voidish = void | Promise<void>

export class SceneInfra {
  static instance: SceneInfra
  readonly scene: Scene
  readonly renderer: WebGLRenderer
  readonly labelRenderer: CSS2DRenderer
  readonly camControls: CameraControls
  isFovAnimationInProgress = false
  private _baseUnitMultiplier = 1
  private _theme: Themes = Themes.System
  lastMouseState: MouseState = { type: 'idle' }
  public readonly baseUnitChange = new Signal()
  onDragStartCallback: (arg: OnDragCallbackArgs) => Voidish = () => {}
  onDragEndCallback: (arg: OnDragCallbackArgs) => Voidish = () => {}
  onDragCallback: (arg: OnDragCallbackArgs) => Voidish = () => {}
  onMoveCallback: (arg: OnMoveCallbackArgs) => Voidish = () => {}
  onClickCallback: (arg: OnClickCallbackArgs) => Voidish = () => {}
  onMouseEnter: (arg: OnMouseEnterLeaveArgs) => Voidish = () => {}
  onMouseLeave: (arg: OnMouseEnterLeaveArgs) => Voidish = () => {}
  onAreaSelectStartCallback: (arg: OnAreaSelectCallbackArgs) => Voidish =
    () => {}
  onAreaSelectCallback: (arg: OnAreaSelectCallbackArgs) => Voidish = () => {}
  onAreaSelectEndCallback: (arg: OnAreaSelectCallbackArgs) => Voidish = () => {}
  setCallbacks = (callbacks: {
    onDragStart?: (arg: OnDragCallbackArgs) => Voidish
    onDragEnd?: (arg: OnDragCallbackArgs) => Voidish
    onDrag?: (arg: OnDragCallbackArgs) => Voidish
    onMove?: (arg: OnMoveCallbackArgs) => Voidish
    onClick?: (arg: OnClickCallbackArgs) => Voidish
    onMouseEnter?: (arg: OnMouseEnterLeaveArgs) => Voidish
    onMouseLeave?: (arg: OnMouseEnterLeaveArgs) => Voidish
    onAreaSelectStart?: (arg: OnAreaSelectCallbackArgs) => Voidish
    onAreaSelect?: (arg: OnAreaSelectCallbackArgs) => Voidish
    onAreaSelectEnd?: (arg: OnAreaSelectCallbackArgs) => Voidish
  }) => {
    this.onDragStartCallback = callbacks.onDragStart || this.onDragStartCallback
    this.onDragEndCallback = callbacks.onDragEnd || this.onDragEndCallback
    this.onDragCallback = callbacks.onDrag || this.onDragCallback
    this.onMoveCallback = callbacks.onMove || this.onMoveCallback
    this.onClickCallback = callbacks.onClick || this.onClickCallback
    this.onMouseEnter = callbacks.onMouseEnter || this.onMouseEnter
    this.onMouseLeave = callbacks.onMouseLeave || this.onMouseLeave
    this.onAreaSelectStartCallback =
      callbacks.onAreaSelectStart || this.onAreaSelectStartCallback
    this.onAreaSelectCallback =
      callbacks.onAreaSelect || this.onAreaSelectCallback
    this.onAreaSelectEndCallback =
      callbacks.onAreaSelectEnd || this.onAreaSelectEndCallback
    this.selected = null // following selections between callbacks being set is too tricky
  }

  set baseUnit(unit: BaseUnit) {
    const newBaseUnitMultiplier = baseUnitTomm(unit)
    if (newBaseUnitMultiplier !== this._baseUnitMultiplier) {
      this._baseUnitMultiplier = baseUnitTomm(unit)
      this.scene.scale.set(
        this._baseUnitMultiplier,
        this._baseUnitMultiplier,
        this._baseUnitMultiplier
      )
      this.baseUnitChange.dispatch()
    }
  }

  get baseUnitMultiplier() {
    return this._baseUnitMultiplier
  }

  /**
   * Returns the size of the current base unit in ortho view (in logical/CSS pixels, not device pixels).
   * Eg. if 1 mm takes up 4 pixels in the current view, and the current base unit is 1cm then it returns 40 pixels.
   */
  getPixelsPerBaseUnit(camera: OrthographicCamera) {
    const worldViewportWidth = (camera.right - camera.left) / camera.zoom
    const viewportSize = this.renderer.getDrawingBufferSize(new Vector2())

    // one [mm] in screen space (pixels) multiplied by baseUnitMultiplier
    return (
      (((1 / worldViewportWidth) * viewportSize.x) / window.devicePixelRatio) *
      this._baseUnitMultiplier
    )
  }

  set theme(theme: Themes) {
    this._theme = theme
  }

  get theme() {
    return this._theme
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
      onAreaSelectStart: () => {},
      onAreaSelect: () => {},
      onAreaSelectEnd: () => {},
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
      } else if (overlay?.type === 'set-many') {
        Object.assign(segmentOverlayPayload.overlays, overlay.overlays)
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

  updateOverlayDetails({
    handle,
    group,
    isHandlesVisible,
    from,
    to,
    angle,
    hasThreeDotMenu,
  }: {
    handle: Group
    group: Group
    isHandlesVisible: boolean
    from: Coords2d
    to: Coords2d
    hasThreeDotMenu: boolean
    angle?: number
  }): SegmentOverlayPayload | null {
    if (!group.userData.draft && group.userData.pathToNode && handle) {
      const vector = new Vector3(0, 0, 0)

      // Get the position of the object3D in world space
      handle.getWorldPosition(vector)

      // Project that position to screen space
      vector.project(this.camControls.camera)

      let _angle = 45
      if (group.name !== PROFILE_START) {
        _angle = typeof angle === 'number' ? angle : getAngle(from, to)
      }

      const x = (vector.x * 0.5 + 0.5) * this.renderer.domElement.clientWidth
      const y = (-vector.y * 0.5 + 0.5) * this.renderer.domElement.clientHeight
      const pathToNodeString = JSON.stringify(group.userData.pathToNode)
      return {
        type: 'set-one',
        pathToNodeString,
        seg: [
          {
            windowCoords: [x, y],
            angle: _angle,
            group,
            pathToNode: group.userData.pathToNode,
            visible: isHandlesVisible,
            hasThreeDotMenu,
          },
        ],
      }
    }
    return null
  }

  hoveredObject: null | Object3D<Object3DEventMap> = null
  raycaster = new Raycaster()
  planeRaycaster = new Raycaster()
  // Given in NDC: [-1, 1] range, where (-1, -1) corresponds to the bottom left of the canvas, (0, 0) is the center.
  currentMouseVector = new Vector2()
  selected: {
    mouseDownVector: Vector2
    object: Object3D<Object3DEventMap>
    hasBeenDragged: boolean
  } | null = null
  areaSelect: {
    mouseDownVector: Vector2
    startPoint: {
      twoD: Vector2
      threeD: Vector3
    }
    hasBeenDragged: boolean
  } | null = null

  get isAreaSelectActive(): boolean {
    return this.areaSelect !== null && this.areaSelect.hasBeenDragged
  }
  private isRenderingPaused = false
  private lastFrameTime = 0
  private animationFrameId = -1

  constructor(engineCommandManager: ConnectionManager) {
    // SCENE
    this.scene = new Scene()
    this.scene.background = new Color(0x000000)
    this.scene.background = null

    // RENDERER
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true }) // Enable transparency
    this.renderer.setClearColor(0x000000, 0) // Set clear color to black with 0 alpha (fully transparent)

    // LABEL RENDERER
    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.domElement.style.position = 'absolute'
    this.labelRenderer.domElement.style.top = '0px'
    this.labelRenderer.domElement.style.pointerEvents = 'none'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.labelRenderer.domElement.className = 'z-sketchSegmentIndicators'

    this.camControls = new CameraControls(
      this.renderer.domElement,
      engineCommandManager,
      false
    )
    this.camControls.camera.layers.enable(SKETCH_LAYER)
    if (DEBUG_SHOW_INTERSECTION_PLANE)
      this.camControls.camera.layers.enable(INTERSECTION_PLANE_LAYER)

    // RAYCASTERS
    this.raycaster.layers.enable(SKETCH_LAYER)
    this.raycaster.layers.disable(0)
    this.planeRaycaster.layers.enable(INTERSECTION_PLANE_LAYER)

    // GRID - more of a debug thing, but maybe useful
    // const size = 100
    // const divisions = 10
    // const gridHelperMaterial = new LineBasicMaterial({
    //   color: 0x0000ff,
    //   transparent: true,
    //   opacity: 0.5,
    // })
    //
    // This is the GridHelper in the 3D scene, the one in sketching is in sceneEntities.ts
    // const gridHelper = new GridHelper(size, divisions, 0x0000ff, 0xffffff)
    // gridHelper.material = gridHelperMaterial
    // gridHelper.rotation.x = Math.PI / 2
    // this.scene.add(gridHelper)

    const light = new AmbientLight(0x505050) // soft white light
    this.scene.add(light)

    SceneInfra.instance = this
  }

  // Called after canvas is attached to the DOM and on each resize.
  // Note: would be better to use ResizeObserver instead of window.onresize
  // See:
  // https://webglfundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html
  onCanvasResized = () => {
    const cssSize = [
      this.renderer.domElement.clientWidth,
      this.renderer.domElement.clientHeight,
    ]
    // Note: could cap the resolution on mobile devices if needed.
    const canvasResolution = [
      Math.round(cssSize[0] * window.devicePixelRatio),
      Math.round(cssSize[1] * window.devicePixelRatio),
    ]
    this.renderer.setSize(canvasResolution[0], canvasResolution[1], false)
    this.labelRenderer.setSize(cssSize[0], cssSize[1])
  }

  animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate)
    TWEEN.update() // This will update all tweens during the animation loop
    if (!this.isFovAnimationInProgress) {
      this.camControls.update()

      // If rendering is paused, only render if enough time has passed to maintain smooth animation
      if (this.isRenderingPaused) {
        const currentTime = performance.now()
        if (currentTime - this.lastFrameTime > 1000 / 30) {
          // Limit to 30fps while paused
          this.renderer.render(this.scene, this.camControls.camera)
          this.labelRenderer.render(this.scene, this.camControls.camera)
          this.lastFrameTime = currentTime
        }
      } else {
        this.renderer.render(this.scene, this.camControls.camera)
        this.labelRenderer.render(this.scene, this.camControls.camera)
      }
    }
  }

  stop = () => {
    if (this.animationFrameId !== -1) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = -1
      // If you stop the renderer it will render a last frame of the sketch scene
      // clear it since they should not be seeing this renderer anyway
      this.renderer.clear()
    }
  }

  dispose = () => {
    // Dispose of scene resources, renderer, and controls
    this.renderer.forceContextLoss()
    this.renderer.dispose()
    // Dispose of any other resources like geometries, materials, textures
  }

  getClientSceneScaleFactor(meshOrGroup: Mesh | Group) {
    const orthoFactor = orthoScale(this.camControls.camera)
    const factor =
      (this.camControls.camera instanceof OrthographicCamera
        ? orthoFactor
        : perspScale(this.camControls.camera, meshOrGroup)) /
      this._baseUnitMultiplier
    return factor
  }

  getPlaneIntersectPoint = (): {
    twoD?: Vector2
    threeD?: Vector3
    intersection: Intersection<Object3D<Object3DEventMap>>
  } | null => {
    // Get the orientations from the camera and mouse position
    this.planeRaycaster.setFromCamera(
      this.currentMouseVector,
      this.camControls.camera
    )

    // Get the intersection of the ray with the default planes
    const planeIntersects = this.planeRaycaster.intersectObjects(
      this.scene.children,
      true
    )
    if (!planeIntersects.length) {
      return null
    }

    // Find the intersection with the raycastable (or sketch) plane
    const raycastablePlaneIntersection = planeIntersects.find(
      (intersect) => intersect.object.name === RAYCASTABLE_PLANE
    )
    if (!raycastablePlaneIntersection) {
      return {
        intersection: planeIntersects[0],
      }
    }
    const planePosition = raycastablePlaneIntersection.object.position
    const inversePlaneQuaternion =
      raycastablePlaneIntersection.object.quaternion.clone().invert()
    const intersectPoint = raycastablePlaneIntersection.point
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

  public mouseMoveThrottling = true // Can be turned off for debugging
  private _processingMouseMove = false
  private _lastUnprocessedMouseEvent: MouseEvent | undefined

  private updateCurrentMouseVector(event: MouseEvent) {
    const target = this.renderer.domElement

    const rect = target.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return
    }
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    this.currentMouseVector.x = (localX / rect.width) * 2 - 1
    this.currentMouseVector.y = -(localY / rect.height) * 2 + 1
  }

  onMouseMove = async (mouseEvent: MouseEvent) => {
    if (this.mouseMoveThrottling) {
      // Throttle mouse move events to help with performance.
      // Without this a new call to executeAstMock() is made by SceneEntities/onDragSegment() while the
      // previous one is still running, causing multiple wasm calls to be running at the same time.
      // Here we simply ignore the mouse move event if we are already processing one, until the processing is done.
      if (this._processingMouseMove) {
        this._lastUnprocessedMouseEvent = mouseEvent
        return
      }
      this._processingMouseMove = true
    }

    this.updateCurrentMouseVector(mouseEvent)

    const planeIntersectPoint = this.getPlaneIntersectPoint()
    const intersects = this.raycastRing()

    if (this.selected) {
      const hasBeenDragged = !vec2WithinDistance(
        this.ndc2screenSpace(this.currentMouseVector),
        this.ndc2screenSpace(this.selected.mouseDownVector),
        10 // Drag threshold in pixels
      )
      if (!this.selected.hasBeenDragged && hasBeenDragged) {
        this.selected.hasBeenDragged = true
        // Fire onDragStart event when drag threshold is first exceeded
        if (
          planeIntersectPoint &&
          planeIntersectPoint.twoD &&
          planeIntersectPoint.threeD
        ) {
          await this.onDragStartCallback({
            mouseEvent,
            intersectionPoint: {
              twoD: planeIntersectPoint.twoD,
              threeD: planeIntersectPoint.threeD,
            },
            intersects,
            selected: this.selected.object,
          })
        }
      }
      if (
        this.selected.hasBeenDragged &&
        planeIntersectPoint &&
        planeIntersectPoint.twoD &&
        planeIntersectPoint.threeD
      ) {
        const selected = this.selected
        await this.onDragCallback({
          mouseEvent,
          intersectionPoint: {
            twoD: planeIntersectPoint.twoD,
            threeD: planeIntersectPoint.threeD,
          },
          intersects,
          selected: selected.object,
        })
        this.updateMouseState({
          type: 'isDragging',
          on: selected.object,
        })
      }
    } else if (this.areaSelect) {
      // Handle area select drag
      const hasBeenDragged = !vec2WithinDistance(
        this.ndc2screenSpace(this.currentMouseVector),
        this.ndc2screenSpace(this.areaSelect.mouseDownVector),
        10 // Drag threshold in pixels
      )
      if (!this.areaSelect.hasBeenDragged && hasBeenDragged) {
        this.areaSelect.hasBeenDragged = true
        // Fire onAreaSelectStart event when drag threshold is first exceeded
        if (
          planeIntersectPoint &&
          planeIntersectPoint.twoD &&
          planeIntersectPoint.threeD
        ) {
          await this.onAreaSelectStartCallback({
            mouseEvent,
            startPoint: this.areaSelect.startPoint,
            currentPoint: {
              twoD: planeIntersectPoint.twoD,
              threeD: planeIntersectPoint.threeD,
            },
            intersects,
          })
        }
      }
      if (
        this.areaSelect.hasBeenDragged &&
        planeIntersectPoint &&
        planeIntersectPoint.twoD &&
        planeIntersectPoint.threeD
      ) {
        await this.onAreaSelectCallback({
          mouseEvent,
          startPoint: this.areaSelect.startPoint,
          currentPoint: {
            twoD: planeIntersectPoint.twoD,
            threeD: planeIntersectPoint.threeD,
          },
          intersects,
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

    if (!this.selected) {
      if (intersects[0]) {
        const firstIntersectObject = intersects[0].object
        const planeIntersectPoint = this.getPlaneIntersectPoint()
        const intersectionPoint = {
          twoD: planeIntersectPoint?.twoD,
          threeD: planeIntersectPoint?.threeD,
        }

        if (this.hoveredObject !== firstIntersectObject) {
          const hoveredObj = this.hoveredObject
          this.hoveredObject = null
          if (hoveredObj) {
            await this.onMouseLeave({
              selected: hoveredObj,
              mouseEvent: mouseEvent,
              intersectionPoint,
              isAreaSelectActive: this.isAreaSelectActive,
            })
          }
          this.hoveredObject = firstIntersectObject
          await this.onMouseEnter({
            selected: this.hoveredObject,
            mouseEvent: mouseEvent,
            intersectionPoint,
            isAreaSelectActive: this.isAreaSelectActive,
          })
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
            mouseEvent: mouseEvent,
            isAreaSelectActive: this.isAreaSelectActive,
          })
          if (!this.selected) this.updateMouseState({ type: 'idle' })
        }
      }
    }

    if (this.mouseMoveThrottling) {
      this._processingMouseMove = false
      const lastUnprocessedMouseEvent = this._lastUnprocessedMouseEvent
      if (lastUnprocessedMouseEvent) {
        // Another mousemove happened during the time this callback was processing
        // -> process that event now
        this._lastUnprocessedMouseEvent = undefined
        void this.onMouseMove(lastUnprocessedMouseEvent)
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
        const existingIntersection = intersectionsMap.get(intersection.object)
        if (
          !existingIntersection ||
          existingIntersection.distance > intersection.distance
        ) {
          intersectionsMap.set(intersection.object, intersection)
        }
      })
    }

    // Check the center point
    console.log('raycastring', mouseDownVector)
    this.raycaster.setFromCamera(mouseDownVector, this.camControls.camera)
    updateIntersectionsMap(
      this.raycaster.intersectObjects(this.scene.children, true)
    )

    // Check the ring points
    for (let i = 0; i < rayRingCount; i++) {
      const angle = (i / rayRingCount) * Math.PI * 2
      const offsetX =
        ((pixelRadius * Math.cos(angle)) /
          this.renderer.domElement.clientWidth) *
        2
      const offsetY =
        ((pixelRadius * Math.sin(angle)) /
          this.renderer.domElement.clientHeight) *
        2
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
    return Array.from(intersectionsMap.values()).sort((a, b) => {
      // Deprioritize axis selection to allow selecting segments that lie on axes
      const aIsAxis = isAxisObject(a.object)
      const bIsAxis = isAxisObject(b.object)
      if (aIsAxis && !bIsAxis) return 1
      if (!aIsAxis && bIsAxis) return -1
      // Otherwise sort by distance
      return a.distance - b.distance
    })
  }

  updateMouseState(mouseState: MouseState) {
    if (this.lastMouseState.type === mouseState.type) return
    this.lastMouseState = mouseState
    this.modelingSend({ type: 'Set mouse state', data: mouseState })
  }

  /**
   * Helper function to find a CSS2DObject (point segment) under the cursor
   * Returns the CSS2DObject and its parent Group if found
   */
  private findCSS2DObjectUnderCursor(
    event: MouseEvent
  ): { css2dObject: CSS2DObject; parentGroup: Group } | null {
    const el = document.elementFromPoint(
      event.clientX,
      event.clientY
    ) as HTMLElement | null
    if (!el) return null

    // Traverse up the DOM to find the element with segment_id
    let cur: HTMLElement | null = el
    while (cur) {
      const idAttr = cur.dataset?.segment_id
      if (idAttr && !Number.isNaN(Number(idAttr))) {
        // Found the element, now find the CSS2DObject in the scene
        // CSS2DObjects are in SKETCH_SOLVE_GROUP, so search there first for efficiency
        const segmentId = Number(idAttr)
        const findCSS2DObject = (object: Object3D): CSS2DObject | null => {
          if (object instanceof CSS2DObject) {
            // Match by element reference or by segment_id in the element's dataset
            if (
              object.element === cur ||
              (object.element instanceof HTMLElement &&
                object.element.dataset.segment_id === idAttr)
            ) {
              return object
            }
          }
          for (const child of object.children) {
            const found = findCSS2DObject(child)
            if (found) return found
          }
          return null
        }

        // Try SKETCH_SOLVE_GROUP first (where point segments are)
        const sketchSolveGroup = this.scene.getObjectByName('sketchSolveGroup')
        let css2dObject: CSS2DObject | null = null
        if (sketchSolveGroup) {
          css2dObject = findCSS2DObject(sketchSolveGroup)
        }

        // Fallback to searching entire scene if not found in SKETCH_SOLVE_GROUP
        if (!css2dObject) {
          css2dObject = findCSS2DObject(this.scene)
        }

        if (css2dObject && css2dObject.parent instanceof Group) {
          // Verify the parent Group's name matches the segment_id
          const parentGroupId = Number(css2dObject.parent.name)
          if (!Number.isNaN(parentGroupId) && parentGroupId === segmentId) {
            return {
              css2dObject,
              parentGroup: css2dObject.parent,
            }
          }
        }
        break
      }
      cur = cur.parentElement
    }
    return null
  }

  onMouseDown = (event: MouseEvent) => {
    this.updateCurrentMouseVector(event)

    const mouseDownVector = this.currentMouseVector.clone()

    // Always check for CSS2DObject first (point segments) since they're rendered on top
    // and should take priority over three.js objects
    const css2dResult = this.findCSS2DObjectUnderCursor(event)
    if (css2dResult) {
      // Use the parent Group as the selected object so drag handling works
      this.selected = {
        mouseDownVector,
        object: css2dResult.parentGroup,
        hasBeenDragged: false,
      }
      // Prevent default to ensure drag works properly
      // This prevents any default browser drag behavior that might interfere
      event.preventDefault()
      return
    }

    // No CSS2DObject found, check for three.js objects
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

    // If nothing was selected, initialize area select
    if (!this.selected) {
      const planeIntersectPoint = this.getPlaneIntersectPoint()
      if (
        planeIntersectPoint &&
        planeIntersectPoint.twoD &&
        planeIntersectPoint.threeD
      ) {
        this.areaSelect = {
          mouseDownVector,
          startPoint: {
            twoD: planeIntersectPoint.twoD.clone(),
            threeD: planeIntersectPoint.threeD.clone(),
          },
          hasBeenDragged: false,
        }
      }
    }
  }

  onMouseUp = async (mouseEvent: MouseEvent) => {
    this.updateCurrentMouseVector(mouseEvent)
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
    } else if (this.areaSelect) {
      // Handle area select end
      if (this.areaSelect.hasBeenDragged) {
        // Fire onAreaSelectEnd callback
        if (
          planeIntersectPoint &&
          planeIntersectPoint.twoD &&
          planeIntersectPoint.threeD
        ) {
          await this.onAreaSelectEndCallback({
            mouseEvent,
            startPoint: this.areaSelect.startPoint,
            currentPoint: {
              twoD: planeIntersectPoint.twoD,
              threeD: planeIntersectPoint.threeD,
            },
            intersects,
          })
        }
      } else {
        // If area select didn't drag, treat as a click on empty space
        if (planeIntersectPoint?.twoD && planeIntersectPoint?.threeD) {
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
      // Clear the area select state
      this.areaSelect = null
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
  updateOtherSelectionColors = (otherSelections: NonCodeSelection[]) => {
    const axisGroup = this.scene.children.find(
      ({ userData }) => userData?.type === AXIS_GROUP
    )
    const axisMap: { [key: string]: Axis } = {
      [X_AXIS]: 'x-axis',
      [Y_AXIS]: 'y-axis',
    }
    axisGroup?.children.forEach((_mesh) => {
      const mesh = _mesh as Mesh
      const mat = mesh.material
      if (mat instanceof MeshBasicMaterial) {
        if (otherSelections.includes(axisMap[mesh.userData?.type])) {
          mat.color.set(mesh?.userData?.baseColor)
          mat.color.offsetHSL(0, 0, 0.2)
          mesh.userData.isSelected = true
        } else {
          mat.color.set(mesh?.userData?.baseColor)
          mesh.userData.isSelected = false
        }
      }
    })
  }

  // a and b given in world space
  screenSpaceDistance(a: Coords2d, b: Coords2d): number {
    const dummy = new Mesh()
    dummy.position.set(0, 0, 0)
    const scale = this.getClientSceneScaleFactor(dummy)
    return getLength(a, b) / scale
  }
  ndc2screenSpace(ndc: Vector2): Coords2d {
    return [
      ((ndc.x + 1) / 2) * this.renderer.domElement.clientWidth,
      ((ndc.y + 1) / 2) * this.renderer.domElement.clientHeight,
    ]
  }
  pauseRendering() {
    this.isRenderingPaused = true
    // Store the current time to prevent unnecessary updates
    this.lastFrameTime = performance.now()
  }

  resumeRendering() {
    this.isRenderingPaused = false
  }
}

function isAxisObject(object: Object3D | undefined): boolean {
  if (!object) return false
  return object.name === X_AXIS || object.name === Y_AXIS
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
