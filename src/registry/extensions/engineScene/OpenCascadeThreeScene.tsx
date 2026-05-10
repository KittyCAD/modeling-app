import { useEffect, useRef, useState } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { useSingletons } from '@src/lib/boot'
import type { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'

export function OpenCascadeThreeScene({
  diagnostic,
}: {
  diagnostic?: string
}) {
  useSignals()
  const { kclManager } = useSingletons()
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | undefined>(undefined)
  const cameraRef = useRef<PerspectiveCamera | undefined>(undefined)
  const rendererRef = useRef<WebGLRenderer | undefined>(undefined)
  const modelRootRef = useRef<Group | undefined>(undefined)
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
    camera.lookAt(0, 0, 0)

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
    renderer.domElement.className = 'block h-full w-full'
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
      frameObject(gltf.scene, camera)
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

function frameObject(object: Group, camera: PerspectiveCamera) {
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) {
    camera.position.set(6, -8, 6)
    camera.lookAt(0, 0, 0)
    return
  }

  const center = new Vector3()
  const size = new Vector3()
  box.getCenter(center)
  box.getSize(size)
  object.position.sub(center)

  const radius = Math.max(size.x, size.y, size.z, 1)
  camera.position.set(radius * 1.15, -radius * 1.65, radius * 1.05)
  camera.near = Math.max(0.01, radius / 100)
  camera.far = radius * 30
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
}
