import { sceneInfra } from 'lib/singletons'
import { useEffect, useRef } from 'react'
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
} from 'three'

const CANVAS_SIZE = 80
const FRUSTUM_SIZE = 0.5
const AXIS_LENGTH = 0.35
const AXIS_WIDTH = 0.02
const AXIS_COLORS = {
  x: '#fa6668',
  y: '#11eb6b',
  z: '#6689ef',
  gray: '#c6c7c2',
}

export default function Gizmo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

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

    const clock = new Clock()
    const clientCamera = sceneInfra.camControls.camera
    let currentQuaternion = new Quaternion().copy(clientCamera.quaternion)

    const animate = () => {
      requestAnimationFrame(animate)
      updateCameraOrientation(
        camera,
        currentQuaternion,
        sceneInfra.camControls.camera.quaternion,
        clock.getDelta()
      )
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      renderer.dispose()
    }
  }, [])

  return (
    <div className="grid place-content-center rounded-full overflow-hidden border border-solid border-primary/50 pointer-events-none">
      <canvas ref={canvasRef} />
    </div>
  )
}

const createCamera = () => {
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
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AXIS_COLORS.x, 0, 'z'),
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AXIS_COLORS.y, Math.PI / 2, 'z'),
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AXIS_COLORS.z, -Math.PI / 2, 'y'),
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AXIS_COLORS.gray, Math.PI, 'z'),
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AXIS_COLORS.gray, -Math.PI / 2, 'z'),
    createAxis(AXIS_LENGTH, AXIS_WIDTH, AXIS_COLORS.gray, Math.PI / 2, 'y'),
  ]

  const gizmoAxisHeads = [
    createAxisHead(AXIS_LENGTH, AXIS_COLORS.x, 0, 'z'),
    createAxisHead(AXIS_LENGTH, AXIS_COLORS.y, Math.PI / 2, 'z'),
    createAxisHead(AXIS_LENGTH, AXIS_COLORS.z, -Math.PI / 2, 'y'),
    createAxisHead(AXIS_LENGTH, AXIS_COLORS.gray, Math.PI, 'z'),
    createAxisHead(AXIS_LENGTH, AXIS_COLORS.gray, -Math.PI / 2, 'z'),
    createAxisHead(AXIS_LENGTH, AXIS_COLORS.gray, Math.PI / 2, 'y'),
  ]

  return { gizmoAxes, gizmoAxisHeads }
}

const createAxis = (
  length: number,
  width: number,
  color: ColorRepresentation,
  rotation = 0,
  axis = 'x'
) => {
  const geometry = new BoxGeometry(length, width, width).translate(
    length / 2,
    0,
    0
  )
  const material = new MeshBasicMaterial({ color: new Color(color) })
  const mesh = new Mesh(geometry, material)
  mesh.rotation[axis as 'x' | 'y' | 'z'] = rotation
  return mesh
}

const createAxisHead = (
  length: number,
  color: ColorRepresentation,
  rotation = 0,
  axis = 'x'
) => {
  const geometry = new SphereGeometry(0.065, 16, 8).translate(length, 0, 0)
  const material = new MeshBasicMaterial({ color: new Color(color) })
  const mesh = new Mesh(geometry, material)
  mesh.rotation[axis as 'x' | 'y' | 'z'] = rotation
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
