import { SceneInfra } from 'clientSideScene/sceneInfra'
import { sceneInfra } from 'lib/singletons'
import { MutableRefObject, useEffect, useRef } from 'react'
import {
  WebGLRenderer,
  Scene,
  OrthographicCamera,
  BoxGeometry,
  SphereGeometry,
  MeshBasicMaterial,
  Color,
  Mesh,
  Clock,
  Quaternion,
  ColorRepresentation,
  Vector2,
  Raycaster,
  Camera,
  Intersection,
  Object3D,
} from 'three'
import { Popover } from '@headlessui/react'
import { CustomIcon } from './CustomIcon'
import { reportRejection } from 'lib/trap'
import {
  useViewControlMenuItems,
  ViewControlContextMenu,
} from './ViewControlMenu'
import { AxisNames } from 'lib/constants'
import { useModelingContext } from 'hooks/useModelingContext'
import { useSettings } from 'machines/appMachine'

const CANVAS_SIZE = 80
const FRUSTUM_SIZE = 0.5
const AXIS_LENGTH = 0.35
const AXIS_WIDTH = 0.02
enum AxisColors {
  X = '#fa6668',
  Y = '#11eb6b',
  Z = '#6689ef',
  Gray = '#c6c7c2',
}

export default function Gizmo() {
  const { state: modelingState } = useModelingContext()
  const settings = useSettings()
  const menuItems = useViewControlMenuItems()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const raycasterIntersect = useRef<Intersection<Object3D> | null>(null)
  const cameraPassiveUpdateTimer = useRef(0)
  const raycasterPassiveUpdateTimer = useRef(0)
  const disableOrbitRef = useRef(false)

  // Temporary fix for #4040:
  // Disable gizmo orbiting in sketch mode
  // This effect updates disableOrbitRef whenever the user
  // toggles between Sketch mode and 3D mode
  useEffect(() => {
    disableOrbitRef.current =
      modelingState.matches('Sketch') &&
      !settings.app.allowOrbitInSketchMode.current
    if (wrapperRef.current) {
      wrapperRef.current.style.filter = disableOrbitRef.current
        ? 'grayscale(100%)'
        : 'none'
      wrapperRef.current.style.cursor = disableOrbitRef.current
        ? 'not-allowed'
        : 'auto'
    }
  }, [modelingState, settings.app.allowOrbitInSketchMode.current])

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setSize(CANVAS_SIZE, CANVAS_SIZE)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    const scene = new Scene()
    const camera = createCamera()
    const { gizmoAxes, gizmoAxisHeads } = createGizmo()
    scene.add(...gizmoAxes, ...gizmoAxisHeads)

    const raycaster = new Raycaster()
    const { mouse, disposeMouseEvents } = initializeMouseEvents(
      canvas,
      raycasterIntersect,
      sceneInfra,
      disableOrbitRef
    )
    const raycasterObjects = [...gizmoAxisHeads]

    const clock = new Clock()
    const clientCamera = sceneInfra.camControls.camera
    let currentQuaternion = new Quaternion().copy(clientCamera.quaternion)

    const animate = () => {
      const delta = clock.getDelta()
      updateCameraOrientation(
        camera,
        currentQuaternion,
        sceneInfra.camControls.camera.quaternion,
        delta,
        cameraPassiveUpdateTimer
      )
      // If orbits are disabled, skip click logic
      if (!disableOrbitRef.current) {
        updateRayCaster(
          raycasterObjects,
          raycaster,
          mouse,
          camera,
          raycasterIntersect,
          delta,
          raycasterPassiveUpdateTimer
        )
      } else {
        raycasterObjects.forEach((object) => object.scale.set(1, 1, 1)) // Reset scales
        raycasterIntersect.current = null // Clear intersection
      }
      renderer.render(scene, camera)
      requestAnimationFrame(animate)
    }
    animate()

    return () => {
      renderer.dispose()
      disposeMouseEvents()
    }
  }, [])

  return (
    <div className="relative">
      <div
        ref={wrapperRef}
        aria-label="View orientation gizmo"
        data-testid={`gizmo${disableOrbitRef.current ? '-disabled' : ''}`}
        className="grid place-content-center rounded-full overflow-hidden border border-solid border-primary/50 pointer-events-auto bg-chalkboard-10/70 dark:bg-chalkboard-100/80 backdrop-blur-sm"
      >
        <canvas ref={canvasRef} />
        <ViewControlContextMenu menuTargetElement={wrapperRef} />
      </div>
      <GizmoDropdown items={menuItems} />
    </div>
  )
}

function GizmoDropdown({ items }: { items: React.ReactNode[] }) {
  return (
    <Popover className="absolute top-0 right-0 pointer-events-auto">
      {({ close }) => (
        <>
          <Popover.Button className="border-none p-0 m-0 -translate-y-1/4 translate-x-1/4">
            <CustomIcon
              name="caretDown"
              className="w-4 h-4 ui-open:rotate-180"
            />
            <span className="sr-only">View settings</span>
          </Popover.Button>
          <Popover.Panel
            className={`absolute bottom-full right-0 mb-2 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
      border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded
      shadow-lg`}
          >
            <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
              {items.map((item, index) => (
                <li key={index} className="contents" onClick={() => close()}>
                  {item}
                </li>
              ))}
            </ul>
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
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
    createAxisHead(AxisNames.X, AxisColors.X, [AXIS_LENGTH, 0, 0]),
    createAxisHead(AxisNames.Y, AxisColors.Y, [0, AXIS_LENGTH, 0]),
    createAxisHead(AxisNames.Z, AxisColors.Z, [0, 0, AXIS_LENGTH]),
    createAxisHead(AxisNames.NEG_X, AxisColors.Gray, [-AXIS_LENGTH, 0, 0]),
    createAxisHead(AxisNames.NEG_Y, AxisColors.Gray, [0, -AXIS_LENGTH, 0]),
    createAxisHead(AxisNames.NEG_Z, AxisColors.Gray, [0, 0, -AXIS_LENGTH]),
  ]

  return { gizmoAxes, gizmoAxisHeads }
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

const createAxisHead = (
  name: AxisNames,
  color: ColorRepresentation,
  position: number[]
): Mesh => {
  const geometry = new SphereGeometry(0.065, 16, 8)
  const material = new MeshBasicMaterial({ color: new Color(color) })
  const mesh = new Mesh(geometry, material)

  mesh.position.set(position[0], position[1], position[2])
  mesh.updateMatrixWorld()
  mesh.name = name
  return mesh
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
  tolerance: number = 0.001
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
  raycasterIntersect: MutableRefObject<Intersection<Object3D> | null>,
  sceneInfra: SceneInfra,
  disableOrbitRef: MutableRefObject<boolean>
): { mouse: Vector2; disposeMouseEvents: () => void } => {
  const mouse = new Vector2()
  mouse.x = 1 // fix initial mouse position issue

  const handleMouseMove = (event: MouseEvent) => {
    const { left, top, width, height } = canvas.getBoundingClientRect()
    mouse.x = ((event.clientX - left) / width) * 2 - 1
    mouse.y = ((event.clientY - top) / height) * -2 + 1
  }

  const handleClick = () => {
    // If orbits are disabled, skip click logic
    if (disableOrbitRef.current || !raycasterIntersect.current) return
    const axisName = raycasterIntersect.current.object.name as AxisNames
    sceneInfra.camControls.updateCameraToAxis(axisName).catch(reportRejection)
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('click', handleClick)

  const disposeMouseEvents = () => {
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('click', handleClick)
  }

  return { mouse, disposeMouseEvents }
}

const updateRayCaster = (
  objects: Object3D[],
  raycaster: Raycaster,
  mouse: Vector2,
  camera: Camera,
  raycasterIntersect: MutableRefObject<Intersection<Object3D> | null>,
  deltaTime: number,
  raycasterPassiveUpdateTimer: MutableRefObject<number>
) => {
  raycasterPassiveUpdateTimer.current += deltaTime

  // check if mouse is outside the canvas bounds and stop raycaster
  if (raycasterPassiveUpdateTimer.current < 2) {
    if (mouse.x < -1 || mouse.x > 1 || mouse.y < -1 || mouse.y > 1) {
      raycasterIntersect.current = null
      return
    }
  }

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(objects)

  objects.forEach((object) => object.scale.set(1, 1, 1))
  if (intersects.length) {
    intersects[0].object.scale.set(1.5, 1.5, 1.5)
    raycasterIntersect.current = intersects[0] // filter first object
  } else {
    raycasterIntersect.current = null
  }
  if (raycasterPassiveUpdateTimer.current > 2) {
    raycasterPassiveUpdateTimer.current = 0
  }
}
