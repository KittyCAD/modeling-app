import { useApp, useSingletons } from '@src/lib/boot'
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'

import { ViewControlContextMenu } from '@src/components/ViewControlMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { AxisNames } from '@src/lib/constants'
import { reportRejection } from '@src/lib/trap'
import type { ColorRepresentation, Intersection } from 'three'
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
  SRGBColorSpace,
  Scene,
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
    const { gizmoAxisPairs } = createGizmo()
    scene.add(...gizmoAxisPairs.flatMap(({ axis, head }) => [axis, head]))

    const raycaster = new Raycaster()
    const raycasterObjects = gizmoAxisPairs.map(({ head }) => head)
    const resetRayCast = () => {
      for (const object of raycasterObjects) {
        setAxisHeadScale(object)
      }
      raycasterIntersect.current = null
      renderGizmoScene(gizmoAxisPairs, renderer, scene, camera)
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
          gizmoAxisPairs
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
        renderGizmoScene(gizmoAxisPairs, renderer, scene, camera)
      }
    }
    kclManager.sceneInfra.camControls.cameraChange.add(animate)

    // Initialize camera orientation/position to match main camera for immediate render
    const q = kclManager.sceneInfra.camControls.camera.quaternion
    camera.position.set(0, 0, 1).applyQuaternion(q)
    camera.quaternion.copy(q)
    renderGizmoScene(gizmoAxisPairs, renderer, scene, camera)

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
const AXIS_STEM_LENGTH = AXIS_LENGTH - AXIS_HEAD_RADIUS * 0.9
const AXIS_HOVER_SCALE = 1.5
const AXIS_HEAD_WORLD_SIZE = AXIS_HEAD_RADIUS * 2
const AXIS_HEAD_TEXTURE_SIZE = 64
const AXIS_HEAD_VIEWBOX_SIZE = 16
const AXIS_HEAD_CENTER = AXIS_HEAD_VIEWBOX_SIZE / 2
const AXIS_HEAD_CIRCLE_RADIUS = 7.5
const AXIS_LABEL_FONT_SIZE = 9
const AXIS_LABEL_CONTOUR_WIDTH = 1.2
const AXIS_LABEL_FILL_COLOR = '#fcfcfc'
const AXIS_LABEL_CENTER_Y = 8.5
enum AxisColors {
  X = '#fa6668',
  Y = '#11eb6b',
  Z = '#6689ef',
  Gray = '#c6c7c2',
}
type AxisLabel = 'X' | 'Y' | 'Z'
type PositiveAxisName = AxisNames.X | AxisNames.Y | AxisNames.Z
type AxisRotation = 'x' | 'y' | 'z'
type GizmoAxisPair = {
  axis: Mesh
  head: Sprite
}
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
const isPositiveAxisName = (
  axisName: AxisNames
): axisName is PositiveAxisName =>
  POSITIVE_AXIS_NAMES.includes(axisName as PositiveAxisName)
const AXIS_HEAD_POSITIONS: Record<AxisNames, [number, number, number]> = {
  [AxisNames.X]: [AXIS_LENGTH, 0, 0],
  [AxisNames.Y]: [0, AXIS_LENGTH, 0],
  [AxisNames.Z]: [0, 0, AXIS_LENGTH],
  [AxisNames.NEG_X]: [-AXIS_LENGTH, 0, 0],
  [AxisNames.NEG_Y]: [0, -AXIS_LENGTH, 0],
  [AxisNames.NEG_Z]: [0, 0, -AXIS_LENGTH],
}
const GIZMO_AXIS_DEFINITIONS: {
  name: AxisNames
  color: AxisColors
  rotation: number
  axis: AxisRotation
}[] = [
  { name: AxisNames.X, color: AxisColors.X, rotation: 0, axis: 'z' },
  { name: AxisNames.Y, color: AxisColors.Y, rotation: Math.PI / 2, axis: 'z' },
  {
    name: AxisNames.Z,
    color: AxisColors.Z,
    rotation: -Math.PI / 2,
    axis: 'y',
  },
  {
    name: AxisNames.NEG_X,
    color: AxisColors.Gray,
    rotation: Math.PI,
    axis: 'z',
  },
  {
    name: AxisNames.NEG_Y,
    color: AxisColors.Gray,
    rotation: -Math.PI / 2,
    axis: 'z',
  },
  {
    name: AxisNames.NEG_Z,
    color: AxisColors.Gray,
    rotation: Math.PI / 2,
    axis: 'y',
  },
]
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
  const gizmoAxisPairs = GIZMO_AXIS_DEFINITIONS.map(
    ({ name, color, rotation, axis }) => ({
      axis: createAxis(AXIS_STEM_LENGTH, AXIS_WIDTH, color, rotation, axis),
      head: createAxisHead(name, color),
    })
  )

  return { gizmoAxisPairs }
}

const createAxis = (
  length: number,
  width: number,
  color: ColorRepresentation,
  rotation = 0,
  axis: AxisRotation = 'x'
): Mesh => {
  const geometry = new BoxGeometry(length, width, width)
  geometry.translate(length / 2, 0, 0)
  const material = new MeshBasicMaterial({
    color: new Color(color),
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.rotation[axis] = rotation
  return mesh
}

const createAxisHead = (
  name: AxisNames,
  color: ColorRepresentation
): Sprite => {
  const texture = createAxisHeadTexture(name, color)
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const sprite = new Sprite(material)
  const position = AXIS_HEAD_POSITIONS[name]

  sprite.position.set(position[0], position[1], position[2])
  setAxisHeadScale(sprite)
  sprite.name = name
  return sprite
}

const createAxisHeadTexture = (
  axisName: AxisNames,
  color: ColorRepresentation
) => {
  const canvas = document.createElement('canvas')
  canvas.width = AXIS_HEAD_TEXTURE_SIZE
  canvas.height = AXIS_HEAD_TEXTURE_SIZE

  const context = canvas.getContext('2d')
  if (context) {
    const textureScale = AXIS_HEAD_TEXTURE_SIZE / AXIS_HEAD_VIEWBOX_SIZE
    context.scale(textureScale, textureScale)

    context.fillStyle = new Color(color).getStyle()
    context.beginPath()
    context.arc(
      AXIS_HEAD_CENTER,
      AXIS_HEAD_CENTER,
      AXIS_HEAD_CIRCLE_RADIUS,
      0,
      Math.PI * 2
    )
    context.fill()

    if (isPositiveAxisName(axisName)) {
      const labelCenterY =
        axisName === AxisNames.Y
          ? AXIS_LABEL_CENTER_Y + 0.25
          : AXIS_LABEL_CENTER_Y

      context.font = `800 ${AXIS_LABEL_FONT_SIZE}px Inter, system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.lineJoin = 'round'
      context.lineWidth = AXIS_LABEL_CONTOUR_WIDTH
      context.strokeStyle = AXIS_LABEL_CONTOUR_COLORS[axisName]
      context.fillStyle = AXIS_LABEL_FILL_COLOR
      context.strokeText(AXIS_LABELS[axisName], AXIS_HEAD_CENTER, labelCenterY)
      context.fillText(AXIS_LABELS[axisName], AXIS_HEAD_CENTER, labelCenterY)
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

const setAxisHeadScale = (axisHead: Sprite, scale = 1) => {
  const size = AXIS_HEAD_WORLD_SIZE * scale
  axisHead.scale.set(size, size, 1)
}

const renderGizmoScene = (
  axisPairs: GizmoAxisPair[],
  renderer: WebGLRenderer,
  scene: Scene,
  camera: OrthographicCamera
) => {
  updateAxisPairRenderOrder(axisPairs, camera)
  renderer.render(scene, camera)
}

const updateAxisPairRenderOrder = (
  axisPairs: GizmoAxisPair[],
  camera: OrthographicCamera
) => {
  axisPairs.sort(
    (a, b) =>
      a.head.position.dot(camera.position) -
      b.head.position.dot(camera.position)
  )

  axisPairs.forEach(({ axis, head }, index) => {
    const renderOrder = index * 2
    axis.renderOrder = renderOrder
    head.renderOrder = renderOrder + 1
  })
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
  objects: Sprite[],
  raycaster: Raycaster,
  mouse: Vector2,
  camera: OrthographicCamera,
  raycasterIntersect: MutableRefObject<Intersection | null>,
  renderer: WebGLRenderer,
  scene: Scene,
  axisPairs: GizmoAxisPair[]
) => {
  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(objects)
  const hoveredObject = intersects[0]?.object

  for (const object of objects) {
    setAxisHeadScale(object, object === hoveredObject ? AXIS_HOVER_SCALE : 1)
  }
  if (intersects.length) {
    raycasterIntersect.current = intersects[0] // filter first object
  } else {
    raycasterIntersect.current = null
  }

  renderGizmoScene(axisPairs, renderer, scene, camera)
}
