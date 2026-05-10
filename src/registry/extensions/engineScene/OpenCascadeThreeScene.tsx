import { useEffect, useRef, useState } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { useApp, useSingletons } from '@src/lib/boot'
import {
  addOpenCascadeCameraControlListener,
  cameraMouseDragGuards,
  type CameraAxisName,
  type OpenCascadeCameraControlCommand,
} from '@src/lib/cameraControls'
import type { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'

export function OpenCascadeThreeScene({ diagnostic }: { diagnostic?: string }) {
  useSignals()
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const mouseControls = settings.useSettings().modeling.mouseControls.current
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | undefined>(undefined)
  const cameraRef = useRef<PerspectiveCamera | undefined>(undefined)
  const rendererRef = useRef<WebGLRenderer | undefined>(undefined)
  const modelRootRef = useRef<Group | undefined>(undefined)
  const targetRef = useRef(new Vector3())
  const modelRadiusRef = useRef(5)
  const hasFramedModelRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [stage, setStage] = useState('waiting')
  const engineCommandManager =
    kclManager.engineCommandManager as EngineCommandManagerProxy
  const latestShapeVersion =
    engineCommandManager.openCascadeCommandManager.latestShapeVersion.value
  const exportError =
    diagnostic ||
    engineCommandManager.openCascadeCommandManager.latestExportError.value

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const scene = new Scene()
    scene.background = new Color('#f5f7fa')
    const camera = new PerspectiveCamera(38, 1, 0.01, 1000)
    camera.position.set(6, -8, 6)
    camera.lookAt(targetRef.current)

    const ambient = new AmbientLight('#ffffff', 1.8)
    const key = new DirectionalLight('#ffffff', 3.2)
    key.position.set(5, -6, 8)
    const fill = new DirectionalLight('#c8d7ff', 1.2)
    fill.position.set(-5, 4, 5)
    scene.add(ambient, key, fill)

    const modelRoot = new Group()
    scene.add(modelRoot)

    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    })
    renderer.setPixelRatio(1)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.domElement.dataset.testid = 'open-cascade-scene-canvas'
    renderer.domElement.className = 'block h-full w-full cursor-grab'
    container.appendChild(renderer.domElement)

    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    modelRootRef.current = modelRoot

    const render = () => renderer.render(scene, camera)
    const resize = () => {
      const width = Math.max(1, container.clientWidth)
      const height = Math.max(1, container.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      render()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    return () => {
      resizeObserver.disconnect()
      renderer.dispose()
      renderer.domElement.remove()
      scene.clear()
      sceneRef.current = undefined
      cameraRef.current = undefined
      rendererRef.current = undefined
      modelRootRef.current = undefined
    }
  }, [])

  useEffect(() => {
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    if (!renderer || !scene || !camera) {
      return
    }

    const guards = cameraMouseDragGuards[mouseControls]
    const element = renderer.domElement
    const lastPointer = new Vector2()
    let interaction: 'pan' | 'rotate' | 'zoom' | undefined
    const render = () => renderer.render(scene, camera)
    const stopInteraction = () => {
      interaction = undefined
      element.classList.remove('cursor-grabbing')
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stopInteraction)
    }
    const onMouseDown = (event: MouseEvent) => {
      const canStartLeniently = (button: number | undefined) =>
        button !== undefined && event.button === button
      if (
        guards.pan.callback(event) ||
        canStartLeniently(guards.pan.lenientDragStartButton)
      ) {
        interaction = 'pan'
      } else if (guards.zoom.dragCallback(event)) {
        interaction = 'zoom'
      } else if (
        guards.rotate.callback(event) ||
        canStartLeniently(guards.rotate.lenientDragStartButton)
      ) {
        interaction = 'rotate'
      } else {
        return
      }

      event.preventDefault()
      lastPointer.set(event.clientX, event.clientY)
      element.classList.add('cursor-grabbing')
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', stopInteraction)
    }
    const onMouseMove = (event: MouseEvent) => {
      if (!interaction) {
        return
      }

      const dx = event.clientX - lastPointer.x
      const dy = event.clientY - lastPointer.y
      lastPointer.set(event.clientX, event.clientY)
      if (interaction === 'pan') {
        panCamera(camera, targetRef.current, dx, dy)
      } else if (interaction === 'zoom') {
        zoomCamera(camera, targetRef.current, 1 + dy * 0.01)
      } else {
        orbitCamera(camera, targetRef.current, dx, dy)
      }
      render()
    }
    const onWheel = (event: WheelEvent) => {
      if (!guards.zoom.scrollCallback(event)) {
        return
      }

      event.preventDefault()
      zoomCamera(camera, targetRef.current, event.deltaY > 0 ? 1.1 : 0.9)
      render()
    }
    const onContextMenu = (event: MouseEvent) => event.preventDefault()

    element.addEventListener('mousedown', onMouseDown)
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('contextmenu', onContextMenu)
    return () => {
      element.removeEventListener('mousedown', onMouseDown)
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('contextmenu', onContextMenu)
      stopInteraction()
    }
  }, [mouseControls])

  useEffect(() => {
    return addOpenCascadeCameraControlListener((command) => {
      const scene = sceneRef.current
      const camera = cameraRef.current
      const renderer = rendererRef.current
      if (!scene || !camera || !renderer) {
        return
      }

      applyOpenCascadeCameraCommand(
        command,
        camera,
        targetRef.current,
        modelRadiusRef.current
      )
      renderer.render(scene, camera)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined

    async function loadLatestShape() {
      const scene = sceneRef.current
      const camera = cameraRef.current
      const renderer = rendererRef.current
      const modelRoot = modelRootRef.current
      if (!scene || !camera || !renderer || !modelRoot) {
        return
      }

      setReady(false)
      setStage('export')
      modelRoot.clear()
      const bytes = await engineCommandManager.exportLatestOpenCascadeGlbBytes()
      if (cancelled) {
        return
      }
      if (bytes.length === 0) {
        setStage('empty')
        renderer.render(scene, camera)
        return
      }

      objectUrl = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: 'model/gltf-binary' })
      )
      setStage('load')
      const gltf = await new GLTFLoader().loadAsync(objectUrl)
      if (cancelled) {
        return
      }

      modelRoot.clear()
      gltf.scene.traverse((object) => {
        if (object instanceof Mesh) {
          object.material = new MeshStandardMaterial({
            color: '#8ea6c9',
            roughness: 0.58,
            metalness: 0.04,
          })
          object.castShadow = false
          object.receiveShadow = false
        }
      })
      modelRoot.add(gltf.scene)
      const radius = centerObject(gltf.scene)
      modelRadiusRef.current = radius
      fitCameraToRadius(
        camera,
        targetRef.current,
        radius,
        !hasFramedModelRef.current
      )
      hasFramedModelRef.current = true
      renderer.render(scene, camera)
      setStage('ready')
      setReady(true)
    }

    loadLatestShape().catch((error) => {
      if (!cancelled) {
        setStage(
          error instanceof Error ? `error: ${error.message}` : 'error: unknown'
        )
      }
      console.warn(error)
    })

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [engineCommandManager, latestShapeVersion])

  return (
    <div
      ref={containerRef}
      data-testid="open-cascade-scene"
      data-stage={stage}
      className="relative min-h-0 w-full flex-1 overflow-hidden"
    >
      <div
        data-testid="open-cascade-scene-ready"
        data-ready={ready ? 'true' : 'false'}
        data-stage={stage}
        data-diagnostic={exportError || ''}
        className="sr-only"
      />
      {exportError && (
        <div className="absolute left-3 top-3 max-w-[32rem] rounded border border-destroy-40 bg-chalkboard-10/90 px-3 py-2 text-xs text-destroy-80 shadow-sm dark:bg-chalkboard-100/90 dark:text-destroy-30">
          {exportError}
        </div>
      )}
    </div>
  )
}

function centerObject(object: Group) {
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) {
    return 5
  }

  const center = new Vector3()
  const size = new Vector3()
  box.getCenter(center)
  box.getSize(size)
  object.position.sub(center)

  return Math.max(size.x, size.y, size.z, 1)
}

function fitCameraToRadius(
  camera: PerspectiveCamera,
  target: Vector3,
  radius: number,
  useDefaultDirection = false
) {
  const direction = useDefaultDirection
    ? new Vector3(1.15, -1.65, 1.05).normalize()
    : camera.position.clone().sub(target).normalize()
  if (direction.lengthSq() === 0) {
    direction.set(1.15, -1.65, 1.05).normalize()
  }

  camera.position.copy(target).add(direction.multiplyScalar(radius * 2.4))
  camera.near = Math.max(0.01, radius / 100)
  camera.far = radius * 40
  if (useDefaultDirection) {
    camera.up.set(0, 0, 1)
  } else if (
    Math.abs(direction.clone().normalize().dot(camera.up.clone().normalize())) >
    0.98
  ) {
    camera.up.set(0, 1, 0)
  }
  camera.lookAt(target)
  camera.updateProjectionMatrix()
}

function applyOpenCascadeCameraCommand(
  command: OpenCascadeCameraControlCommand,
  camera: PerspectiveCamera,
  target: Vector3,
  radius: number
) {
  if (command.type === 'zoom_to_fit') {
    fitCameraToRadius(camera, target, radius)
    return
  }
  if (command.type === 'view_isometric') {
    fitCameraToRadius(camera, target, radius, true)
    return
  }

  setCameraToAxis(command.axis, camera, target, radius)
}

function setCameraToAxis(
  axis: CameraAxisName,
  camera: PerspectiveCamera,
  target: Vector3,
  radius: number
) {
  const direction = axisToDirection(axis)
  const distance = Math.max(camera.position.distanceTo(target), radius * 2.4)
  camera.position.copy(target).add(direction.multiplyScalar(distance))
  camera.up.copy(
    axis === 'z' || axis === '-z' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
  )
  camera.lookAt(target)
  camera.updateProjectionMatrix()
}

function axisToDirection(axis: CameraAxisName) {
  switch (axis) {
    case 'x':
      return new Vector3(1, 0, 0)
    case '-x':
      return new Vector3(-1, 0, 0)
    case 'y':
      return new Vector3(0, 1, 0)
    case '-y':
      return new Vector3(0, -1, 0)
    case 'z':
      return new Vector3(0, 0, 1)
    case '-z':
      return new Vector3(0, 0, -1)
  }
}

function orbitCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  dx: number,
  dy: number
) {
  const offset = camera.position.clone().sub(target)
  const zUpToYUp = new Quaternion().setFromUnitVectors(
    camera.up,
    new Vector3(0, 1, 0)
  )
  const yUpToZUp = zUpToYUp.clone().invert()
  offset.applyQuaternion(zUpToYUp)

  const spherical = new Spherical().setFromVector3(offset)
  spherical.theta -= MathUtils.degToRad(dx * 0.3)
  spherical.phi -= MathUtils.degToRad(dy * 0.3)
  spherical.phi = MathUtils.clamp(spherical.phi, 0.05, Math.PI - 0.05)
  offset.setFromSpherical(spherical).applyQuaternion(yUpToZUp)

  camera.position.copy(target).add(offset)
  camera.lookAt(target)
}

function panCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  dx: number,
  dy: number
) {
  const distance = camera.position.distanceTo(target)
  const panScale = distance * 0.0015
  const forward = target.clone().sub(camera.position).normalize()
  const right = forward.clone().cross(camera.up).normalize()
  const up = camera.up.clone().normalize()
  const delta = right
    .multiplyScalar(-dx * panScale)
    .add(up.multiplyScalar(dy * panScale))

  camera.position.add(delta)
  target.add(delta)
}

function zoomCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  factor: number
) {
  const offset = camera.position.clone().sub(target)
  const nextDistance = MathUtils.clamp(
    offset.length() * Math.max(0.1, factor),
    0.2,
    10000
  )
  offset.setLength(nextDistance)
  camera.position.copy(target).add(offset)
}
