import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { useRef, useEffect } from 'react'
import { engineCommandManager } from 'lang/std/engineConnection'
import { v4 as uuidv4 } from 'uuid'
import { throttle } from 'lib/utils'

const updateEngineCamera = throttle(
  ({
    position,
    quaternion,
  }: {
    position: THREE.Vector3
    quaternion: THREE.Quaternion
  }) => {
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ')

    // Calculate the lookAt vector (the point the camera is looking at)
    const lookAtVector = new THREE.Vector3(0, 0, -1)
      .applyEuler(euler)
      .normalize()
      .add(position)

    // Calculate the up vector for the camera
    const upVector = new THREE.Vector3(0, 1, 0).applyEuler(euler).normalize()
    // Send the look_at command to the engine with corrected axis for Z-up convention
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        center: lookAtVector,
        up: upVector,
        vantage: position,
      },
    })
  },
  1000 / 30
)

class SceneSingleton {
  static instance: SceneSingleton
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer

  constructor() {
    // SCENE
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x000000)
    this.scene.background = null
    // CAMERA
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    )
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(0, -128, 64)
    // RENDERER
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }) // Enable transparency
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x000000, 0) // Set clear color to black with 0 alpha (fully transparent)
    window.addEventListener('resize', this.onWindowResize)

    const makeCube = (
      size: [number, number, number],
      color: THREE.ColorRepresentation
    ) =>
      new THREE.Mesh(
        new THREE.BoxGeometry(...size),
        new THREE.MeshBasicMaterial({ color })
      )
    this.scene.add(makeCube([1, 1, 25], 0x0000ff))
    this.scene.add(makeCube([1, 100, 1], 0x00ff00))
    this.scene.add(makeCube([100, 1, 1], 0xff0000))

    const size = 100
    const divisions = 10

    const gridHelper = new THREE.GridHelper(size, divisions)
    gridHelper.rotation.x = Math.PI / 2
    this.scene.add(gridHelper)

    const light = new THREE.AmbientLight(0x505050) // soft white light
    this.scene.add(light)

    const controls = new OrbitControls(this.camera, this.renderer.domElement)
    controls.addEventListener('change', () => {
      // Extract the position and orientation of the camera
      const position = this.camera.position
      const quaternion = this.camera.quaternion

      updateEngineCamera({ position, quaternion })

      //const zoomMagnitude = // TODO this will become more important with an orthographic camera

      // Send the zoom command to the engine
      // engineCommandManager.sendSceneCommand({
      //   type: 'modeling_cmd_req',
      //   cmd_id: uuidv4(),
      //   cmd: {
      //     type: 'default_camera_zoom',
      //     magnitude: zoomMagnitude,
      //   },
      // })
    })

    SceneSingleton.instance = this
  }
  onStreamStart = () => {
    updateEngineCamera({
      quaternion: this.camera.quaternion,
      position: this.camera.position,
    })
  }

  onWindowResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
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
