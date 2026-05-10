import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
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
import {
  darkModeMatcher,
  getOppositeTheme,
  getResolvedTheme,
  getThemeColorForThreeJs,
  Themes,
} from '@src/lib/theme'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'
import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import { isArray } from '@src/lib/utils'

const DEFAULT_PERSPECTIVE_FOV = 38
const ORTHOGRAPHIC_CAMERA_SIZE = 20
const OPEN_CASCADE_EDGE_LINES_NAME = 'open-cascade-edge-lines'

type OpenCascadeCamera = PerspectiveCamera | OrthographicCamera
type ResolvedTheme = Exclude<Themes, Themes.System>

interface OpenCascadeSceneStyle {
  backgroundColor: number
  edgeColor: number
  surfaceColor: string
}

export function OpenCascadeThreeScene({ diagnostic }: { diagnostic?: string }) {
  useSignals()
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const settingsValues = settings.useSettings()
  const appTheme = settingsValues.app.theme.current
  const mouseControls = settingsValues.modeling.mouseControls.current
  const cameraProjection = settingsValues.modeling.cameraProjection.current
  const highlightEdges = settingsValues.modeling.highlightEdges.current
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    getResolvedTheme(appTheme)
  )
  const sceneStyle = useMemo(
    () => getOpenCascadeSceneStyle(resolvedTheme),
    [resolvedTheme]
  )
  const initialCameraProjectionRef = useRef(cameraProjection)
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | undefined>(undefined)
  const cameraRef = useRef<OpenCascadeCamera | undefined>(undefined)
  const rendererRef = useRef<WebGLRenderer | undefined>(undefined)
  const modelRootRef = useRef<Group | undefined>(undefined)
  const targetRef = useRef(new Vector3())
  const modelRadiusRef = useRef(5)
  const hasFramedModelRef = useRef(false)
  const syncingToSceneInfraRef = useRef(false)
  const sceneStyleRef = useRef(sceneStyle)
  const highlightEdgesRef = useRef(highlightEdges)
  const [ready, setReady] = useState(false)
  const [stage, setStage] = useState('waiting')
  const engineCommandManager =
    kclManager.engineCommandManager as EngineCommandManagerProxy
  const latestShapeVersion =
    engineCommandManager.openCascadeCommandManager.latestShapeVersion.value
  const exportError =
    diagnostic ||
    engineCommandManager.openCascadeCommandManager.latestExportError.value
  sceneStyleRef.current = sceneStyle
  highlightEdgesRef.current = highlightEdges
  const publishOpenCascadeCamera = useCallback(() => {
    const camera = cameraRef.current
    if (!camera) {
      return
    }

    try {
      syncingToSceneInfraRef.current = true
      syncSceneInfraCameraFromOpenCascade(
        kclManager.sceneInfra,
        camera,
        targetRef.current
      )
    } finally {
      syncingToSceneInfraRef.current = false
    }
  }, [kclManager.sceneInfra])

  useEffect(() => {
    const syncResolvedTheme = () => {
      setResolvedTheme(getResolvedTheme(appTheme))
    }
    syncResolvedTheme()

    if (appTheme !== Themes.System) {
      return
    }

    darkModeMatcher?.addEventListener('change', syncResolvedTheme)
    return () => {
      darkModeMatcher?.removeEventListener('change', syncResolvedTheme)
    }
  }, [appTheme])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const scene = new Scene()
    applyOpenCascadeSceneStyle(
      scene,
      undefined,
      sceneStyleRef.current,
      highlightEdgesRef.current
    )
    const camera = createOpenCascadeCamera(
      initialCameraProjectionRef.current,
      1
    )
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

    const render = () => {
      const activeCamera = cameraRef.current
      if (activeCamera) {
        renderer.render(scene, activeCamera)
      }
    }
    const resize = () => {
      const activeCamera = cameraRef.current
      if (!activeCamera) {
        return
      }

      const width = Math.max(1, container.clientWidth)
      const height = Math.max(1, container.clientHeight)
      resizeOpenCascadeCamera(activeCamera, width / height)
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
  }, [kclManager.sceneInfra])

  useEffect(() => {
    const scene = sceneRef.current
    const renderer = rendererRef.current
    const camera = cameraRef.current
    if (!scene || !renderer || !camera) {
      return
    }

    applyOpenCascadeSceneStyle(
      scene,
      modelRootRef.current,
      sceneStyle,
      highlightEdges
    )
    renderer.render(scene, camera)
  }, [highlightEdges, sceneStyle])

  useEffect(() => {
    const container = containerRef.current
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const previousCamera = cameraRef.current
    if (!container || !renderer || !scene || !previousCamera) {
      return
    }
    if (cameraProjectionMatches(previousCamera, cameraProjection)) {
      return
    }

    const nextCamera = createOpenCascadeCamera(
      cameraProjection,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight)
    )
    copyCameraViewForProjectionChange(
      previousCamera,
      nextCamera,
      targetRef.current
    )
    cameraRef.current = nextCamera
    renderer.render(scene, nextCamera)
    publishOpenCascadeCamera()
  }, [cameraProjection, publishOpenCascadeCamera])

  useEffect(() => {
    const onCameraChange = () => {
      if (syncingToSceneInfraRef.current) {
        return
      }

      const renderer = rendererRef.current
      const scene = sceneRef.current
      const camera = cameraRef.current
      if (!renderer || !scene || !camera) {
        return
      }

      syncOpenCascadeCameraFromSceneInfra(
        camera,
        targetRef.current,
        kclManager.sceneInfra
      )
      renderer.render(scene, camera)
    }

    kclManager.sceneInfra.camControls.cameraChange.add(onCameraChange)
    return () => {
      kclManager.sceneInfra.camControls.cameraChange.remove(onCameraChange)
    }
  }, [kclManager.sceneInfra])

  useEffect(() => {
    const renderer = rendererRef.current
    const scene = sceneRef.current
    if (!renderer || !scene) {
      return
    }

    const guards = cameraMouseDragGuards[mouseControls]
    const element = renderer.domElement
    const lastPointer = new Vector2()
    let interaction: 'pan' | 'rotate' | 'zoom' | undefined
    const render = () => {
      const activeCamera = cameraRef.current
      if (activeCamera) {
        renderer.render(scene, activeCamera)
      }
    }
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
      const activeCamera = cameraRef.current
      if (!activeCamera) {
        return
      }

      if (interaction === 'pan') {
        panCamera(activeCamera, targetRef.current, dx, dy)
      } else if (interaction === 'zoom') {
        zoomCamera(activeCamera, targetRef.current, 1 + dy * 0.01)
      } else {
        orbitCamera(activeCamera, targetRef.current, dx, dy)
      }
      render()
      publishOpenCascadeCamera()
    }
    const onWheel = (event: WheelEvent) => {
      if (!guards.zoom.scrollCallback(event)) {
        return
      }

      event.preventDefault()
      const activeCamera = cameraRef.current
      if (!activeCamera) {
        return
      }
      zoomCamera(activeCamera, targetRef.current, event.deltaY > 0 ? 1.1 : 0.9)
      render()
      publishOpenCascadeCamera()
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
  }, [mouseControls, publishOpenCascadeCamera])

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
      publishOpenCascadeCamera()
    })
  }, [publishOpenCascadeCamera])

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
      disposeOpenCascadeModelRoot(modelRoot)
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

      disposeOpenCascadeModelRoot(modelRoot)
      const meshes: Mesh[] = []
      gltf.scene.traverse((object) => {
        if (object instanceof Mesh) {
          meshes.push(object)
        }
      })
      meshes.forEach((mesh) => {
        styleOpenCascadeMesh(
          mesh,
          sceneStyleRef.current,
          highlightEdgesRef.current
        )
      })
      modelRoot.add(gltf.scene)
      const radius = centerObject(gltf.scene)
      modelRadiusRef.current = radius
      if (!hasFramedModelRef.current) {
        fitCameraToRadius(camera, targetRef.current, radius, true)
        hasFramedModelRef.current = true
      } else {
        updateCameraClipping(camera, targetRef.current, radius)
      }
      renderer.render(scene, camera)
      publishOpenCascadeCamera()
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
  }, [engineCommandManager, latestShapeVersion, publishOpenCascadeCamera])

  return (
    <div
      ref={containerRef}
      data-testid="open-cascade-scene"
      data-stage={stage}
      className="absolute inset-0 h-full w-full overflow-hidden"
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

function getOpenCascadeSceneStyle(
  resolvedTheme: ResolvedTheme
): OpenCascadeSceneStyle {
  return {
    backgroundColor: getThemeColorForThreeJs(resolvedTheme),
    edgeColor: getThemeColorForThreeJs(getOppositeTheme(resolvedTheme)),
    surfaceColor: resolvedTheme === Themes.Dark ? '#6f87ad' : '#8ea6c9',
  }
}

function applyOpenCascadeSceneStyle(
  scene: Scene,
  modelRoot: Group | undefined,
  style: OpenCascadeSceneStyle,
  highlightEdges: boolean
) {
  scene.background = new Color(style.backgroundColor)

  if (!modelRoot) {
    return
  }

  modelRoot.traverse((object) => {
    if (object instanceof Mesh) {
      updateOpenCascadeMeshMaterial(object, style)
      return
    }

    if (
      object instanceof LineSegments &&
      object.userData.openCascadeEdgeLines === true
    ) {
      object.visible = highlightEdges
      if (object.material instanceof LineBasicMaterial) {
        object.material.color.set(style.edgeColor)
      }
    }
  })
}

function styleOpenCascadeMesh(
  mesh: Mesh,
  style: OpenCascadeSceneStyle,
  highlightEdges: boolean
) {
  updateOpenCascadeMeshMaterial(mesh, style)
  mesh.castShadow = false
  mesh.receiveShadow = false

  const edgeGeometry = new EdgesGeometry(mesh.geometry, 30)
  const edgeMaterial = new LineBasicMaterial({ color: style.edgeColor })
  const edgeLines = new LineSegments(edgeGeometry, edgeMaterial)
  edgeLines.name = OPEN_CASCADE_EDGE_LINES_NAME
  edgeLines.userData.openCascadeEdgeLines = true
  edgeLines.visible = highlightEdges
  mesh.add(edgeLines)
}

function updateOpenCascadeMeshMaterial(
  mesh: Mesh,
  style: OpenCascadeSceneStyle
) {
  disposeMaterial(mesh.material)
  mesh.material = new MeshStandardMaterial({
    color: style.surfaceColor,
    roughness: 0.58,
    metalness: 0.04,
  })
}

function disposeOpenCascadeModelRoot(modelRoot: Group) {
  modelRoot.traverse((object) => {
    if (object instanceof Mesh) {
      disposeMaterial(object.material)
      return
    }

    if (
      object instanceof LineSegments &&
      object.userData.openCascadeEdgeLines === true
    ) {
      object.geometry.dispose()
      disposeMaterial(object.material)
    }
  })
  modelRoot.clear()
}

function disposeMaterial(material: Mesh['material']) {
  if (isArray(material)) {
    material.forEach((entry) => entry.dispose())
    return
  }

  material.dispose()
}

function syncSceneInfraCameraFromOpenCascade(
  sceneInfra: SceneInfra,
  openCascadeCamera: OpenCascadeCamera,
  openCascadeTarget: Vector3
) {
  const camControls = sceneInfra.camControls
  const controlsCamera = camControls.camera
  controlsCamera.position.copy(openCascadeCamera.position)
  controlsCamera.quaternion.copy(openCascadeCamera.quaternion)
  controlsCamera.up.copy(openCascadeCamera.up)
  controlsCamera.near = openCascadeCamera.near
  controlsCamera.far = openCascadeCamera.far
  if (controlsCamera instanceof PerspectiveCamera) {
    if (openCascadeCamera instanceof PerspectiveCamera) {
      controlsCamera.fov = openCascadeCamera.fov
      controlsCamera.aspect = openCascadeCamera.aspect
    }
  } else if (openCascadeCamera instanceof OrthographicCamera) {
    controlsCamera.left = openCascadeCamera.left
    controlsCamera.right = openCascadeCamera.right
    controlsCamera.top = openCascadeCamera.top
    controlsCamera.bottom = openCascadeCamera.bottom
    controlsCamera.zoom = openCascadeCamera.zoom
  }
  controlsCamera.updateProjectionMatrix()
  controlsCamera.updateMatrixWorld()
  camControls.target.copy(openCascadeTarget)
  camControls.onCameraChange()
}

function syncOpenCascadeCameraFromSceneInfra(
  openCascadeCamera: OpenCascadeCamera,
  openCascadeTarget: Vector3,
  sceneInfra: SceneInfra
) {
  const camControls = sceneInfra.camControls
  const controlsCamera = camControls.camera
  openCascadeCamera.position.copy(controlsCamera.position)
  openCascadeCamera.quaternion.copy(controlsCamera.quaternion)
  openCascadeCamera.up.copy(controlsCamera.up)
  openCascadeCamera.near = controlsCamera.near
  openCascadeCamera.far = controlsCamera.far
  if (controlsCamera instanceof PerspectiveCamera) {
    if (openCascadeCamera instanceof PerspectiveCamera) {
      openCascadeCamera.fov = controlsCamera.fov
    }
  } else if (openCascadeCamera instanceof OrthographicCamera) {
    openCascadeCamera.zoom = controlsCamera.zoom
  }
  openCascadeCamera.updateProjectionMatrix()
  openCascadeCamera.updateMatrixWorld()
  openCascadeTarget.copy(camControls.target)
}

function createOpenCascadeCamera(
  projection: CameraProjectionType,
  aspect: number
): OpenCascadeCamera {
  if (projection === 'orthographic') {
    const camera = new OrthographicCamera()
    camera.up.set(0, 0, 1)
    resizeOpenCascadeCamera(camera, aspect)
    return camera
  }

  const camera = new PerspectiveCamera(
    DEFAULT_PERSPECTIVE_FOV,
    aspect,
    0.01,
    1000
  )
  camera.up.set(0, 0, 1)
  return camera
}

function resizeOpenCascadeCamera(camera: OpenCascadeCamera, aspect: number) {
  if (camera instanceof PerspectiveCamera) {
    camera.aspect = aspect
  } else {
    camera.left = -ORTHOGRAPHIC_CAMERA_SIZE * aspect
    camera.right = ORTHOGRAPHIC_CAMERA_SIZE * aspect
    camera.top = ORTHOGRAPHIC_CAMERA_SIZE
    camera.bottom = -ORTHOGRAPHIC_CAMERA_SIZE
  }
  camera.updateProjectionMatrix()
}

function cameraProjectionMatches(
  camera: OpenCascadeCamera,
  projection: CameraProjectionType
) {
  return (
    (projection === 'perspective' && camera instanceof PerspectiveCamera) ||
    (projection === 'orthographic' && camera instanceof OrthographicCamera)
  )
}

function copyCameraViewForProjectionChange(
  previousCamera: OpenCascadeCamera,
  nextCamera: OpenCascadeCamera,
  target: Vector3
) {
  nextCamera.position.copy(previousCamera.position)
  nextCamera.quaternion.copy(previousCamera.quaternion)
  nextCamera.up.copy(previousCamera.up)
  nextCamera.near = previousCamera.near
  nextCamera.far = previousCamera.far

  const distance = Math.max(previousCamera.position.distanceTo(target), 0.01)
  const direction = previousCamera.position.clone().sub(target).normalize()
  if (direction.lengthSq() === 0) {
    direction.set(1.15, -1.65, 1.05).normalize()
  }

  if (
    previousCamera instanceof PerspectiveCamera &&
    nextCamera instanceof OrthographicCamera
  ) {
    const visibleHeight =
      2 * distance * Math.tan(MathUtils.degToRad(previousCamera.fov / 2))
    nextCamera.zoom = Math.max(
      0.01,
      (ORTHOGRAPHIC_CAMERA_SIZE * 2) / visibleHeight
    )
  } else if (
    previousCamera instanceof OrthographicCamera &&
    nextCamera instanceof PerspectiveCamera
  ) {
    const visibleHeight = (ORTHOGRAPHIC_CAMERA_SIZE * 2) / previousCamera.zoom
    const nextDistance =
      visibleHeight / (2 * Math.tan(MathUtils.degToRad(nextCamera.fov / 2)))
    nextCamera.position.copy(target).add(direction.multiplyScalar(nextDistance))
  }

  nextCamera.updateProjectionMatrix()
  nextCamera.updateMatrixWorld()
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
  camera: OpenCascadeCamera,
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
  updateCameraClipping(camera, target, radius)
  if (camera instanceof OrthographicCamera) {
    camera.zoom = orthographicZoomToFit(camera, radius)
  }
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

function updateCameraClipping(
  camera: OpenCascadeCamera,
  target: Vector3,
  radius: number
) {
  const distance = camera.position.distanceTo(target)
  camera.near = Math.max(0.01, Math.min(radius / 100, distance / 100))
  camera.far = Math.max(radius * 40, distance + radius * 4, 1000)
  camera.updateProjectionMatrix()
}

function orthographicZoomToFit(camera: OrthographicCamera, radius: number) {
  const paddedSize = Math.max(radius * 1.35, 0.01)
  const viewWidth = Math.abs(camera.right - camera.left)
  const viewHeight = Math.abs(camera.top - camera.bottom)
  return Math.max(0.01, Math.min(viewWidth, viewHeight) / paddedSize)
}

function applyOpenCascadeCameraCommand(
  command: OpenCascadeCameraControlCommand,
  camera: OpenCascadeCamera,
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
  camera: OpenCascadeCamera,
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
  camera: OpenCascadeCamera,
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
  camera: OpenCascadeCamera,
  target: Vector3,
  dx: number,
  dy: number
) {
  const distance = camera.position.distanceTo(target)
  const panScale =
    camera instanceof OrthographicCamera
      ? (ORTHOGRAPHIC_CAMERA_SIZE / camera.zoom) * 0.0025
      : distance * 0.0015
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
  camera: OpenCascadeCamera,
  target: Vector3,
  factor: number
) {
  if (camera instanceof OrthographicCamera) {
    camera.zoom = MathUtils.clamp(
      camera.zoom / Math.max(0.1, factor),
      0.01,
      10000
    )
    camera.updateProjectionMatrix()
    return
  }

  const offset = camera.position.clone().sub(target)
  const nextDistance = MathUtils.clamp(
    offset.length() * Math.max(0.1, factor),
    0.2,
    10000
  )
  offset.setLength(nextDistance)
  camera.position.copy(target).add(offset)
}
