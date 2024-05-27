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
enum AxisNames {
  X = 'x',
  Y = 'y',
  Z = 'z',
  NEG_X = '-x',
  NEG_Y = '-y',
  NEG_Z = '-z',
  RESET = 'reset',
}

export default function Gizmo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const raycasterIntersect = useRef<Intersection<Object3D> | null>(null)

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
      sceneInfra
    )
    const raycasterObjects = [...gizmoAxisHeads]

    const clock = new Clock()
    const clientCamera = sceneInfra.camControls.camera
    let currentQuaternion = new Quaternion().copy(clientCamera.quaternion)

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

    const animate = () => {
      const delta = clock.getDelta()
      if (
        !quaternionsEqual(
          currentQuaternion,
          sceneInfra.camControls.camera.quaternion
        )
      ) {
        updateCameraOrientation(
          camera,
          currentQuaternion,
          sceneInfra.camControls.camera.quaternion,
          delta
        )
      }
      updateRayCaster(
        raycasterObjects,
        raycaster,
        mouse,
        camera,
        raycasterIntersect
      )
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
    <div className="grid place-content-center rounded-full overflow-hidden border border-solid border-primary/50 pointer-events-none">
      <canvas ref={canvasRef} />
    </div>
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
    createAxisHead(AxisNames.RESET, AxisColors.Gray, [0, 0, 0]),
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
  deltaTime: number
) => {
  const slerpFactor = 1 - Math.exp(-30 * deltaTime)
  currentQuaternion.slerp(targetQuaternion, slerpFactor).normalize()
  camera.position.set(0, 0, 1).applyQuaternion(currentQuaternion)
  camera.quaternion.copy(currentQuaternion)
}

const initializeMouseEvents = (
  canvas: HTMLCanvasElement,
  raycasterIntersect: MutableRefObject<Intersection<Object3D> | null>,
  sceneInfra: SceneInfra
): { mouse: Vector2; disposeMouseEvents: () => void } => {
  const mouse = new Vector2()
  mouse.x = 1 // fix initial mouse position issue

  const handleMouseMove = (event: MouseEvent) => {
    const { left, top, width, height } = canvas.getBoundingClientRect()
    mouse.x = ((event.clientX - left) / width) * 2 - 1
    mouse.y = ((event.clientY - top) / height) * -2 + 1
  }

  const handleClick = () => {
    if (raycasterIntersect.current) {
      const axisName = raycasterIntersect.current.object.name as AxisNames
      sceneInfra.camControls.updateCameraToAxis(axisName)
    }
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
  raycasterIntersect: MutableRefObject<Intersection<Object3D> | null>
) => {
  // check if mouse is outside the canvas bounds and stop raycaster
  if (mouse.x < -1 || mouse.x > 1 || mouse.y < -1 || mouse.y > 1) {
    raycasterIntersect.current = null
    return
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
}
