import { useApp, useSingletons } from '@src/lib/boot'
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'

import { ViewControlContextMenu } from '@src/components/ViewControlMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { AxisNames } from '@src/lib/constants'
import { reportRejection } from '@src/lib/trap'
import type { ColorRepresentation, Intersection, Object3D } from 'three'
import {
  BoxGeometry,
  CanvasTexture,
  Clock,
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  WebGLRenderer,
} from 'three'

export default function AxisGizmo() {
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { state: modelingState } = useModelingContext()
  const settingsValues = settings.useSettings()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const raycasterIntersect = useRef<Intersection | null>(null)
  const cameraPassiveUpdateTimer = useRef(0)
  const disableOrbitRef = useRef(false)
  const isPointerOverRef = useRef(false)
  const isHoverRefreshPausedRef = useRef(false)

  // Temporary fix for #4040:
  // Disable gizmo orbiting in sketch mode
  // This effect updates disableOrbitRef whenever the user
  // toggles between Sketch mode and 3D mode
  useEffect(() => {
    disableOrbitRef.current =
      modelingState.matches('Sketch') &&
      !settingsValues.app.allowOrbitInSketchMode.current
    if (wrapperRef.current) {
      wrapperRef.current.style.filter = disableOrbitRef.current
        ? 'grayscale(100%)'
        : 'none'
      wrapperRef.current.style.cursor = disableOrbitRef.current
        ? 'not-allowed'
        : 'auto'
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [modelingState, settingsValues.app.allowOrbitInSketchMode.current])

  useEffect(() => {
    if (!canvasRef.current || !wrapperRef.current) {
      return
    }

    const canvas = canvasRef.current
    const wrapperElement = wrapperRef.current
    isPointerOverRef.current = false
    isHoverRefreshPausedRef.current = false

    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    })
    renderer.setSize(CANVAS_SIZE, CANVAS_SIZE)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    const scene = new Scene()
    const camera = createCamera()
    const { gizmoAxes, gizmoAxisHeads, gizmoAxisLabels, axisLabelObjects } =
      createGizmo()
    scene.add(...gizmoAxes, ...gizmoAxisHeads, ...gizmoAxisLabels)

    const raycaster = new Raycaster()
    const raycasterObjects = [...gizmoAxisHeads]
    const resetRayCast = () => {
      for (const object of raycasterObjects) {
        object.scale.setScalar(1)
      }
      updateAxisLabelHover(axisLabelObjects)
      raycasterIntersect.current = null
      renderer.render(scene, camera)
    }
    const doRayCast = (mouse: Vector2) => {
      // If orbits are disabled, skip click logic
      if (!disableOrbitRef.current) {
        updateRayCaster(
          raycasterObjects,
          raycaster,
          mouse,
          camera,
          raycasterIntersect,
          renderer,
          scene,
          axisLabelObjects
        )
      } else {
        resetRayCast()
      }
    }
    const updateHoverAtMouse = (mouse: Vector2) => {
      if (isHoverRefreshPausedRef.current) {
        return
      }
      doRayCast(mouse)
    }

    const clock = new Clock()
    const clientCamera = kclManager.sceneInfra.camControls.camera
    const currentQuaternion = new Quaternion().copy(clientCamera.quaternion)
    const mouse = new Vector2()
    mouse.x = 1 // fix initial mouse position issue
    let isDisposed = false
    const refreshHoverAfterCameraUpdate = () => {
      if (isDisposed) {
        return
      }

      isHoverRefreshPausedRef.current = false
      currentQuaternion.copy(
        kclManager.sceneInfra.camControls.camera.quaternion
      )
      camera.position.set(0, 0, 1).applyQuaternion(currentQuaternion)
      camera.quaternion.copy(currentQuaternion)
      if (isPointerOverRef.current) {
        doRayCast(mouse)
      } else {
        resetRayCast()
      }
    }
    const onAxisClick = (axisName: AxisNames) => {
      isHoverRefreshPausedRef.current = true
      resetRayCast()
      void kclManager.sceneInfra.camControls
        .updateCameraToAxis(axisName)
        .catch(reportRejection)
        .finally(refreshHoverAfterCameraUpdate)
    }

    const { disposeMouseEvents } = initializeMouseEvents(
      canvas,
      raycasterIntersect,
      disableOrbitRef,
      isPointerOverRef,
      updateHoverAtMouse,
      resetRayCast,
      onAxisClick,
      mouse,
      wrapperElement
    )

    const animate = () => {
      const delta = clock.getDelta()
      updateCameraOrientation(
        camera,
        currentQuaternion,
        kclManager.sceneInfra.camControls.camera.quaternion,
        delta,
        cameraPassiveUpdateTimer
      )
      if (isPointerOverRef.current && !isHoverRefreshPausedRef.current) {
        doRayCast(mouse)
      } else {
        renderer.render(scene, camera)
      }
    }
    kclManager.sceneInfra.camControls.cameraChange.add(animate)

    // Initialize camera orientation/position to match main camera for immediate render
    const q = kclManager.sceneInfra.camControls.camera.quaternion
    camera.position.set(0, 0, 1).applyQuaternion(q)
    camera.quaternion.copy(q)
    renderer.render(scene, camera)

    return () => {
      isDisposed = true
      isPointerOverRef.current = false
      isHoverRefreshPausedRef.current = false
      renderer.forceContextLoss()
      renderer.dispose()
      disposeMouseEvents()
      kclManager.sceneInfra.camControls.cameraChange.remove(animate)
    }
  }, [kclManager.sceneInfra])

  return (
    <div
      ref={wrapperRef}
      aria-label="View orientation gizmo"
      data-testid={`gizmo${disableOrbitRef.current ? '-disabled' : ''}`}
      className="relative grid place-content-center rounded-full overflow-hidden border border-solid border-primary/50 pointer-events-auto bg-chalkboard-10/70 dark:bg-chalkboard-100/80 backdrop-blur-sm"
    >
      <canvas ref={canvasRef} />
      <ViewControlContextMenu menuTargetElement={wrapperRef} />
    </div>
  )
}

const CANVAS_SIZE = 80
const FRUSTUM_SIZE = 0.5
const AXIS_LENGTH = 0.35
const AXIS_WIDTH = 0.02
const AXIS_HEAD_RADIUS = 0.085
const AXIS_HOVER_SCALE = 1.5
const AXIS_LABEL_FONT_SIZE = 9
const AXIS_LABEL_CONTOUR_WIDTH = 1.2
const AXIS_LABEL_FILL_COLOR = '#fcfcfc'
const AXIS_LABEL_CENTER = 8
const AXIS_LABEL_CENTER_Y = 8.5
const AXIS_LABEL_VIEWBOX_SIZE = 16
const AXIS_LABEL_TEXTURE_SIZE = 64
const AXIS_LABEL_WORLD_SIZE = AXIS_LABEL_VIEWBOX_SIZE / CANVAS_SIZE
enum AxisColors {
  X = '#fa6668',
  Y = '#11eb6b',
  Z = '#6689ef',
  Gray = '#c6c7c2',
}
type AxisLabel = 'X' | 'Y' | 'Z'
type PositiveAxisName = AxisNames.X | AxisNames.Y | AxisNames.Z
type AxisLabelObjects = Partial<Record<PositiveAxisName, Sprite>>
const POSITIVE_AXIS_NAMES = [AxisNames.X, AxisNames.Y, AxisNames.Z] as const
const AXIS_LABELS: Record<PositiveAxisName, AxisLabel> = {
  [AxisNames.X]: 'X',
  [AxisNames.Y]: 'Y',
  [AxisNames.Z]: 'Z',
}
const AXIS_LABEL_CONTOUR_COLORS: Record<PositiveAxisName, string> = {
  [AxisNames.X]: '#c94f52',
  [AxisNames.Y]: '#0bb858',
  [AxisNames.Z]: '#4d68c0',
}
const AXIS_HEAD_POSITIONS: Record<AxisNames, [number, number, number]> = {
  [AxisNames.X]: [AXIS_LENGTH, 0, 0],
  [AxisNames.Y]: [0, AXIS_LENGTH, 0],
  [AxisNames.Z]: [0, 0, AXIS_LENGTH],
  [AxisNames.NEG_X]: [-AXIS_LENGTH, 0, 0],
  [AxisNames.NEG_Y]: [0, -AXIS_LENGTH, 0],
  [AxisNames.NEG_Z]: [0, 0, -AXIS_LENGTH],
}
const createCamera = (): OrthographicCamera => {
  return new OrthographicCamera(
    -FRUSTUM_SIZE,
    FRUSTUM_SIZE,
    FRUSTUM_SIZE,
    -FRUSTUM_SIZE,
    0.5,
    3
  )
}

const createGizmo = () => {
  const gizmoAxes = [
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AxisColors.X, 0, 'z'),
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AxisColors.Y, Math.PI / 2, 'z'),
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AxisColors.Z, -Math.PI / 2, 'y'),
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AxisColors.Gray, Math.PI, 'z'),
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AxisColors.Gray, -Math.PI / 2, 'z'),
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AxisColors.Gray, Math.PI / 2, 'y'),
  ]

  const gizmoAxisHeads = [
    createAxisHead(AxisNames.X, AxisColors.X),
    createAxisHead(AxisNames.Y, AxisColors.Y),
    createAxisHead(AxisNames.Z, AxisColors.Z),
    createAxisHead(AxisNames.NEG_X, AxisColors.Gray),
    createAxisHead(AxisNames.NEG_Y, AxisColors.Gray),
    createAxisHead(AxisNames.NEG_Z, AxisColors.Gray),
  ]

  const axisLabelObjects: AxisLabelObjects = {}
  const gizmoAxisLabels = POSITIVE_AXIS_NAMES.map((axisName) => {
    const labelObject = createAxisLabel(axisName)
    axisLabelObjects[axisName] = labelObject
    return labelObject
  })

  return { gizmoAxes, gizmoAxisHeads, gizmoAxisLabels, axisLabelObjects }
}

const createAxis = (
  length: number,
  width: number,
  color: ColorRepresentation,
  rotation = 0,
  axis = 'x'
): Mesh => {
  const geometry = new BoxGeometry(length, width, width)
  geometry.translate(length / 2, 0, 0)
  const material = new MeshBasicMaterial({ color: new Color(color) })
  const mesh = new Mesh(geometry, material)
  mesh.rotation[axis as 'x' | 'y' | 'z'] = rotation
  return mesh
}

const createAxisHead = (name: AxisNames, color: ColorRepresentation): Mesh => {
  const geometry = new SphereGeometry(AXIS_HEAD_RADIUS, 16, 8)
  const material = new MeshBasicMaterial({ color: new Color(color) })
  const mesh = new Mesh(geometry, material)
  const position = AXIS_HEAD_POSITIONS[name]

  mesh.position.set(position[0], position[1], position[2])
  mesh.updateMatrixWorld()
  mesh.name = name
  return mesh
}

const createAxisLabel = (axisName: PositiveAxisName): Sprite => {
  const labelCenterY =
    axisName === AxisNames.Y ? AXIS_LABEL_CENTER_Y + 0.25 : AXIS_LABEL_CENTER_Y
  const canvas = document.createElement('canvas')
  canvas.width = AXIS_LABEL_TEXTURE_SIZE
  canvas.height = AXIS_LABEL_TEXTURE_SIZE

  const context = canvas.getContext('2d')
  if (context) {
    const textureScale = AXIS_LABEL_TEXTURE_SIZE / AXIS_LABEL_VIEWBOX_SIZE
    context.scale(textureScale, textureScale)
    context.font = `800 ${AXIS_LABEL_FONT_SIZE}px Inter, system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.lineWidth = AXIS_LABEL_CONTOUR_WIDTH
    context.strokeStyle = AXIS_LABEL_CONTOUR_COLORS[axisName]
    context.fillStyle = AXIS_LABEL_FILL_COLOR
    context.strokeText(AXIS_LABELS[axisName], AXIS_LABEL_CENTER, labelCenterY)
    context.fillText(AXIS_LABELS[axisName], AXIS_LABEL_CENTER, labelCenterY)
  }

  const texture = new CanvasTexture(canvas)
  const labelObject = new Sprite(
    new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
  )
  const [x, y, z] = AXIS_HEAD_POSITIONS[axisName]
  labelObject.position.set(x, y, z)
  setAxisLabelScale(labelObject)
  labelObject.renderOrder = 1

  return labelObject
}

const updateAxisLabelHover = (
  axisLabelObjects: AxisLabelObjects,
  hoveredAxisName?: AxisNames
) => {
  for (const axisName of POSITIVE_AXIS_NAMES) {
    const labelObject = axisLabelObjects[axisName]
    if (!labelObject) {
      continue
    }

    setAxisLabelScale(
      labelObject,
      hoveredAxisName === axisName ? AXIS_HOVER_SCALE : 1
    )
  }
}

const setAxisLabelScale = (labelObject: Sprite, scale = 1) => {
  const size = AXIS_LABEL_WORLD_SIZE * scale
  labelObject.scale.set(size, size, 1)
}

const updateCameraOrientation = (
  camera: OrthographicCamera,
  currentQuaternion: Quaternion,
  targetQuaternion: Quaternion,
  deltaTime: number,
  cameraPassiveUpdateTimer: MutableRefObject<number>
) => {
  cameraPassiveUpdateTimer.current += deltaTime
  if (
    !quaternionsEqual(currentQuaternion, targetQuaternion) ||
    cameraPassiveUpdateTimer.current >= 5
  ) {
    const slerpFactor = 1 - Math.exp(-30 * deltaTime)
    currentQuaternion.slerp(targetQuaternion, slerpFactor).normalize()
    camera.position.set(0, 0, 1).applyQuaternion(currentQuaternion)
    camera.quaternion.copy(currentQuaternion)
    cameraPassiveUpdateTimer.current = 0
  }
}

const quaternionsEqual = (
  q1: Quaternion,
  q2: Quaternion,
  tolerance = 0.001
): boolean => {
  return (
    Math.abs(q1.x - q2.x) < tolerance &&
    Math.abs(q1.y - q2.y) < tolerance &&
    Math.abs(q1.z - q2.z) < tolerance &&
    Math.abs(q1.w - q2.w) < tolerance
  )
}

const initializeMouseEvents = (
  canvas: HTMLCanvasElement,
  raycasterIntersect: MutableRefObject<Intersection | null>,
  disableOrbitRef: MutableRefObject<boolean>,
  isPointerOverRef: MutableRefObject<boolean>,
  updateHoverAtMouse: (mouse: Vector2) => void,
  resetRayCast: () => void,
  onAxisClick: (axisName: AxisNames) => void,
  mouse: Vector2,
  wrapperElement: HTMLDivElement
): { disposeMouseEvents: () => void } => {
  const handleMouseMove = (event: MouseEvent) => {
    isPointerOverRef.current = true
    const { left, top, width, height } = canvas.getBoundingClientRect()
    mouse.x = ((event.clientX - left) / width) * 2 - 1
    mouse.y = ((event.clientY - top) / height) * -2 + 1
    updateHoverAtMouse(mouse)
  }

  const handleMouseLeave = () => {
    isPointerOverRef.current = false
    resetRayCast()
  }

  const handleClick = () => {
    // If orbits are disabled, skip click logic
    if (disableOrbitRef.current || !raycasterIntersect.current) {
      return
    }
    const axisName = raycasterIntersect.current.object.name as AxisNames
    onAxisClick(axisName)
  }

  // Add the event listener to the div wrapper around the canvas
  wrapperElement.addEventListener('mousemove', handleMouseMove)
  wrapperElement.addEventListener('mouseleave', handleMouseLeave)
  wrapperElement.addEventListener('click', handleClick)

  const disposeMouseEvents = () => {
    wrapperElement.removeEventListener('mousemove', handleMouseMove)
    wrapperElement.removeEventListener('mouseleave', handleMouseLeave)
    wrapperElement.removeEventListener('click', handleClick)
  }

  return { disposeMouseEvents }
}

const updateRayCaster = (
  objects: Object3D[],
  raycaster: Raycaster,
  mouse: Vector2,
  camera: OrthographicCamera,
  raycasterIntersect: MutableRefObject<Intersection | null>,
  renderer: WebGLRenderer,
  scene: Scene,
  axisLabelObjects: AxisLabelObjects
) => {
  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(objects)
  const hoveredObject = intersects[0]?.object

  for (const object of objects) {
    object.scale.setScalar(object === hoveredObject ? AXIS_HOVER_SCALE : 1)
  }
  if (intersects.length) {
    const axisName = intersects[0].object.name as AxisNames
    updateAxisLabelHover(axisLabelObjects, axisName)
    raycasterIntersect.current = intersects[0] // filter first object
  } else {
    updateAxisLabelHover(axisLabelObjects)
    raycasterIntersect.current = null
  }

  renderer.render(scene, camera)
}
