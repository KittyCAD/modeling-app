import { useApp, useSingletons } from '@src/lib/boot'
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { ViewControlContextMenu } from '@src/components/ViewControlMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { AxisNames } from '@src/lib/constants'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ColorRepresentation, Intersection, Object3D } from 'three'
import {
  BoxGeometry,
  Clock,
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  WebGLRenderer,
} from 'three'
import {
  CSS2DObject,
  CSS2DRenderer,
} from 'three/examples/jsm/renderers/CSS2DRenderer'

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
    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    })
    renderer.setSize(CANVAS_SIZE, CANVAS_SIZE)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(CANVAS_SIZE, CANVAS_SIZE)
    labelRenderer.domElement.style.position = 'absolute'
    labelRenderer.domElement.style.inset = '0'
    labelRenderer.domElement.style.pointerEvents = 'none'
    labelRenderer.domElement.setAttribute('aria-hidden', 'true')
    wrapperElement.append(labelRenderer.domElement)

    const scene = new Scene()
    const camera = createCamera()
    const { gizmoAxes, gizmoAxisHeads, gizmoAxisLabels, axisLabelElements } =
      createGizmo()
    scene.add(...gizmoAxes, ...gizmoAxisHeads, ...gizmoAxisLabels)

    const raycaster = new Raycaster()
    const raycasterObjects = [...gizmoAxisHeads]
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
          labelRenderer,
          axisLabelElements
        )
      } else {
        resetAxisObjectScales(raycasterObjects)
        updateAxisLabelHover(axisLabelElements)
        raycasterIntersect.current = null // Clear intersection
      }
    }

    const { disposeMouseEvents } = initializeMouseEvents(
      canvas,
      raycasterIntersect,
      kclManager.sceneInfra,
      disableOrbitRef,
      doRayCast,
      wrapperElement
    )

    const clock = new Clock()
    const clientCamera = kclManager.sceneInfra.camControls.camera
    const currentQuaternion = new Quaternion().copy(clientCamera.quaternion)

    const animate = () => {
      const delta = clock.getDelta()
      updateCameraOrientation(
        camera,
        currentQuaternion,
        kclManager.sceneInfra.camControls.camera.quaternion,
        delta,
        cameraPassiveUpdateTimer
      )
      renderGizmo(renderer, labelRenderer, scene, camera)
    }
    kclManager.sceneInfra.camControls.cameraChange.add(animate)

    // Initialize camera orientation/position to match main camera for immediate render
    const q = kclManager.sceneInfra.camControls.camera.quaternion
    camera.position.set(0, 0, 1).applyQuaternion(q)
    camera.quaternion.copy(q)
    renderGizmo(renderer, labelRenderer, scene, camera)

    return () => {
      labelRenderer.domElement.remove()
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
const AXIS_HOVER_SCALE = 1.5
const AXIS_LABEL_FONT_SIZE = 7
const AXIS_LABEL_CONTOUR_WIDTH = 1
const AXIS_LABEL_CENTER = 8
const AXIS_LABEL_CENTER_Y = 8.5
enum AxisColors {
  X = '#fa6668',
  Y = '#11eb6b',
  Z = '#6689ef',
  Gray = '#c6c7c2',
}
type AxisLabel = 'X' | 'Y' | 'Z'
type PositiveAxisName = AxisNames.X | AxisNames.Y | AxisNames.Z
type AxisLabelElement = SVGSVGElement
type AxisLabelElements = Partial<Record<PositiveAxisName, AxisLabelElement>>
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
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

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

  const axisLabelElements: AxisLabelElements = {}
  const gizmoAxisLabels = POSITIVE_AXIS_NAMES.map((axisName) => {
    const { labelObject, labelElement } = createAxisLabel(axisName)
    axisLabelElements[axisName] = labelElement
    return labelObject
  })

  return { gizmoAxes, gizmoAxisHeads, gizmoAxisLabels, axisLabelElements }
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
  const geometry = new SphereGeometry(0.065, 16, 8)
  const material = new MeshBasicMaterial({ color: new Color(color) })
  const mesh = new Mesh(geometry, material)
  const position = AXIS_HEAD_POSITIONS[name]

  mesh.position.set(position[0], position[1], position[2])
  mesh.updateMatrixWorld()
  mesh.name = name
  mesh.userData.axisName = name
  mesh.userData.baseScale = [1, 1, 1]
  return mesh
}

const createAxisLabel = (
  axisName: PositiveAxisName
): { labelObject: CSS2DObject; labelElement: AxisLabelElement } => {
  const labelWrapper = document.createElement('div')
  labelWrapper.className = 'pointer-events-none'

  const labelElement = document.createElementNS(SVG_NAMESPACE, 'svg')
  labelElement.setAttribute('viewBox', '0 0 16 16')
  labelElement.setAttribute('width', '16')
  labelElement.setAttribute('height', '16')
  labelElement.classList.add('block', 'h-4', 'w-4', 'select-none')
  labelElement.style.overflow = 'visible'
  labelElement.style.transform = 'scale(1)'
  labelElement.style.transformOrigin = 'center'

  const labelText = document.createElementNS(SVG_NAMESPACE, 'text')
  labelText.textContent = AXIS_LABELS[axisName]
  labelText.setAttribute('x', String(AXIS_LABEL_CENTER))
  labelText.setAttribute('y', String(AXIS_LABEL_CENTER_Y))
  labelText.setAttribute('fill', 'var(--chalkboard-10)')
  labelText.setAttribute('stroke', AXIS_LABEL_CONTOUR_COLORS[axisName])
  labelText.setAttribute('stroke-width', String(AXIS_LABEL_CONTOUR_WIDTH))
  labelText.setAttribute('stroke-linejoin', 'round')
  labelText.setAttribute('font-family', 'inherit')
  labelText.setAttribute('font-size', String(AXIS_LABEL_FONT_SIZE))
  labelText.setAttribute('font-weight', '800')
  labelText.setAttribute('letter-spacing', '0')
  labelText.setAttribute('paint-order', 'stroke fill')
  labelText.setAttribute('text-anchor', 'middle')
  labelText.setAttribute('dominant-baseline', 'central')
  labelText.setAttribute('alignment-baseline', 'middle')
  labelElement.append(labelText)
  labelWrapper.append(labelElement)

  const labelObject = new CSS2DObject(labelWrapper)
  const [x, y, z] = AXIS_HEAD_POSITIONS[axisName]
  labelObject.position.set(x, y, z)
  labelObject.center.set(0.5, 0.5)

  return { labelObject, labelElement }
}

const getAxisName = (object: Object3D): AxisNames | undefined => {
  return Object.values(AxisNames).find((axisName) => {
    return object.userData.axisName === axisName
  })
}

const getBaseScale = (object: Object3D): [number, number, number] => {
  if (
    isArray(object.userData.baseScale) &&
    object.userData.baseScale.length === 3
  ) {
    const [x, y, z] = object.userData.baseScale
    if (
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof z === 'number'
    ) {
      return [x, y, z]
    }
  }
  return [1, 1, 1]
}

const setAxisObjectScale = (object: Object3D, scale: number) => {
  const [x, y, z] = getBaseScale(object)
  object.scale.set(x * scale, y * scale, z * scale)
}

const resetAxisObjectScales = (objects: Object3D[]) => {
  for (const object of objects) {
    setAxisObjectScale(object, 1)
  }
}

const renderGizmo = (
  renderer: WebGLRenderer,
  labelRenderer: CSS2DRenderer,
  scene: Scene,
  camera: OrthographicCamera
) => {
  renderer.render(scene, camera)
  labelRenderer.render(scene, camera)
}

const updateAxisLabelHover = (
  axisLabelElements: AxisLabelElements,
  hoveredAxisName?: AxisNames
) => {
  for (const axisName of POSITIVE_AXIS_NAMES) {
    const labelElement = axisLabelElements[axisName]
    if (!labelElement) {
      continue
    }

    const scale = hoveredAxisName === axisName ? AXIS_HOVER_SCALE : 1
    labelElement.style.transform = `scale(${scale})`
  }
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
  sceneInfra: SceneInfra,
  disableOrbitRef: MutableRefObject<boolean>,
  doRayCast: (mouse: Vector2) => void,
  wrapperElement: HTMLDivElement
): { mouse: Vector2; disposeMouseEvents: () => void } => {
  const mouse = new Vector2()
  mouse.x = 1 // fix initial mouse position issue

  const handleMouseMove = (event: MouseEvent) => {
    const { left, top, width, height } = canvas.getBoundingClientRect()
    mouse.x = ((event.clientX - left) / width) * 2 - 1
    mouse.y = ((event.clientY - top) / height) * -2 + 1
    doRayCast(mouse)
  }

  const handleClick = () => {
    // If orbits are disabled, skip click logic
    if (disableOrbitRef.current || !raycasterIntersect.current) {
      return
    }
    const axisName = getAxisName(raycasterIntersect.current.object)
    if (!axisName) {
      return
    }
    sceneInfra.camControls.updateCameraToAxis(axisName).catch(reportRejection)
  }

  // Add the event listener to the div wrapper around the canvas
  wrapperElement.addEventListener('mousemove', handleMouseMove)
  wrapperElement.addEventListener('click', handleClick)

  const disposeMouseEvents = () => {
    wrapperElement.removeEventListener('mousemove', handleMouseMove)
    wrapperElement.removeEventListener('click', handleClick)
  }

  return { mouse, disposeMouseEvents }
}

const updateRayCaster = (
  objects: Object3D[],
  raycaster: Raycaster,
  mouse: Vector2,
  camera: OrthographicCamera,
  raycasterIntersect: MutableRefObject<Intersection | null>,
  renderer: WebGLRenderer,
  scene: Scene,
  labelRenderer: CSS2DRenderer,
  axisLabelElements: AxisLabelElements
) => {
  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(objects)

  resetAxisObjectScales(objects)
  if (intersects.length) {
    const axisName = getAxisName(intersects[0].object)
    updateAxisLabelHover(axisLabelElements, axisName)
    if (axisName) {
      for (const object of objects) {
        if (getAxisName(object) === axisName) {
          setAxisObjectScale(object, AXIS_HOVER_SCALE)
        }
      }
    }
    raycasterIntersect.current = intersects[0] // filter first object
  } else {
    updateAxisLabelHover(axisLabelElements)
    raycasterIntersect.current = null
  }

  renderGizmo(renderer, labelRenderer, scene, camera)
}
