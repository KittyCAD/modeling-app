import {
  AmbientLight,
  BoxGeometry,
  Color,
  ColorRepresentation,
  Euler,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { useRef, useEffect } from 'react'
import { engineCommandManager } from 'lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { throttle } from 'lib/utils'

// 63.5 is definitely a bit of a magic number, play with it until it looked right
// if it were 64, that would feel like it's something in the engine where a random
// power of 2 is used, but it's the 0.5 seems to make things look much more correct
const ZOOM_MAGIC_NUMBER = 63.5

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

class SceneSingleton {
  static instance: SceneSingleton
  scene: Scene
  camera: PerspectiveCamera | OrthographicCamera
  renderer: WebGLRenderer
  controls: OrbitControls
  isPerspective = true

  constructor() {
    // SCENE
    this.scene = new Scene()
    this.scene.background = new Color(0x000000)
    this.scene.background = null
    // CAMERA
    this.camera = new PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    )
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(0, -128, 64)
    // RENDERER
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true }) // Enable transparency
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x000000, 0) // Set clear color to black with 0 alpha (fully transparent)
    window.addEventListener('resize', this.onWindowResize)

    const makeCube = (
      size: [number, number, number],
      color: ColorRepresentation
    ) => new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ color }))
    // this.scene.add(makeCube([1, 1, 25], 0x0000ff))
    // this.scene.add(makeCube([1, 100, 1], 0x00ff00))
    // this.scene.add(makeCube([100, 1, 1], 0xff0000))

    const size = 100
    const divisions = 10

    const gridHelper = new GridHelper(size, divisions, 0x0000ff, 0x0000ff)
    gridHelper.rotation.x = Math.PI / 2
    this.scene.add(gridHelper)

    const light = new AmbientLight(0x505050) // soft white light
    this.scene.add(light)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.addEventListener('change', this.updateEngineCamera)

    SceneSingleton.instance = this
  }
  onStreamStart = () => {
    this.updateEngineCamera()
  }
  updateEngineCamera = () => {
    throttledUpdateEngineCamera({
      quaternion: this.camera.quaternion,
      position: this.camera.position,
      zoom: this.camera.zoom,
      isPerspective: this.isPerspective,
    })
  }

  onWindowResize = () => {
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = window.innerWidth / window.innerHeight
    } else if (this.camera instanceof OrthographicCamera) {
      this.camera.left = -window.innerWidth / 2
      this.camera.right = window.innerWidth / 2
      this.camera.top = window.innerHeight / 2
      this.camera.bottom = -window.innerHeight / 2
    }
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  animate = () => {
    requestAnimationFrame(this.animate)
    this.renderer.render(this.scene, this.camera)
  }
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
    const d = 20 // size of the orthographic view
    this.camera = new OrthographicCamera(
      -d * aspect,
      d * aspect,
      d,
      -d,
      1,
      1000
    )
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(px, py, pz)
    const distance = this.camera.position.distanceTo(new Vector3(tx, ty, tz))
    this.camera.zoom = ZOOM_MAGIC_NUMBER / distance
    this.camera.quaternion.set(qx, qy, qz, qw)
    this.camera.updateProjectionMatrix()

    this.controls.dispose() // Dispose the old controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement) // Create new controls for the orthographic camera
    this.controls.target.set(tx, ty, tz)
    this.controls.update()
    this.controls.addEventListener('change', this.updateEngineCamera)

    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_orthographic',
      },
    })
    this.updateEngineCamera()
  }
  usePerspectiveCamera = () => {
    this.isPerspective = true
    const { x: px, y: py, z: pz } = this.camera.position
    const { x: qx, y: qy, z: qz, w: qw } = this.camera.quaternion
    const { x: tx, y: ty, z: tz } = this.controls.target
    this.camera = new PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    )
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(px, py, pz)
    this.camera.quaternion.set(qx, qy, qz, qw)

    this.controls.dispose() // Dispose the old controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement) // Create new controls for the perspective camera
    this.controls.target.set(tx, ty, tz)
    this.controls.update()
    this.controls.addEventListener('change', this.updateEngineCamera)
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_set_perspective',
        parameters: {
          fov_y: 45,
          z_near: 0.1,
          z_far: 1000,
        },
      },
    })
    this.updateEngineCamera()
  }
}

export const sceneSingleton = new SceneSingleton()

export const ClientSideScene = () => {
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    canvasRef.current.appendChild(sceneSingleton.renderer.domElement)
    sceneSingleton.animate()
  }, [])

  return <div ref={canvasRef} className="absolute inset-0 h-full w-full"></div>
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

  // Calculate the lookAt vector (the point the camera is looking at)
  const lookAtVector = new Vector3(0, 0, -1)
    .applyEuler(euler)
    .normalize()
    .add(position)

  // Calculate the up vector for the camera
  const upVector = new Vector3(0, 1, 0).applyEuler(euler).normalize()
  if (isPerspective) {
    return {
      center: lookAtVector,
      up: upVector,
      vantage: position,
    }
  }
  // Calculate the new vantage point based on the zoom level
  const zoomFactor = -ZOOM_MAGIC_NUMBER / zoom
  const direction = lookAtVector.clone().sub(position).normalize()
  const newVantage = position.clone().add(direction.multiplyScalar(zoomFactor))
  return {
    center: lookAtVector,
    up: upVector,
    vantage: newVantage,
  }
}
