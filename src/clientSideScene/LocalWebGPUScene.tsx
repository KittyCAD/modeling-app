import type { KclExecutionDoneDetail } from '@src/lang/KclManager'
import { KclManagerEvents } from '@src/lang/KclManager'
import { useSingletons } from '@src/lib/boot'
import { EngineDebugger } from '@src/lib/debugger'
import type ModelingAppFile from '@src/lib/modelingAppFile'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import { useEffect, useRef } from 'react'
import {
  Box3,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  type Material,
  type Object3D,
  Vector2,
  Vector3,
} from 'three'

const WEBGPU_PORT_POC_STORAGE_KEY = 'webgpu-port-poc'
const WEBGPU_PORT_DEBUG_STORAGE_KEY = 'webgpu-port-debug'
const WEBGPU_PORT_LOG_PREFIX = '[WEBGPU_POC]'
const HOVER_COLOR = new Color('#5dd6ff')
const SELECTED_COLOR = new Color('#ff9d3f')

function shouldEnableLocalWebGpuPreview() {
  return localStorage.getItem(WEBGPU_PORT_POC_STORAGE_KEY) !== 'false'
}

function shouldDebugLocalWebGpuPreview() {
  return localStorage.getItem(WEBGPU_PORT_DEBUG_STORAGE_KEY) === 'true'
}

function logLocalWebGpuPreview(message: string, metadata?: unknown) {
  EngineDebugger.addLog({
    label: 'LocalWebGPUScene',
    message,
    metadata,
  })

  const shouldPrintToConsole =
    shouldDebugLocalWebGpuPreview() ||
    message === 'preview camera created' ||
    message === 'preview initialization failed' ||
    message === 'preview visibility changed' ||
    message === 'local hover changed' ||
    message === 'local selection changed' ||
    message === 'starting model refresh' ||
    message === 'export completed' ||
    message === 'gltf parsed and added to scene' ||
    message === 'gltf parse failed' ||
    message === 'received execution-done event'

  if (shouldPrintToConsole) {
    console.info(
      `${WEBGPU_PORT_LOG_PREFIX}[LocalWebGPUScene]`,
      message,
      metadata ?? ''
    )
  }
}

function pickBinaryGltf(files: ModelingAppFile[]) {
  return (
    files.find((file) => file.name.toLowerCase().endsWith('.glb')) ?? files[0]
  )
}

function disposeMaterial(material: Material) {
  for (const value of Object.values(material)) {
    if (
      value &&
      typeof value === 'object' &&
      'dispose' in value &&
      typeof (value as { dispose?: unknown }).dispose === 'function'
    ) {
      ;(value as { dispose: () => void }).dispose()
    }
  }

  material.dispose()
}

function disposeObject3D(root: Object3D) {
  root.traverse((object) => {
    if ('geometry' in object && object.geometry) {
      ;(object.geometry as { dispose: () => void }).dispose()
    }

    if ('material' in object && object.material) {
      const materials = (
        isArray(object.material) ? object.material : [object.material]
      ) as Material[]
      materials.forEach(disposeMaterial)
    }
  })
}

function prepareLoadedModelForPreview(root: Object3D) {
  let meshCount = 0
  let materialCount = 0
  const materialTypes = new Set<string>()

  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    object.frustumCulled = false

    if (!(object instanceof Mesh)) {
      return
    }

    meshCount += 1
    const materials = (
      isArray(object.material) ? object.material : [object.material]
    ) as Material[]
    const previewMaterials = materials.map((material) => {
      const color =
        'color' in material && material.color instanceof Color
          ? material.color.clone()
          : new Color('#d7dde8')
      const previewMaterial = new MeshBasicMaterial({
        color,
        side: DoubleSide,
      })
      previewMaterial.userData.previewBaseColor = color.getHex()
      materialCount += 1
      materialTypes.add(material.type)
      disposeMaterial(material)
      return previewMaterial
    })
    object.material = isArray(object.material)
      ? previewMaterials
      : previewMaterials[0]
  })

  return {
    meshCount,
    materialCount,
    materialTypes: Array.from(materialTypes.values()),
  }
}

function getPreviewMaterials(mesh: Mesh): MeshBasicMaterial[] {
  return (
    isArray(mesh.material) ? mesh.material : [mesh.material]
  ) as MeshBasicMaterial[]
}

type PreviewAssociation = {
  type?: string
  index?: number
  [key: string]: unknown
}

type GltfParserJson = {
  meshes?: Array<{
    extras?: unknown
    primitives?: Array<{
      extras?: unknown
    }>
  }>
  nodes?: Array<{
    extras?: unknown
    mesh?: number
    name?: string
  }>
}

type GltfParserState = {
  associations: Map<unknown, unknown> | null
  json: GltfParserJson | null
}

function summarizeAssociation(association: unknown) {
  if (!association || typeof association !== 'object') {
    return null
  }

  return Object.fromEntries(
    Object.entries(association as Record<string, unknown>).filter(
      ([, value]) =>
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    )
  )
}

function getNumericAssociationIndex(
  association: PreviewAssociation | null,
  key: 'meshes' | 'nodes' | 'primitives'
) {
  const value = association?.[key]
  return typeof value === 'number' ? value : null
}

function summarizeExtras(extras: unknown) {
  if (!extras || typeof extras !== 'object') {
    return null
  }

  return extras
}

function getPickedObjectMetadata(
  object: Object3D,
  parserState: GltfParserState | null
) {
  const association = summarizeAssociation(
    parserState?.associations?.get(object) ?? null
  )
  const meshIndex = getNumericAssociationIndex(association, 'meshes')
  const primitiveIndex = getNumericAssociationIndex(association, 'primitives')
  const primitiveExtras =
    meshIndex !== null && primitiveIndex !== null
      ? summarizeExtras(
          parserState?.json?.meshes?.[meshIndex]?.primitives?.[primitiveIndex]
            ?.extras ?? null
        )
      : null
  const meshExtras =
    meshIndex !== null
      ? summarizeExtras(parserState?.json?.meshes?.[meshIndex]?.extras ?? null)
      : null

  let nodeExtras: unknown = null
  let nodeIndex: number | null = null
  let current: Object3D | null = object
  while (current && nodeExtras === null) {
    const currentAssociation = summarizeAssociation(
      parserState?.associations?.get(current) ?? null
    )
    nodeIndex = getNumericAssociationIndex(currentAssociation, 'nodes')
    if (nodeIndex !== null) {
      nodeExtras = summarizeExtras(
        parserState?.json?.nodes?.[nodeIndex]?.extras
      )
    }
    current = current.parent
  }

  const kittycadPrimitiveExtras =
    primitiveExtras &&
    typeof primitiveExtras === 'object' &&
    'KITTYCAD' in primitiveExtras
      ? (primitiveExtras as Record<string, unknown>).KITTYCAD
      : null

  return {
    association,
    primitiveExtras,
    meshExtras,
    nodeExtras,
    nodeIndex,
    kittycadPrimitiveExtras,
  }
}

function setMeshHighlight(
  mesh: Mesh | null,
  mode: 'base' | 'hover' | 'selected'
) {
  if (!mesh) {
    return
  }

  for (const material of getPreviewMaterials(mesh)) {
    const baseColor = material.userData.previewBaseColor
    const nextColor =
      mode === 'selected'
        ? SELECTED_COLOR
        : mode === 'hover'
          ? HOVER_COLOR
          : (baseColor ?? '#d7dde8')
    material.color.set(nextColor)
    material.needsUpdate = true
  }
}

function summarizePickedObject(
  object: Object3D,
  parserState: GltfParserState | null
) {
  const parentChain: string[] = []
  const associationChain: Array<PreviewAssociation | null> = []
  let current: Object3D | null = object
  while (current && parentChain.length < 4) {
    parentChain.push(current.name || current.type)
    associationChain.push(
      summarizeAssociation(parserState?.associations?.get(current) ?? null)
    )
    current = current.parent
  }

  const metadata = getPickedObjectMetadata(object, parserState)
  const userDataEntries = Object.entries(object.userData ?? {}).filter(
    ([, value]) =>
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
  )

  return {
    type: object.type,
    name: object.name || null,
    parentChain,
    association: metadata.association,
    associationChain,
    primitiveExtras: metadata.primitiveExtras,
    meshExtras: metadata.meshExtras,
    nodeExtras: metadata.nodeExtras,
    nodeIndex: metadata.nodeIndex,
    kittycadPrimitiveExtras: metadata.kittycadPrimitiveExtras,
    userData: Object.fromEntries(userDataEntries),
    userDataKeys: Object.keys(object.userData ?? {}),
  }
}

export const LocalWebGPUScene = ({
  backgroundColor,
  onVisibilityChange,
}: {
  backgroundColor: string
  onVisibilityChange: (isVisible: boolean) => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const { kclManager } = useSingletons()

  useEffect(() => {
    if (!shouldEnableLocalWebGpuPreview()) {
      logLocalWebGpuPreview('preview disabled by localStorage flag')
      onVisibilityChange(false)
      return
    }

    const container = containerRef.current
    if (!container) {
      logLocalWebGpuPreview('preview container missing during mount')
      return
    }

    logLocalWebGpuPreview('mounting preview component')
    container.style.opacity = '0'

    let disposed = false
    let animationFrameId = -1
    let resizeObserver: ResizeObserver | null = null
    let currentModel: Object3D | null = null
    let currentRefreshId = 0
    let isVisible = false
    let pendingRefreshRequest = false
    let refreshModel: (() => Promise<void>) | null = null
    let previewCamera: PerspectiveCamera | OrthographicCamera | null = null
    let previewTarget = new Vector3()
    let hoveredMesh: Mesh | null = null
    let selectedMesh: Mesh | null = null
    let parserState: GltfParserState | null = null
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    let requestRender: (() => void) | null = null

    const setVisible = (nextVisible: boolean) => {
      if (isVisible === nextVisible) {
        return
      }

      isVisible = nextVisible
      container.style.opacity = nextVisible ? '1' : '0'
      logLocalWebGpuPreview('preview visibility changed', {
        isVisible: nextVisible,
      })
      onVisibilityChange(nextVisible)
      requestRender?.()
    }

    const fitCameraToLoadedModel = (root: Object3D) => {
      const bounds = new Box3().setFromObject(root)
      if (bounds.isEmpty()) {
        return
      }

      const center = bounds.getCenter(new Vector3())
      const size = bounds.getSize(new Vector3())
      const maxDimension = Math.max(size.x, size.y, size.z, 0.001)

      const camera = previewCamera
      const target = previewTarget
      if (!camera) {
        return
      }
      const viewDirection = camera.position.clone().sub(target)
      if (viewDirection.lengthSq() < 1e-6) {
        viewDirection.set(1, -1, 1)
      }
      viewDirection.normalize()

      if (camera instanceof PerspectiveCamera) {
        const verticalFov = (camera.fov * Math.PI) / 180
        const horizontalFov =
          2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
        const distanceForHeight = maxDimension / (2 * Math.tan(verticalFov / 2))
        const distanceForWidth =
          maxDimension / (2 * Math.tan(horizontalFov / 2))
        const distance = Math.max(distanceForHeight, distanceForWidth) * 1.4

        target.copy(center)
        camera.position.copy(center).add(viewDirection.multiplyScalar(distance))
        camera.near = Math.max(distance / 100, 0.01)
        camera.far = Math.max(distance * 100, maxDimension * 100)
        camera.lookAt(center)
        camera.updateProjectionMatrix()
      } else if (camera instanceof OrthographicCamera) {
        const aspect =
          Math.max(container.clientWidth, 1) /
          Math.max(container.clientHeight, 1)
        const halfHeight = maxDimension * 0.75
        const halfWidth = halfHeight * aspect
        const distance = maxDimension * 2

        target.copy(center)
        camera.position.copy(center).add(viewDirection.multiplyScalar(distance))
        camera.left = -halfWidth
        camera.right = halfWidth
        camera.top = halfHeight
        camera.bottom = -halfHeight
        camera.zoom = 1
        camera.near = Math.max(distance / 100, 0.01)
        camera.far = Math.max(distance * 100, maxDimension * 100)
        camera.lookAt(center)
        camera.updateProjectionMatrix()
      }

      camera.updateMatrixWorld(true)
      logLocalWebGpuPreview('camera fit applied to loaded model', {
        cameraPosition: camera.position.toArray(),
        cameraType: camera.type,
        target: target.toArray(),
        zoom: 'zoom' in camera ? camera.zoom : undefined,
      })
      requestRender?.()
    }

    const requestRefresh = () => {
      if (refreshModel) {
        void refreshModel()
        return
      }

      pendingRefreshRequest = true
      logLocalWebGpuPreview('refresh requested before renderer initialization')
    }

    const onExecutionDone = (event: Event) => {
      const { detail } = event as CustomEvent<KclExecutionDoneDetail>
      logLocalWebGpuPreview('received execution-done event', detail)
      if (!detail.successful) {
        return
      }

      requestRefresh()
    }

    const applyMeshState = (mesh: Mesh | null) => {
      if (!mesh) {
        return
      }

      const mode =
        mesh === selectedMesh
          ? 'selected'
          : mesh === hoveredMesh
            ? 'hover'
            : 'base'
      setMeshHighlight(mesh, mode)
      requestRender?.()
    }

    const clearHover = () => {
      if (!hoveredMesh) {
        return
      }

      const previousHoveredMesh = hoveredMesh
      hoveredMesh = null
      applyMeshState(previousHoveredMesh)
    }

    const pickMeshFromPointerEvent = (event: PointerEvent) => {
      if (!isVisible || !previewCamera || !currentModel) {
        return null
      }

      const interactionElement = container.parentElement
      if (!interactionElement) {
        return null
      }

      const rect = interactionElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        return null
      }

      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, previewCamera)

      return raycaster
        .intersectObject(currentModel, true)
        .find((intersection) => intersection.object instanceof Mesh)
    }

    const updateHoverFromPointer = (event: PointerEvent) => {
      const firstMeshHit = pickMeshFromPointerEvent(event)
      if (!firstMeshHit) {
        clearHover()
        return
      }

      const nextHoveredMesh = (firstMeshHit?.object as Mesh | undefined) ?? null
      if (nextHoveredMesh === hoveredMesh) {
        return
      }

      const previousHoveredMesh = hoveredMesh
      hoveredMesh = null
      applyMeshState(previousHoveredMesh)
      if (!nextHoveredMesh) {
        return
      }

      hoveredMesh = nextHoveredMesh
      applyMeshState(hoveredMesh)
      logLocalWebGpuPreview('local hover changed', {
        distance: firstMeshHit?.distance,
        point: firstMeshHit?.point?.toArray(),
        ...summarizePickedObject(nextHoveredMesh, parserState),
      })
    }

    const updateSelectionFromPointer = (event: PointerEvent) => {
      const firstMeshHit = pickMeshFromPointerEvent(event)
      const nextSelectedMesh =
        (firstMeshHit?.object as Mesh | undefined) ?? null
      if (nextSelectedMesh === selectedMesh) {
        return
      }

      const previousSelectedMesh = selectedMesh
      selectedMesh = nextSelectedMesh
      applyMeshState(previousSelectedMesh)
      applyMeshState(hoveredMesh)
      applyMeshState(selectedMesh)

      const selectionSummary = nextSelectedMesh
        ? {
            distance: firstMeshHit?.distance,
            point: firstMeshHit?.point?.toArray(),
            ...summarizePickedObject(nextSelectedMesh, parserState),
          }
        : null
      ;(
        window as typeof window & { __WEBGPU_POC_SELECTION__?: unknown }
      ).__WEBGPU_POC_SELECTION__ = selectionSummary

      logLocalWebGpuPreview('local selection changed', {
        selection: selectionSummary,
      })
    }

    kclManager.addEventListener(KclManagerEvents.ExecutionDone, onExecutionDone)

    const initialize = async () => {
      logLocalWebGpuPreview('initializing preview renderer')
      const [{ default: WebGPURenderer }, { GLTFLoader }] = await Promise.all([
        import('three/src/renderers/webgpu/WebGPURenderer.js'),
        import('three/examples/jsm/loaders/GLTFLoader.js'),
      ])

      if (disposed) {
        logLocalWebGpuPreview(
          'preview disposed before initialization completed'
        )
        return
      }

      const hasNavigatorGpu =
        typeof navigator !== 'undefined' && !!navigator.gpu
      logLocalWebGpuPreview('navigator.gpu availability checked', {
        isSecureContext: window.isSecureContext,
        hasNavigatorGpu,
      })
      if (!hasNavigatorGpu) {
        setVisible(false)
        return
      }

      const adapter = await navigator.gpu.requestAdapter()
      logLocalWebGpuPreview('default adapter request completed', {
        adapterFound: Boolean(adapter),
        adapterInfo: adapter?.info
          ? {
              vendor: adapter.info.vendor,
              architecture: adapter.info.architecture,
              description: adapter.info.description,
            }
          : null,
      })
      if (!adapter) {
        const [highPerformanceAdapter, lowPowerAdapter] = await Promise.all([
          navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }),
          navigator.gpu.requestAdapter({ powerPreference: 'low-power' }),
        ])
        logLocalWebGpuPreview('fallback adapter requests completed', {
          highPerformanceAdapterFound: Boolean(highPerformanceAdapter),
          lowPowerAdapterFound: Boolean(lowPowerAdapter),
        })
        setVisible(false)
        return
      }

      let device: GPUDevice
      try {
        device = await adapter.requestDevice()
      } catch (error) {
        logLocalWebGpuPreview('device request failed', {
          error,
          adapterInfo: adapter.info
            ? {
                vendor: adapter.info.vendor,
                architecture: adapter.info.architecture,
                description: adapter.info.description,
              }
            : null,
          adapterFeatures: Array.from(adapter.features.values()),
        })
        reportRejection(error)
        setVisible(false)
        return
      }
      logLocalWebGpuPreview('device request completed', {
        label: device.label,
      })

      logLocalWebGpuPreview('creating WebGPU renderer')
      const renderer = new WebGPURenderer({
        antialias: true,
        alpha: false,
        device,
      })
      logLocalWebGpuPreview('renderer created')
      logLocalWebGpuPreview('initializing renderer backend')
      await renderer.init()
      if (disposed) {
        logLocalWebGpuPreview(
          'preview disposed before renderer backend initialization completed'
        )
        renderer.dispose()
        return
      }
      logLocalWebGpuPreview('renderer backend initialized')
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.domElement.className =
        'absolute inset-0 z-20 h-full w-full pointer-events-none'
      container.appendChild(renderer.domElement)
      logLocalWebGpuPreview('renderer attached to DOM', {
        width: container.clientWidth,
        height: container.clientHeight,
      })

      const scene = new Scene()
      scene.background = new Color(backgroundColor)

      const sharedCamera = kclManager.sceneInfra.camControls.camera
      const sharedTarget = kclManager.sceneInfra.camControls.target
      if (sharedCamera instanceof PerspectiveCamera) {
        previewCamera = sharedCamera.clone()
        previewCamera.aspect =
          Math.max(container.clientWidth, 1) /
          Math.max(container.clientHeight, 1)
      } else if (sharedCamera instanceof OrthographicCamera) {
        previewCamera = sharedCamera.clone()
      } else {
        previewCamera = new PerspectiveCamera(45, 1, 0.01, 1000)
      }
      previewCamera.layers.mask = sharedCamera.layers.mask
      previewTarget.copy(sharedTarget)
      logLocalWebGpuPreview('preview camera created', {
        cameraType: previewCamera.type,
        cameraPosition: previewCamera.position.toArray(),
        target: previewTarget.toArray(),
        layerMask: previewCamera.layers.mask,
      })
      const loader = new GLTFLoader()

      requestRender = () => {
        if (disposed || !previewCamera || animationFrameId !== -1) {
          return
        }

        animationFrameId = requestAnimationFrame(() => {
          animationFrameId = -1
          if (disposed || !previewCamera) {
            return
          }

          renderer.render(scene, previewCamera)
        })
      }

      const resize = () => {
        const width = container.clientWidth
        const height = container.clientHeight
        if (width === 0 || height === 0) {
          return
        }
        renderer.setSize(width, height, false)
        if (previewCamera instanceof PerspectiveCamera) {
          previewCamera.aspect = width / height
          previewCamera.updateProjectionMatrix()
        }
        requestRender?.()
      }

      const interactionElement = container.parentElement
      if (interactionElement) {
        interactionElement.addEventListener(
          'pointermove',
          updateHoverFromPointer
        )
        interactionElement.addEventListener('pointerleave', clearHover)
        interactionElement.addEventListener('click', updateSelectionFromPointer)
      }

      resize()
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(container)

      const clearModel = () => {
        if (!currentModel) {
          return
        }

        scene.remove(currentModel)
        disposeObject3D(currentModel)
        currentModel = null
        requestRender?.()
      }
      requestRender()
      logLocalWebGpuPreview('render mode set to on-demand')

      refreshModel = async () => {
        const refreshId = ++currentRefreshId
        logLocalWebGpuPreview('starting model refresh', {
          refreshId,
          hasLastSuccessfulCode: Boolean(kclManager.lastSuccessfulCode),
        })
        const files = await kclManager.rustContext.export(
          {
            type: 'gltf',
            storage: 'binary',
            presentation: 'compact',
          },
          jsAppSettings(kclManager.rustContext.settingsActor)
        )

        if (disposed || refreshId !== currentRefreshId) {
          logLocalWebGpuPreview('dropping stale refresh result', {
            disposed,
            refreshId,
            currentRefreshId,
          })
          return
        }

        const file = files?.length ? pickBinaryGltf(files) : null
        logLocalWebGpuPreview('export completed', {
          refreshId,
          fileCount: files?.length ?? 0,
          selectedFile: file?.name ?? null,
        })
        if (!file) {
          clearModel()
          setVisible(false)
          return
        }

        const bytes = Uint8Array.from(file.contents)
        const glb = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        )

        loader.parse(
          glb,
          '',
          (gltf) => {
            if (disposed || refreshId !== currentRefreshId) {
              logLocalWebGpuPreview('dropping stale parsed gltf', {
                disposed,
                refreshId,
                currentRefreshId,
              })
              return
            }

            clearModel()
            currentModel = gltf.scene
            const gltfWithParser = gltf as {
              parser?: {
                associations?: Map<unknown, unknown>
                json?: GltfParserJson
              }
            }
            parserState = {
              associations: gltfWithParser.parser?.associations ?? null,
              json: gltfWithParser.parser?.json ?? null,
            }
            currentModel.traverse((object) => {
              object.layers.mask =
                previewCamera?.layers.mask ?? object.layers.mask

              if (!(object instanceof Mesh)) {
                return
              }

              const metadata = getPickedObjectMetadata(object, parserState)
              if (metadata.primitiveExtras) {
                object.userData.gltfPrimitiveExtras = metadata.primitiveExtras
              }
              if (metadata.kittycadPrimitiveExtras) {
                object.userData.kittycadPrimitiveExtras =
                  metadata.kittycadPrimitiveExtras
              }
            })
            scene.add(currentModel)
            const loadedModelStats = prepareLoadedModelForPreview(currentModel)
            if (loadedModelStats.meshCount === 0) {
              clearModel()
              setVisible(false)
              return
            }
            fitCameraToLoadedModel(currentModel)
            logLocalWebGpuPreview('gltf parsed and added to scene', {
              refreshId,
              childCount: currentModel.children.length,
              meshCount: loadedModelStats.meshCount,
              hasParserJson: Boolean(parserState?.json),
            })
            setVisible(true)
            requestRender?.()
          },
          (error) => {
            console.warn('Failed to load local WebGPU preview model', error)
            logLocalWebGpuPreview('gltf parse failed', {
              refreshId,
              error,
            })
            if (disposed || refreshId !== currentRefreshId) {
              return
            }

            clearModel()
            setVisible(false)
          }
        )
      }

      if (kclManager.lastSuccessfulCode) {
        await refreshModel()
      } else if (pendingRefreshRequest) {
        pendingRefreshRequest = false
        await refreshModel()
      }

      return () => {
        logLocalWebGpuPreview('cleaning up preview renderer')
        kclManager.removeEventListener(
          KclManagerEvents.ExecutionDone,
          onExecutionDone
        )
        if (interactionElement) {
          interactionElement.removeEventListener(
            'pointermove',
            updateHoverFromPointer
          )
          interactionElement.removeEventListener('pointerleave', clearHover)
          interactionElement.removeEventListener(
            'click',
            updateSelectionFromPointer
          )
        }
        clearHover()
        const previousSelectedMesh = selectedMesh
        selectedMesh = null
        applyMeshState(previousSelectedMesh)
        clearModel()
        resizeObserver?.disconnect()
        if (animationFrameId !== -1) {
          cancelAnimationFrame(animationFrameId)
        }
        requestRender = null
        renderer.dispose()
      }
    }

    let cleanup: (() => void) | undefined

    void initialize()
      .then((returnedCleanup) => {
        cleanup = returnedCleanup
      })
      .catch((error) => {
        logLocalWebGpuPreview('preview initialization failed', { error })
        console.error('[LocalWebGPUScene] preview initialization failed', error)
        reportRejection(error)
      })

    return () => {
      disposed = true
      logLocalWebGpuPreview('effect cleanup')
      setVisible(false)
      refreshModel = null
      cleanup?.()
    }
  }, [backgroundColor, kclManager, onVisibilityChange])

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-20 h-full w-full transition-opacity duration-200 opacity-0"
    />
  )
}
