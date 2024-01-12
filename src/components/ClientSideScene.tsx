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
  cube: THREE.Mesh

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

    const geometry = new THREE.BoxGeometry(1, 1, 25)
    const material = new THREE.MeshBasicMaterial({ color: 0x0000ff })
    const geometry2 = new THREE.BoxGeometry(1, 100, 1)
    const material2 = new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    const geometry3 = new THREE.BoxGeometry(100, 1, 1)
    const material3 = new THREE.MeshBasicMaterial({ color: 0xff0000 })
    this.cube = new THREE.Mesh(geometry, material)
    const cube2 = new THREE.Mesh(geometry2, material2)
    const cube3 = new THREE.Mesh(geometry3, material3)
    this.scene.add(this.cube)
    this.scene.add(cube2)
    this.scene.add(cube3)

    const light = new THREE.AmbientLight(0x404040) // soft white light
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
