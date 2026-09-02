import type { GetSketchModePlane } from '@kittycad/lib'
import { LOCAL_WEBGPU_RENDERING_ENABLED } from '@src/clientSideScene/localRenderer/config'
import type { EdgeRenderer } from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { EnvMapLoader } from '@src/clientSideScene/localRenderer/EnvMapLoader'
import { HDR_ENV_MAP_URL } from '@src/clientSideScene/localRenderer/maps'
import {
  decodeRenderPacket,
  type LocalRenderPacket,
  type LocalRenderPacketEdge,
  type LocalRenderPacketPrimitive,
  type LocalRenderPacketRegion,
  type LocalRenderPacketSketchSegment,
} from '@src/clientSideScene/localRenderer/renderPacketBinary'
import { registerLocalSelectionCommandProvider } from '@src/clientSideScene/localSelectionCommandProxy'
import type {
  createWebGpuSurfaceResources,
  WebGpuSurfaceResources,
} from '@src/clientSideScene/webgpuTrim'
import type { KclExecutionDoneDetail, KclManager } from '@src/lang/KclManager'
import { KclManagerEvents } from '@src/lang/KclManager'
import type { ArtifactGraph, PathToNode, SourceRange } from '@src/lang/wasm'
import { pathToNodeFromRustNodePath } from '@src/lang/wasm'
import {
  SKETCH_HIGHLIGHT_COLOR,
  SKETCH_SELECTION_COLOR,
} from '@src/lib/constants'
import { EngineDebugger } from '@src/lib/debugger'
import type { RenderPacket } from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Line,
  LineBasicMaterial,
  type Material,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three'
import type { ao } from 'three/examples/jsm/tsl/display/GTAONode.js'
import type { pass, vec3, vec4 } from 'three/tsl'
import type { RenderPipeline, WebGPURenderer } from 'three/webgpu'

const WEBGPU_PORT_DEBUG_STORAGE_KEY = 'webgpu-port-debug'
const WEBGPU_PORT_LOG_PREFIX = '[WEBGPU_POC]'
const WEBGPU_TRIMMING_ENABLED = true
const GLTF_METERS_TO_ENGINE_MILLIMETERS = 1000
const ENGINE_MILLIMETERS_TO_GLTF_METERS = 1 / GLTF_METERS_TO_ENGINE_MILLIMETERS
const ENGINE_DEFAULT_SURFACE_COLOR = new Color(0.9, 0.9, 0.9)
const HOVER_COLOR = new Color(SKETCH_HIGHLIGHT_COLOR)
const SELECTED_COLOR = new Color(SKETCH_SELECTION_COLOR)
const previewMaterialBaseColors = new WeakMap<Material, Color>()
const NATIVE_LINE_RAYCAST_THRESHOLD_GLTF_METERS = 0.001
const EDGE_RAYCAST_THRESHOLD_PX = 2

type AoFactory = typeof ao
type AmbientOcclusionPass = ReturnType<AoFactory> & { dispose: () => void }
type CreateAmbientOcclusion = (
  depthNode: Parameters<AoFactory>[0],
  normalNode: Parameters<AoFactory>[1] | null,
  camera: Parameters<AoFactory>[2]
) => AmbientOcclusionPass
type AmbientOcclusionPipeline = {
  camera: PerspectiveCamera | OrthographicCamera
  pipeline: RenderPipeline
  scenePass: ReturnType<typeof pass>
  aoPass: AmbientOcclusionPass
}
type WebGpuRuntimeModules = {
  RenderPipeline: typeof RenderPipeline
  createWebGpuSurfaceResources: typeof createWebGpuSurfaceResources
  pass: typeof pass
  vec3: typeof vec3
  vec4: typeof vec4
  createAmbientOcclusion: CreateAmbientOcclusion
}

export interface LocalRendererProps {
  backgroundColor: string
  enableSSAO: boolean
  highlightEdges: boolean
  onVisibilityChange: (isVisible: boolean) => void
  onExportReady?: (exportScene: (() => Promise<void>) | null) => void
  forceHide?: boolean
  commandProxyEnabled?: boolean
}

export class LocalRenderer {
  private readonly container: HTMLDivElement
  private readonly kclManager: KclManager
  private backgroundColor: string
  private enableSSAO: boolean
  private highlightEdges: boolean
  private forceHide: boolean
  private commandProxyEnabled: boolean
  private onVisibilityChange: LocalRendererProps['onVisibilityChange']
  private onExportReady: LocalRendererProps['onExportReady']
  private isVisible = false
  private requestRender: (() => void) | null = null
  private renderer: WebGPURenderer | null = null
  private scene: Scene | null = null
  private envMapLoader: EnvMapLoader | null = null
  private exportScene: (() => Promise<void>) | null = null
  private edgeRenderer: EdgeRenderer | null = null
  private runtimeModules: WebGpuRuntimeModules | null = null
  private resizeObserver: ResizeObserver | null = null
  private animationFrameId = -1
  private currentModel: Object3D | null = null
  private currentSurfaceResources: WebGpuSurfaceResources | null = null
  private previewCamera: PerspectiveCamera | OrthographicCamera | null = null
  private readonly previewTarget = new Vector3()
  private readonly convertedSharedPosition = new Vector3()
  private readonly convertedSharedTarget = new Vector3()
  private readonly convertedSharedUp = new Vector3()
  private hoveredObject: Object3D | null = null
  private selectedObjects = new Set<Object3D>()
  private selectionEntityIdToObject = new Map<string, Object3D>()
  private parserState: GltfParserState | RenderPacketParserState | null = null
  private activeSketchModePlane: GetSketchModePlane | null = null
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private unregisterLocalSelectionProvider: (() => void) | null = null
  private unregisterSharedCameraListener: (() => void) | null = null
  private ambientOcclusionRadius = 0.01
  private ambientOcclusionPipeline: AmbientOcclusionPipeline | null = null
  private currentRefreshId = 0
  private pendingRefreshRequest = false
  private refreshModel: (() => Promise<void>) | null = null
  private disposed = false

  constructor(
    container: HTMLDivElement,
    kclManager: KclManager,
    props: LocalRendererProps
  ) {
    this.container = container
    this.kclManager = kclManager
    this.backgroundColor = props.backgroundColor
    this.enableSSAO = props.enableSSAO
    this.highlightEdges = props.highlightEdges
    this.forceHide = props.forceHide ?? false
    this.commandProxyEnabled = props.commandProxyEnabled ?? true
    this.onVisibilityChange = props.onVisibilityChange
    this.onExportReady = props.onExportReady

    if (!LOCAL_WEBGPU_RENDERING_ENABLED) {
      this.onVisibilityChange(false)
      return
    }

    logLocalWebGpuPreview('initializing preview')
    this.container.style.opacity = '0'
    this.kclManager.addEventListener(
      KclManagerEvents.ExecutionDone,
      this.onExecutionDone
    )
    void this.initialize().catch(this.handleInitializationError)
  }

  setBackgroundColor(backgroundColor: string) {
    if (this.backgroundColor === backgroundColor) {
      return
    }

    this.backgroundColor = backgroundColor
    if (this.scene) {
      this.scene.background = new Color(backgroundColor)
      this.edgeRenderer?.setBackgroundColor(backgroundColor)
      this.requestRender?.()
    }
  }

  setEnableSSAO(enableSSAO: boolean) {
    this.enableSSAO = enableSSAO
    this.requestRender?.()
  }

  setHighlightEdges(highlightEdges: boolean) {
    if (this.highlightEdges === highlightEdges) {
      return
    }

    this.highlightEdges = highlightEdges
    this.edgeRenderer?.setVisible(highlightEdges)
    this.requestRender?.()
  }

  setForceHide(forceHide: boolean) {
    this.forceHide = forceHide
    this.container.style.opacity = this.isVisible && !this.forceHide ? '1' : '0'
    this.requestRender?.()
  }

  setCommandProxyEnabled(commandProxyEnabled: boolean) {
    this.commandProxyEnabled = commandProxyEnabled
  }

  setOnVisibilityChange(
    onVisibilityChange: LocalRendererProps['onVisibilityChange']
  ) {
    this.onVisibilityChange = onVisibilityChange
  }

  setOnExportReady(onExportReady: LocalRendererProps['onExportReady']) {
    if (this.onExportReady === onExportReady) {
      return
    }

    this.onExportReady?.(null)
    this.onExportReady = onExportReady
    if (this.exportScene) {
      this.onExportReady?.(this.exportScene)
    }
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.currentRefreshId += 1
    this.refreshModel = null
    this.kclManager.removeEventListener(
      KclManagerEvents.ExecutionDone,
      this.onExecutionDone
    )
    this.container.style.opacity = '0'
    this.isVisible = false
    this.exportScene = null
    this.onExportReady?.(null)
    this.unregisterLocalSelectionProvider?.()
    this.unregisterLocalSelectionProvider = null
    this.unregisterSharedCameraListener?.()
    this.unregisterSharedCameraListener = null
    this.clearHover()
    const previousSelectedObjects = [...this.selectedObjects]
    this.selectedObjects.clear()
    previousSelectedObjects.forEach(this.applyObjectState)
    this.clearModel()
    this.edgeRenderer?.dispose()
    this.edgeRenderer = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.animationFrameId !== -1) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = -1
    }
    this.requestRender = null
    this.disposeAmbientOcclusionPipeline()
    this.envMapLoader?.dispose()
    this.envMapLoader = null
    this.renderer?.domElement.remove()
    this.renderer?.dispose()
    this.renderer = null
    this.scene = null
    this.previewCamera = null
    this.runtimeModules = null
    this.parserState = null
    this.activeSketchModePlane = null
  }

  private readonly getResolvedSelectionEntity = (object: Object3D | null) => {
    if (!object) {
      return null
    }

    const metadata = getPickedObjectMetadata(object, this.parserState)
    const extras = isKittycadPrimitiveExtras(metadata.kittycadPrimitiveExtras)
      ? metadata.kittycadPrimitiveExtras
      : null
    if (extras) {
      return resolveSelectionEntityFromPrimitiveExtras(
        extras,
        this.kclManager.artifactGraph
      )
    }

    const edgeExtras = isKittycadEdgeExtras(metadata.kittycadEdgeExtras)
      ? metadata.kittycadEdgeExtras
      : null
    if (edgeExtras) {
      return resolveSelectionEntityFromEdgeExtras(
        edgeExtras,
        this.kclManager.artifactGraph
      )
    }

    const sketchExtras = isKittycadSketchExtras(metadata.kittycadSketchExtras)
      ? metadata.kittycadSketchExtras
      : null
    if (sketchExtras) {
      return resolveSelectionEntityFromSketchExtras(
        sketchExtras,
        this.kclManager.artifactGraph
      )
    }

    const regionExtras = isKittycadRegionExtras(metadata.kittycadRegionExtras)
      ? metadata.kittycadRegionExtras
      : null
    return regionExtras
      ? resolveSelectionEntityFromRegionExtras(regionExtras)
      : null
  }

  private readonly setVisible = (nextVisible: boolean) => {
    if (this.isVisible === nextVisible) {
      return
    }

    this.isVisible = nextVisible
    this.container.style.opacity = nextVisible && !this.forceHide ? '1' : '0'
    logLocalWebGpuPreview('preview visibility changed', {
      isVisible: nextVisible,
    })
    this.onVisibilityChange(nextVisible)
    this.requestRender?.()
  }

  private readonly syncPreviewCameraFromShared = () => {
    const sharedCamera = this.kclManager.sceneInfra.camControls.camera
    const sharedTarget = this.kclManager.sceneInfra.camControls.target
    if (!this.previewCamera) {
      return
    }

    this.convertedSharedPosition.copy(
      convertEngineWorldVectorToGltfWorld(
        sharedCamera.position,
        ENGINE_MILLIMETERS_TO_GLTF_METERS
      )
    )
    this.convertedSharedTarget.copy(
      convertEngineWorldVectorToGltfWorld(
        sharedTarget,
        ENGINE_MILLIMETERS_TO_GLTF_METERS
      )
    )
    this.convertedSharedUp.copy(
      convertEngineWorldVectorToGltfWorld(sharedCamera.up)
    )

    if (
      sharedCamera instanceof PerspectiveCamera &&
      !(this.previewCamera instanceof PerspectiveCamera)
    ) {
      this.previewCamera = new PerspectiveCamera()
    } else if (
      sharedCamera instanceof OrthographicCamera &&
      !(this.previewCamera instanceof OrthographicCamera)
    ) {
      this.previewCamera = new OrthographicCamera()
    }

    this.previewCamera.layers.mask = sharedCamera.layers.mask
    this.previewCamera.position.copy(this.convertedSharedPosition)
    this.previewCamera.up.copy(this.convertedSharedUp)
    this.previewCamera.near = Math.max(
      sharedCamera.near * ENGINE_MILLIMETERS_TO_GLTF_METERS,
      0.0001
    )
    this.previewCamera.far = Math.max(
      sharedCamera.far * ENGINE_MILLIMETERS_TO_GLTF_METERS,
      this.previewCamera.near + 0.0001
    )
    this.previewTarget.copy(this.convertedSharedTarget)

    if (
      sharedCamera instanceof PerspectiveCamera &&
      this.previewCamera instanceof PerspectiveCamera
    ) {
      this.previewCamera.fov = sharedCamera.fov
      this.previewCamera.aspect =
        Math.max(this.container.clientWidth, 1) /
        Math.max(this.container.clientHeight, 1)
    } else if (
      sharedCamera instanceof OrthographicCamera &&
      this.previewCamera instanceof OrthographicCamera
    ) {
      this.previewCamera.left =
        sharedCamera.left * ENGINE_MILLIMETERS_TO_GLTF_METERS
      this.previewCamera.right =
        sharedCamera.right * ENGINE_MILLIMETERS_TO_GLTF_METERS
      this.previewCamera.top =
        sharedCamera.top * ENGINE_MILLIMETERS_TO_GLTF_METERS
      this.previewCamera.bottom =
        sharedCamera.bottom * ENGINE_MILLIMETERS_TO_GLTF_METERS
      this.previewCamera.zoom = sharedCamera.zoom
    }

    this.previewCamera.lookAt(this.previewTarget)
    this.previewCamera.updateProjectionMatrix()
    this.previewCamera.updateMatrixWorld(true)
    this.requestRender?.()
  }

  private readonly applyObjectState = (object: Object3D | null) => {
    if (!object) {
      return
    }

    const mode = this.selectedObjects.has(object)
      ? 'selected'
      : object === this.hoveredObject
        ? 'hover'
        : 'base'
    if (object instanceof Mesh) {
      setMeshHighlight(object, mode)
    } else if (object instanceof Line) {
      setLineHighlight(object, mode)
    }
    this.requestRender?.()
  }

  private readonly clearHover = () => {
    if (!this.hoveredObject) {
      return
    }

    const previousHoveredObject = this.hoveredObject
    this.hoveredObject = null
    this.applyObjectState(previousHoveredObject)
  }

  private readonly pickRenderableFromWindowCoordinates = ({
    x,
    y,
    streamWidth,
    streamHeight,
  }: {
    x: number
    y: number
    streamWidth: number
    streamHeight: number
  }) => {
    if (
      !this.isVisible ||
      !this.previewCamera ||
      !this.currentModel ||
      streamWidth <= 0 ||
      streamHeight <= 0
    ) {
      return null
    }

    this.pointer.x = (x / streamWidth) * 2 - 1
    this.pointer.y = -(y / streamHeight) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.previewCamera)
    this.raycaster.params.Line = {
      ...(this.raycaster.params.Line ?? {}),
      threshold: NATIVE_LINE_RAYCAST_THRESHOLD_GLTF_METERS,
    }
    this.raycaster.params.Line2 = {
      threshold: EDGE_RAYCAST_THRESHOLD_PX,
    }

    const intersection = this.raycaster
      .intersectObject(this.currentModel, true)
      .find((candidate) => {
        if (this.edgeRenderer?.isLineObject(candidate.object)) {
          return this.highlightEdges
        }
        if (candidate.object instanceof Line) {
          return true
        }
        if (!(candidate.object instanceof Mesh)) {
          return false
        }
        if (!WEBGPU_TRIMMING_ENABLED) {
          return true
        }

        const primitive =
          this.parserState && 'primitiveByObject' in this.parserState
            ? (this.parserState.primitiveByObject.get(candidate.object) ?? null)
            : null
        return isUvInsideTrimLoops(
          candidate.uv ? { x: candidate.uv.x, y: candidate.uv.y } : null,
          primitive?.trimLoops ?? null
        )
      })

    if (!intersection || intersection.faceIndex == null) {
      return intersection
    }
    if (!this.edgeRenderer?.isLineObject(intersection.object)) {
      return intersection
    }

    const edgeObject = this.edgeRenderer.getEdgeObjectForSegment(
      intersection.faceIndex
    )
    return edgeObject ? { ...intersection, object: edgeObject } : intersection
  }

  private readonly updateHoverFromIntersection = (
    intersection:
      | { distance?: number; point?: Vector3; object?: Object3D }
      | null
      | undefined
  ) => {
    const nextHoveredObject = intersection?.object ?? null
    if (nextHoveredObject === this.hoveredObject) {
      return
    }

    const previousHoveredObject = this.hoveredObject
    this.hoveredObject = null
    this.applyObjectState(previousHoveredObject)
    if (!nextHoveredObject) {
      return
    }

    this.hoveredObject = nextHoveredObject
    this.applyObjectState(this.hoveredObject)
    const resolvedSelectionEntity =
      this.getResolvedSelectionEntity(nextHoveredObject)
    logLocalWebGpuPreview('local hover changed', {
      distance: intersection?.distance,
      point: intersection?.point?.toArray(),
      ...summarizePickedObject(
        nextHoveredObject,
        this.parserState,
        resolvedSelectionEntity
      ),
    })
  }

  private readonly updateSelectedMeshes = ({
    nextSelectedMeshes,
    selectionSummary,
  }: {
    nextSelectedMeshes: Set<Object3D>
    selectionSummary: unknown
  }) => {
    if (
      nextSelectedMeshes.size === this.selectedObjects.size &&
      [...nextSelectedMeshes].every((mesh) => this.selectedObjects.has(mesh))
    ) {
      return
    }

    const previousSelectedMeshes = [...this.selectedObjects]
    this.selectedObjects = nextSelectedMeshes
    previousSelectedMeshes.forEach(this.applyObjectState)
    this.applyObjectState(this.hoveredObject)
    this.selectedObjects.forEach(this.applyObjectState)
    ;(
      window as typeof window & { __WEBGPU_POC_SELECTION__?: unknown }
    ).__WEBGPU_POC_SELECTION__ = selectionSummary
    logLocalWebGpuPreview('local selection changed', {
      selection: selectionSummary,
    })
  }

  private readonly exportCurrentScene = async () => {
    if (!this.currentModel) {
      logLocalWebGpuPreview('GLB export skipped; no current model')
      return
    }

    const modelToExport = this.currentModel
    const trimStates = new Map<Object3D, unknown>()
    modelToExport.traverse((object) => {
      if ('kittycadTrimState' in object.userData) {
        trimStates.set(object, object.userData.kittycadTrimState)
        delete object.userData.kittycadTrimState
      }
    })

    try {
      modelToExport.updateMatrixWorld(true)
      const { GLTFExporter } = await import(
        'three/examples/jsm/exporters/GLTFExporter.js'
      )
      const exporter = new GLTFExporter()
      const result = await exporter.parseAsync(modelToExport, {
        binary: true,
        onlyVisible: true,
      })
      if (!(result instanceof ArrayBuffer)) {
        return Promise.reject(
          new Error('GLTFExporter did not produce a binary GLB')
        )
      }

      const blob = new Blob([result], { type: 'model/gltf-binary' })
      const downloadUrl = URL.createObjectURL(blob)
      const downloadLink = document.createElement('a')
      const timestamp = new Date().toISOString().replaceAll(':', '-')
      downloadLink.href = downloadUrl
      downloadLink.download = `render-packet-scene-${timestamp}.glb`
      downloadLink.style.display = 'none'
      document.body.appendChild(downloadLink)
      downloadLink.click()
      downloadLink.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)

      logLocalWebGpuPreview('current Three.js scene exported as GLB', {
        bytes: result.byteLength,
        filename: downloadLink.download,
      })
    } finally {
      trimStates.forEach((trimState, object) => {
        object.userData.kittycadTrimState = trimState
      })
    }
  }

  private readonly handleInitializationError = (error: unknown) => {
    logLocalWebGpuPreview('preview initialization failed', { error })
    console.error('[LocalWebGPUScene] preview initialization failed', error)
    reportRejection(error)
  }

  private configureAmbientOcclusion(aoPass: AmbientOcclusionPass) {
    aoPass.radius.value = this.ambientOcclusionRadius
    aoPass.thickness.value = this.ambientOcclusionRadius * 3
    aoPass.distanceFallOff.value = 0.5
    aoPass.scale.value = 1
  }

  private disposeAmbientOcclusionPipeline() {
    this.ambientOcclusionPipeline?.pipeline.dispose()
    this.ambientOcclusionPipeline?.scenePass.dispose()
    this.ambientOcclusionPipeline?.aoPass.dispose()
    this.ambientOcclusionPipeline = null
  }

  private updateAmbientOcclusionScale(modelBounds: Box3) {
    if (modelBounds.isEmpty()) {
      return
    }

    const size = modelBounds.getSize(new Vector3())
    const modelScale = Math.max(size.x, size.y, size.z)
    if (!Number.isFinite(modelScale) || modelScale <= 0) {
      return
    }

    // Render-packet geometry is expressed in meters. Keep the sampling radius
    // proportional to the part instead of GTAO's room-scale default.
    this.ambientOcclusionRadius = Math.max(modelScale * 0.05, 0.00001)
    if (this.ambientOcclusionPipeline) {
      this.configureAmbientOcclusion(this.ambientOcclusionPipeline.aoPass)
    }
  }

  private renderPreview() {
    const previewCamera = this.previewCamera
    const renderer = this.renderer
    const runtimeModules = this.runtimeModules
    const scene = this.scene
    if (!previewCamera || !renderer || !runtimeModules || !scene) {
      return
    }

    if (!this.enableSSAO || this.forceHide) {
      renderer.render(scene, previewCamera)
      return
    }

    if (this.ambientOcclusionPipeline?.camera !== previewCamera) {
      this.disposeAmbientOcclusionPipeline()

      // GTAO expects a regular depth texture. The renderer itself can keep
      // using MSAA, but this intermediate pass must be single-sampled.
      const scenePass = runtimeModules.pass(scene, previewCamera, {
        samples: 0,
      })
      const scenePassColor = scenePass.getTextureNode()
      const scenePassDepth = scenePass.getTextureNode('depth')
      const aoPass = runtimeModules.createAmbientOcclusion(
        scenePassDepth,
        null,
        previewCamera
      )
      aoPass.resolutionScale = 0.5
      this.configureAmbientOcclusion(aoPass)

      const pipeline = new runtimeModules.RenderPipeline(renderer)
      const aoOutput = aoPass.getTextureNode()
      // Preserve some indirect light even at maximum occlusion while leaving
      // enough contrast to make the setting visibly effective.
      const ambientOcclusion = aoOutput.r.mul(0.8).add(0.2)
      pipeline.outputNode = scenePassColor.mul(
        runtimeModules.vec4(runtimeModules.vec3(ambientOcclusion), 1)
      )

      this.ambientOcclusionPipeline = {
        camera: previewCamera,
        pipeline,
        scenePass,
        aoPass,
      }
    }

    this.ambientOcclusionPipeline.pipeline.render()
  }

  private readonly scheduleRender = () => {
    if (this.disposed || !this.previewCamera || this.animationFrameId !== -1) {
      return
    }

    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = -1
      if (this.disposed || !this.previewCamera) {
        return
      }

      this.renderPreview()
    })
  }

  private readonly resize = () => {
    const { renderer } = this
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (!renderer || width === 0 || height === 0) {
      return
    }

    renderer.setSize(width, height, false)
    if (this.previewCamera instanceof PerspectiveCamera) {
      this.previewCamera.aspect = width / height
      this.previewCamera.updateProjectionMatrix()
    } else {
      this.syncPreviewCameraFromShared()
    }
    this.requestRender?.()
  }

  private clearModel() {
    if (this.currentModel) {
      this.scene?.remove(this.currentModel)
      this.edgeRenderer?.removeFromParent()
      disposeObject3D(this.currentModel)
      this.currentModel = null
    }

    if (this.currentSurfaceResources && this.renderer) {
      this.currentSurfaceResources.dispose(this.renderer)
    }
    this.currentSurfaceResources = null
    this.selectionEntityIdToObject.clear()
    this.requestRender?.()
  }

  private hydrateCurrentModelMetadata() {
    if (!this.currentModel) {
      this.selectionEntityIdToObject.clear()
      return
    }

    this.selectionEntityIdToObject = new Map<string, Object3D>()
    this.currentModel.traverse((object) => {
      object.layers.mask = this.previewCamera?.layers.mask ?? object.layers.mask

      const metadata = getPickedObjectMetadata(object, this.parserState)
      if (
        !(object instanceof Mesh) &&
        !(object instanceof Line) &&
        !metadata.kittycadEdgeExtras
      ) {
        return
      }

      if (object instanceof Mesh && metadata.primitiveExtras) {
        object.userData.gltfPrimitiveExtras = metadata.primitiveExtras
      }
      if (object instanceof Mesh && metadata.kittycadPrimitiveExtras) {
        object.userData.kittycadPrimitiveExtras =
          metadata.kittycadPrimitiveExtras
        if (isKittycadPrimitiveExtras(metadata.kittycadPrimitiveExtras)) {
          const resolvedSelectionEntity =
            resolveSelectionEntityFromPrimitiveExtras(
              metadata.kittycadPrimitiveExtras,
              this.kclManager.artifactGraph
            )
          object.userData.kittycadSelectionEntityId =
            resolvedSelectionEntity.entityId
          object.userData.kittycadParentEntityId =
            resolvedSelectionEntity.parentEntityId
          object.userData.kittycadPrimitiveIndex =
            resolvedSelectionEntity.primitiveIndex
          this.selectionEntityIdToObject.set(
            resolvedSelectionEntity.entityId,
            object
          )
          this.selectionEntityIdToObject.set(
            metadata.kittycadPrimitiveExtras.face_id,
            object
          )
        }
      }
      if (metadata.kittycadEdgeExtras) {
        object.userData.kittycadEdgeExtras = metadata.kittycadEdgeExtras
        if (isKittycadEdgeExtras(metadata.kittycadEdgeExtras)) {
          const resolvedSelectionEntity = resolveSelectionEntityFromEdgeExtras(
            metadata.kittycadEdgeExtras,
            this.kclManager.artifactGraph
          )
          object.userData.kittycadSelectionEntityId =
            resolvedSelectionEntity.entityId
          object.userData.kittycadParentEntityId =
            resolvedSelectionEntity.parentEntityId
          object.userData.kittycadPrimitiveIndex =
            resolvedSelectionEntity.primitiveIndex
          this.selectionEntityIdToObject.set(
            resolvedSelectionEntity.entityId,
            object
          )
          this.selectionEntityIdToObject.set(
            metadata.kittycadEdgeExtras.edge_id,
            object
          )
        }
      }
      if (object instanceof Line && metadata.kittycadSketchExtras) {
        object.userData.kittycadSketchExtras = metadata.kittycadSketchExtras
        if (isKittycadSketchExtras(metadata.kittycadSketchExtras)) {
          const resolvedSelectionEntity =
            resolveSelectionEntityFromSketchExtras(
              metadata.kittycadSketchExtras,
              this.kclManager.artifactGraph
            )
          if (resolvedSelectionEntity) {
            object.userData.kittycadSelectionEntityId =
              resolvedSelectionEntity.entityId
            object.userData.kittycadParentEntityId =
              resolvedSelectionEntity.parentEntityId
            object.userData.kittycadPrimitiveIndex =
              resolvedSelectionEntity.primitiveIndex
            this.selectionEntityIdToObject.set(
              resolvedSelectionEntity.entityId,
              object
            )
          }
        }
      }
      if (object instanceof Mesh && metadata.kittycadRegionExtras) {
        object.userData.kittycadRegionExtras = metadata.kittycadRegionExtras
        if (isKittycadRegionExtras(metadata.kittycadRegionExtras)) {
          const resolvedSelectionEntity =
            resolveSelectionEntityFromRegionExtras(
              metadata.kittycadRegionExtras
            )
          object.userData.kittycadSelectionEntityId =
            resolvedSelectionEntity.entityId
          object.userData.kittycadParentEntityId =
            resolvedSelectionEntity.parentEntityId
          object.userData.kittycadPrimitiveIndex =
            resolvedSelectionEntity.primitiveIndex
          this.selectionEntityIdToObject.set(
            resolvedSelectionEntity.entityId,
            object
          )
        }
      }
    })
  }

  private async initialize() {
    const { kclManager } = this
    const { container } = this

    logLocalWebGpuPreview('initializing preview renderer')
    const [
      { WebGPURenderer, RenderPipeline },
      { EdgeRenderer },
      { createWebGpuSurfaceResources },
      { pass, vec3, vec4 },
      { ao },
    ] = await Promise.all([
      import('three/webgpu'),
      import('@src/clientSideScene/localRenderer/EdgeRenderer'),
      import('@src/clientSideScene/webgpuTrim'),
      import('three/tsl'),
      import('three/examples/jsm/tsl/display/GTAONode.js'),
    ])

    if (this.disposed) {
      logLocalWebGpuPreview('preview disposed before initialization completed')
      return
    }

    const hasNavigatorGpu = typeof navigator !== 'undefined' && !!navigator.gpu
    logLocalWebGpuPreview('navigator.gpu availability checked', {
      isSecureContext: window.isSecureContext,
      hasNavigatorGpu,
    })
    if (!hasNavigatorGpu) {
      this.setVisible(false)
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
      this.setVisible(false)
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
      this.setVisible(false)
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
    if (this.disposed) {
      logLocalWebGpuPreview(
        'preview disposed before renderer backend initialization completed'
      )
      renderer.dispose()
      return
    }
    logLocalWebGpuPreview('renderer backend initialized')
    renderer.toneMapping = NeutralToneMapping
    renderer.toneMappingExposure = 1
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.domElement.className =
      'absolute inset-0 z-20 h-full w-full pointer-events-none'
    container.appendChild(renderer.domElement)
    logLocalWebGpuPreview('renderer attached to DOM', {
      width: container.clientWidth,
      height: container.clientHeight,
    })

    const scene = new Scene()
    this.scene = scene
    scene.background = new Color(this.backgroundColor)
    const envMapLoader = new EnvMapLoader(renderer, device)
    const hdrEnvMapUrl = HDR_ENV_MAP_URL?.trim()
    if (hdrEnvMapUrl) {
      try {
        await envMapLoader.loadHdr(scene, hdrEnvMapUrl)
        logLocalWebGpuPreview('HDR environment loaded', {
          url: hdrEnvMapUrl,
        })
      } catch (error) {
        logLocalWebGpuPreview(
          'HDR environment unavailable; using procedural fallback',
          { url: hdrEnvMapUrl, error }
        )
        await envMapLoader.loadDefault(scene)
      }
    } else {
      await envMapLoader.loadDefault(scene)
    }
    if (this.disposed) {
      envMapLoader.dispose()
      renderer.domElement.remove()
      renderer.dispose()
      this.scene = null
      return
    }

    const edgeRenderer = new EdgeRenderer(
      this.backgroundColor,
      this.highlightEdges
    )
    this.edgeRenderer = edgeRenderer

    this.exportScene = this.exportCurrentScene
    this.onExportReady?.(this.exportCurrentScene)

    const sharedCamera = kclManager.sceneInfra.camControls.camera
    const sharedTarget = kclManager.sceneInfra.camControls.target
    if (sharedCamera instanceof PerspectiveCamera) {
      this.previewCamera = sharedCamera.clone()
      this.previewCamera.aspect =
        Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1)
    } else if (sharedCamera instanceof OrthographicCamera) {
      this.previewCamera = sharedCamera.clone()
    } else {
      this.previewCamera = new PerspectiveCamera(45, 1, 0.01, 1000)
    }
    this.previewCamera.layers.mask = sharedCamera.layers.mask
    this.previewTarget.copy(sharedTarget)
    logLocalWebGpuPreview('preview camera created', {
      cameraType: this.previewCamera.type,
      cameraPosition: this.previewCamera.position.toArray(),
      target: this.previewTarget.toArray(),
      layerMask: this.previewCamera.layers.mask,
    })
    this.unregisterSharedCameraListener =
      kclManager.sceneInfra.camControls.cameraChange.add(() => {
        this.syncPreviewCameraFromShared()
      })

    this.runtimeModules = {
      RenderPipeline,
      createWebGpuSurfaceResources,
      pass,
      vec3,
      vec4,
      createAmbientOcclusion: ao as CreateAmbientOcclusion,
    }
    this.renderer = renderer
    this.envMapLoader = envMapLoader
    this.requestRender = this.scheduleRender

    this.unregisterLocalSelectionProvider =
      registerLocalSelectionCommandProvider({
        isActive: () => this.isVisible,
        handleCommand: async (command, { streamDimensions }) => {
          if (command.type !== 'modeling_cmd_req') {
            return null
          }

          const { cmd, cmd_id } = command
          switch (cmd.type) {
            case 'highlight_set_entity': {
              if (!this.commandProxyEnabled) {
                return null
              }
              const intersection = this.pickRenderableFromWindowCoordinates({
                x: cmd.selected_at_window.x,
                y: cmd.selected_at_window.y,
                streamWidth: streamDimensions.width,
                streamHeight: streamDimensions.height,
              })
              this.updateHoverFromIntersection(intersection)
              const object = intersection?.object ?? null
              const resolvedSelectionEntity =
                this.getResolvedSelectionEntity(object)
              return {
                unreliableModelingResponse: {
                  type: 'highlight_set_entity',
                  data: {
                    entity_id: resolvedSelectionEntity?.entityId ?? '',
                    sequence: 'sequence' in cmd ? cmd.sequence : undefined,
                  },
                },
              }
            }
            case 'select_with_point': {
              if (!this.commandProxyEnabled) {
                return null
              }
              const intersection = this.pickRenderableFromWindowCoordinates({
                x: cmd.selected_at_window.x,
                y: cmd.selected_at_window.y,
                streamWidth: streamDimensions.width,
                streamHeight: streamDimensions.height,
              })
              const object = intersection?.object ?? null
              const resolvedSelectionEntity =
                this.getResolvedSelectionEntity(object)
              const modelingResponse = {
                type: 'select_with_point',
                data: {
                  entity_id: resolvedSelectionEntity?.entityId ?? '',
                },
              }
              return {
                modelingResponse,
                websocketResponse: {
                  success: true,
                  request_id: cmd_id,
                  resp: {
                    type: 'modeling',
                    data: {
                      modeling_response: modelingResponse,
                    },
                  },
                } as never,
              }
            }
            case 'entity_get_parent_id': {
              if (!this.commandProxyEnabled) {
                return null
              }
              const object =
                this.selectionEntityIdToObject.get(cmd.entity_id) ?? null
              const metadata = object
                ? getPickedObjectMetadata(object, this.parserState)
                : null
              const primitiveExtras = isKittycadPrimitiveExtras(
                metadata?.kittycadPrimitiveExtras
              )
                ? metadata.kittycadPrimitiveExtras
                : null
              const edgeExtras = isKittycadEdgeExtras(
                metadata?.kittycadEdgeExtras
              )
                ? metadata.kittycadEdgeExtras
                : null
              const resolvedSelectionEntity =
                this.getResolvedSelectionEntity(object)
              const modelingResponse = {
                type: 'entity_get_parent_id',
                data: {
                  entity_id:
                    resolvedSelectionEntity?.parentEntityId ??
                    primitiveExtras?.object_id ??
                    edgeExtras?.object_id ??
                    '',
                },
              }
              return {
                websocketResponse: {
                  success: true,
                  request_id: cmd_id,
                  resp: {
                    type: 'modeling',
                    data: {
                      modeling_response: modelingResponse,
                    },
                  },
                } as never,
              }
            }
            case 'entity_get_primitive_index': {
              if (!this.commandProxyEnabled) {
                return null
              }
              const object =
                this.selectionEntityIdToObject.get(cmd.entity_id) ?? null
              const metadata = object
                ? getPickedObjectMetadata(object, this.parserState)
                : null
              const primitiveExtras = isKittycadPrimitiveExtras(
                metadata?.kittycadPrimitiveExtras
              )
                ? metadata.kittycadPrimitiveExtras
                : null
              const edgeExtras = isKittycadEdgeExtras(
                metadata?.kittycadEdgeExtras
              )
                ? metadata.kittycadEdgeExtras
                : null
              const resolvedSelectionEntity =
                this.getResolvedSelectionEntity(object)
              const modelingResponse = {
                type: 'entity_get_primitive_index',
                data: {
                  entity_type: resolvedSelectionEntity?.entityType ?? 'face',
                  primitive_index:
                    resolvedSelectionEntity?.primitiveIndex ??
                    primitiveExtras?.primitive_index ??
                    edgeExtras?.edge_index ??
                    -1,
                },
              }
              return {
                websocketResponse: {
                  success: true,
                  request_id: cmd_id,
                  resp: {
                    type: 'modeling',
                    data: {
                      modeling_response: modelingResponse,
                    },
                  },
                } as never,
              }
            }
            case 'region_get_query_point': {
              if (!this.commandProxyEnabled) {
                return null
              }
              const object =
                this.selectionEntityIdToObject.get(cmd.region_id) ?? null
              const metadata = object
                ? getPickedObjectMetadata(object, this.parserState)
                : null
              const regionExtras = isKittycadRegionExtras(
                metadata?.kittycadRegionExtras
              )
                ? metadata.kittycadRegionExtras
                : null
              const modelingResponse = {
                type: 'region_get_query_point',
                data: {
                  query_point: regionExtras?.query_point ?? { x: 0, y: 0 },
                },
              }
              return {
                websocketResponse: {
                  success: true,
                  request_id: cmd_id,
                  resp: {
                    type: 'modeling',
                    data: {
                      modeling_response: modelingResponse,
                    },
                  },
                } as never,
              }
            }
            case 'select_clear': {
              if (!this.commandProxyEnabled) {
                return null
              }
              this.updateSelectedMeshes({
                nextSelectedMeshes: new Set<Object3D>(),
                selectionSummary: null,
              })
              return { websocketResponse: null }
            }
            case 'select_add': {
              if (!this.commandProxyEnabled) {
                return null
              }
              const nextSelectedMeshes = new Set<Object3D>()
              for (const entityId of cmd.entities) {
                const object = this.selectionEntityIdToObject.get(entityId)
                if (object) {
                  nextSelectedMeshes.add(object)
                }
              }
              const firstSelectedMesh =
                nextSelectedMeshes.values().next().value ?? null
              const resolvedSelectionEntity =
                this.getResolvedSelectionEntity(firstSelectedMesh)
              const selectionSummary = firstSelectedMesh
                ? summarizePickedObject(
                    firstSelectedMesh,
                    this.parserState,
                    resolvedSelectionEntity
                  )
                : null
              this.updateSelectedMeshes({
                nextSelectedMeshes,
                selectionSummary,
              })
              return { websocketResponse: null }
            }
            case 'enable_sketch_mode': {
              const mesh =
                this.selectionEntityIdToObject.get(cmd.entity_id) ?? null
              if (!mesh) {
                logLocalWebGpuPreview('local sketch mode plane mesh missing', {
                  entityId: cmd.entity_id,
                  knownSelectionEntityIds: Array.from(
                    this.selectionEntityIdToObject.keys()
                  ).slice(0, 20),
                })
                return null
              }
              if (!(mesh instanceof Mesh)) {
                logLocalWebGpuPreview(
                  'local sketch mode plane derivation failed',
                  {
                    entityId: cmd.entity_id,
                    meshName: mesh.name || null,
                    meshType: mesh.type,
                    reason: 'selected entity is not a face mesh',
                  }
                )
                return null
              }
              this.activeSketchModePlane = deriveSketchModePlaneFromMesh(
                mesh,
                kclManager.sceneInfra.camControls.camera
              )
              if (!this.activeSketchModePlane) {
                logLocalWebGpuPreview(
                  'local sketch mode plane derivation failed',
                  {
                    entityId: cmd.entity_id,
                    meshName: mesh.name || null,
                    meshType: mesh.type,
                    metadata: summarizePickedObject(
                      mesh,
                      this.parserState,
                      this.getResolvedSelectionEntity(mesh)
                    ),
                  }
                )
                return null
              }
              logLocalWebGpuPreview('local sketch mode plane prepared', {
                entityId: cmd.entity_id,
                meshName: mesh.name || null,
                meshDebug: {
                  ...summarizeMeshWorldGeometry(mesh),
                  metadata: summarizePickedObject(
                    mesh,
                    this.parserState,
                    this.getResolvedSelectionEntity(mesh)
                  ),
                },
                plane: summarizeSketchModePlane(this.activeSketchModePlane),
              })
              const modelingResponse = {
                type: 'enable_sketch_mode',
                data: {},
              }
              return {
                modelingResponse,
                websocketResponse: {
                  success: true,
                  request_id: cmd_id,
                  resp: {
                    type: 'modeling',
                    data: {
                      modeling_response: modelingResponse,
                    },
                  },
                } as never,
              }
            }
            case 'get_sketch_mode_plane': {
              if (!this.activeSketchModePlane) {
                logLocalWebGpuPreview(
                  'local sketch mode plane missing for request'
                )
                return null
              }
              logLocalWebGpuPreview('local sketch mode plane requested', {
                plane: summarizeSketchModePlane(this.activeSketchModePlane),
              })
              const modelingResponse = {
                type: 'get_sketch_mode_plane',
                data: this.activeSketchModePlane,
              }
              return {
                modelingResponse,
                websocketResponse: {
                  success: true,
                  request_id: cmd_id,
                  resp: {
                    type: 'modeling',
                    data: {
                      modeling_response: modelingResponse,
                    },
                  },
                } as never,
              }
            }
            case 'sketch_mode_disable': {
              logLocalWebGpuPreview('local sketch mode disabled', {
                plane: summarizeSketchModePlane(this.activeSketchModePlane),
              })
              this.activeSketchModePlane = null
              const modelingResponse = {
                type: 'sketch_mode_disable',
                data: {},
              }
              return {
                modelingResponse,
                websocketResponse: {
                  success: true,
                  request_id: cmd_id,
                  resp: {
                    type: 'modeling',
                    data: {
                      modeling_response: modelingResponse,
                    },
                  },
                } as never,
              }
            }
            default:
              return null
          }
        },
      })

    this.resize()
    this.syncPreviewCameraFromShared()
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(container)

    this.requestRender?.()
    logLocalWebGpuPreview('render mode set to on-demand')

    this.refreshModel = async () => {
      const refreshId = ++this.currentRefreshId
      logLocalWebGpuPreview('starting model refresh', {
        refreshId,
        hasLastSuccessfulCode: Boolean(kclManager.lastSuccessfulCode),
      })
      await kclManager.rustContext.waitForAllEngineModelingCommands()

      if (this.disposed || refreshId !== this.currentRefreshId) {
        logLocalWebGpuPreview('dropping stale refresh after engine wait', {
          disposed: this.disposed,
          refreshId,
          currentRefreshId: this.currentRefreshId,
        })
        return
      }

      const exportSettings = jsAppSettings(kclManager.rustContext.settingsActor)
      let renderPacket: LocalRenderPacket | undefined
      const maxRenderPacketAttempts = 3
      for (let attempt = 1; attempt <= maxRenderPacketAttempts; attempt++) {
        renderPacket = undefined
        const encodedRenderPacket: RenderPacket | undefined =
          await kclManager.rustContext.exportRenderPacket(exportSettings)

        console.info(
          `${WEBGPU_PORT_LOG_PREFIX}[LocalWebGPUScene] render packet received`,
          encodedRenderPacket
        )

        if (encodedRenderPacket) {
          const decodedRenderPacket = decodeRenderPacket(encodedRenderPacket)
          if (decodedRenderPacket instanceof Error) {
            logLocalWebGpuPreview('render packet decoding failed', {
              refreshId,
              attempt,
              error: decodedRenderPacket.message,
            })
          } else {
            renderPacket = decodedRenderPacket
          }
        }

        if (this.disposed || refreshId !== this.currentRefreshId) {
          logLocalWebGpuPreview('dropping stale refresh result', {
            disposed: this.disposed,
            refreshId,
            currentRefreshId: this.currentRefreshId,
          })
          return
        }

        if (
          renderPacket &&
          (renderPacket.primitives.length > 0 || renderPacket.edges.length > 0)
        ) {
          break
        }

        if (attempt < maxRenderPacketAttempts) {
          logLocalWebGpuPreview('render packet unavailable, retrying', {
            refreshId,
            attempt,
            maxRenderPacketAttempts,
          })
          await new Promise((resolve) => window.setTimeout(resolve, 150))
        }
      }

      if (this.disposed || refreshId !== this.currentRefreshId) {
        logLocalWebGpuPreview('dropping stale refresh result', {
          disposed: this.disposed,
          refreshId,
          currentRefreshId: this.currentRefreshId,
        })
        return
      }

      if (
        renderPacket &&
        (renderPacket.primitives.length > 0 || renderPacket.edges.length > 0)
      ) {
        this.clearModel()
        this.currentSurfaceResources = createWebGpuSurfaceResources(
          renderPacket.primitives,
          renderPacket.bodyMaterials ?? [],
          WEBGPU_TRIMMING_ENABLED
        )
        const packetModel = buildRenderPacketModel(
          renderPacket,
          this.currentSurfaceResources,
          edgeRenderer
        )
        this.currentModel = packetModel.model
        this.updateAmbientOcclusionScale(packetModel.modelBounds)
        this.parserState = packetModel.parserState
        this.hydrateCurrentModelMetadata()
        scene.add(this.currentModel)
        const loadedModelStats = prepareLoadedModelForPreview(this.currentModel)
        console.info(
          `${WEBGPU_PORT_LOG_PREFIX}[LocalWebGPUScene] render packet trim stats`,
          summarizeRenderPacketTrimModes(renderPacket.primitives)
        )
        if (loadedModelStats.meshCount === 0) {
          this.clearModel()
          this.setVisible(false)
          return
        }
        logLocalWebGpuPreview('render packet applied to scene', {
          refreshId,
          primitiveCount: renderPacket.primitives.length,
          edgeCount: renderPacket.edges.length,
          bodyMaterialCount: renderPacket.bodyMaterials?.length ?? 0,
          meshCount: loadedModelStats.meshCount,
          surfaceDrawCount:
            this.currentSurfaceResources.batches.length +
            this.currentSurfaceResources.complexSurfaces.length,
          trimmingEnabled: WEBGPU_TRIMMING_ENABLED,
          trimTriangleCount: this.currentSurfaceResources.triangleCount,
          hybridMaskLayerCount:
            this.currentSurfaceResources.hybridMaskLayerCount,
          complexMaskCount: this.currentSurfaceResources.complexMaskCount,
        })
        this.syncPreviewCameraFromShared()
        this.setVisible(true)
        this.requestRender?.()
        return
      }

      logLocalWebGpuPreview(
        'render packet unavailable; keeping stream active',
        {
          refreshId,
        }
      )
      this.clearModel()
      this.setVisible(false)
      this.requestRender?.()
    }

    if (kclManager.lastSuccessfulCode) {
      await this.refreshModel()
    } else if (this.pendingRefreshRequest) {
      this.pendingRefreshRequest = false
      await this.refreshModel()
    }
  }

  private readonly onExecutionDone = (event: Event) => {
    const { detail } = event as CustomEvent<KclExecutionDoneDetail>
    logLocalWebGpuPreview('received execution-done event', detail)
    if (!detail.successful) {
      return
    }

    if (this.refreshModel) {
      void this.refreshModel()
      return
    }

    this.pendingRefreshRequest = true
    logLocalWebGpuPreview('refresh requested before renderer initialization')
  }
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
    message === 'preview initialization failed' ||
    message === 'device request failed' ||
    message === 'render packet unavailable; keeping stream active' ||
    message === 'local sketch mode plane missing for request' ||
    message === 'local sketch mode plane derivation failed' ||
    message === 'local sketch mode plane mesh missing'

  if (shouldPrintToConsole) {
    console.info(
      `${WEBGPU_PORT_LOG_PREFIX}[LocalWebGPUScene]`,
      message,
      metadata ?? ''
    )
  }
}

function summarizeRenderPacketTrimModes(
  primitives: LocalRenderPacketPrimitive[]
) {
  const stats = {
    faceCount: primitives.length,
    noTrimFaceCount: 0,
    hybridTrimFaceCount: 0,
    complexTextureTrimFaceCount: 0,
    totalTrimLoopCount: 0,
    totalTrimPointCount: 0,
  }

  for (const primitive of primitives) {
    const validTrimLoops = primitive.trimLoops.filter(
      (loop) => loop.positions.length >= 6
    )
    const trimPointCount = validTrimLoops.reduce(
      (count, loop) => count + loop.positions.length / 2,
      0
    )

    stats.totalTrimLoopCount += validTrimLoops.length
    stats.totalTrimPointCount += trimPointCount

    switch (primitive.trimMode) {
      case 'none':
        stats.noTrimFaceCount += 1
        break
      case 'hybrid':
        stats.hybridTrimFaceCount += 1
        break
      case 'complexTexture':
        stats.complexTextureTrimFaceCount += 1
        break
    }
  }

  return stats
}

function buildRenderPacketModel(
  packet: LocalRenderPacket,
  surfaceResources: WebGpuSurfaceResources,
  edgeRenderer: EdgeRenderer
) {
  const root = new Group()
  const primitiveByObject = new WeakMap<Object3D, LocalRenderPacketPrimitive>()
  const edgeByObject = new WeakMap<Object3D, LocalRenderPacketEdge>()
  const sketchByObject = new WeakMap<Object3D, LocalRenderPacketSketchSegment>()
  const regionByObject = new WeakMap<Object3D, LocalRenderPacketRegion>()

  const vertexStride =
    packet.vertexLayout.stride / Float32Array.BYTES_PER_ELEMENT
  const interleavedVertices = new InterleavedBuffer(
    packet.vertices,
    vertexStride
  )
  const positionAttribute = new InterleavedBufferAttribute(
    interleavedVertices,
    3,
    packet.vertexLayout.positionOffset / Float32Array.BYTES_PER_ELEMENT
  )
  const normalAttribute = new InterleavedBufferAttribute(
    interleavedVertices,
    3,
    packet.vertexLayout.normalOffset / Float32Array.BYTES_PER_ELEMENT
  )
  const uvAttribute = new InterleavedBufferAttribute(
    interleavedVertices,
    2,
    packet.vertexLayout.uvOffset / Float32Array.BYTES_PER_ELEMENT
  )
  const primitiveIndexAttribute = new BufferAttribute(
    packet.primitiveIndices,
    1
  )
  const modelBounds = new Box3()
  const boundsPoint = new Vector3()
  const positionOffset =
    packet.vertexLayout.positionOffset / Float32Array.BYTES_PER_ELEMENT
  for (
    let vertexIndex = 0;
    vertexIndex < positionAttribute.count;
    vertexIndex++
  ) {
    const offset = vertexIndex * vertexStride + positionOffset
    boundsPoint.set(
      packet.vertices[offset],
      packet.vertices[offset + 1],
      packet.vertices[offset + 2]
    )
    modelBounds.expandByPoint(boundsPoint)
  }

  const createSurfaceGeometry = (primitiveOffsets: number[]) => {
    const indexCount = primitiveOffsets.reduce(
      (count, primitiveOffset) =>
        count + packet.primitives[primitiveOffset].indexCount,
      0
    )
    const batchIndices = new Uint32Array(indexCount)
    let outputOffset = 0
    for (const primitiveOffset of primitiveOffsets) {
      const primitive = packet.primitives[primitiveOffset]
      const sourceIndices = packet.indices.subarray(
        primitive.firstIndex,
        primitive.firstIndex + primitive.indexCount
      )
      batchIndices.set(sourceIndices, outputOffset)
      outputOffset += sourceIndices.length
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', positionAttribute)
    geometry.setAttribute('normal', normalAttribute)
    geometry.setAttribute('uv', uvAttribute)
    geometry.setAttribute('primitiveIndex', primitiveIndexAttribute)
    geometry.setIndex(new BufferAttribute(batchIndices, 1))
    geometry.boundingBox = modelBounds
    return geometry
  }

  const setPrimitiveMetadata = (
    mesh: Mesh,
    primitive: LocalRenderPacketPrimitive
  ) => {
    mesh.userData.gltfPrimitiveExtras = {
      KITTYCAD: {
        object_id: primitive.objectId,
        body_id: primitive.bodyId,
        face_id: primitive.faceId,
        face_index: primitive.faceIndex,
        primitive_index: primitive.primitiveIndex,
      } satisfies PacketPrimitiveUserData['KITTYCAD'],
    } satisfies PacketPrimitiveUserData
    mesh.userData.kittycadPrimitiveExtras =
      mesh.userData.gltfPrimitiveExtras.KITTYCAD
    mesh.userData.kittycadTrimLoops = primitive.trimLoops
    primitiveByObject.set(mesh, primitive)
  }

  surfaceResources.batches.forEach((batch, batchIndex) => {
    if (batch.primitiveOffsets.length === 0) {
      return
    }

    const mesh = new Mesh(
      createSurfaceGeometry(batch.primitiveOffsets),
      batch.material
    )
    mesh.name = `surface_batch_${batchIndex}`
    mesh.userData.kittycadSurfaceBatch = true
    mesh.renderOrder = batch.transparent ? 1 : 0
    root.add(mesh)
  })

  surfaceResources.complexSurfaces.forEach((surface) => {
    const primitive = packet.primitives[surface.primitiveOffset]
    const mesh = new Mesh(
      createSurfaceGeometry([surface.primitiveOffset]),
      surface.material
    )
    mesh.name = `complex_surface_${primitive.primitiveIndex}`
    mesh.userData.kittycadSurfaceBatch = true
    setPrimitiveMetadata(mesh, primitive)
    mesh.renderOrder = surface.material.transparent ? 1 : 0
    root.add(mesh)
  })

  for (const { edge, object } of edgeRenderer.setEdges(packet.edges)) {
    edgeByObject.set(object, edge)
  }
  edgeRenderer.addTo(root)

  packet.sketches.forEach((segment) => {
    if (segment.positions.length < 6) {
      return
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(segment.positions, 3))

    const line = new Line(
      geometry,
      new LineBasicMaterial({
        color: 0xf2f3f5,
        transparent: true,
        opacity: 0.95,
      })
    )
    line.name = `sketch_${segment.sketchId}_${segment.holeIndex ?? 'path'}_${segment.segmentIndex}`
    line.userData.kittycadSketchExtras = {
      sketch_id: segment.sketchId,
      segment_id: segment.segmentId ?? null,
      segment_index: segment.segmentIndex,
      hole_index: segment.holeIndex ?? null,
      closed: segment.closed,
      source_range: segment.sourceRange ?? null,
      node_path: segment.nodePath
        ? pathToNodeFromRustNodePath(segment.nodePath)
        : null,
    } satisfies KittycadSketchExtras
    line.renderOrder = 3
    sketchByObject.set(line, segment)
    root.add(line)
  })

  packet.regions.forEach((region, regionIndex) => {
    const geometry = buildRegionGeometry(region)
    if (!geometry) {
      return
    }

    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
      })
    )
    mesh.name = `region_${region.regionId}_${regionIndex}`
    mesh.userData.kittycadRegionExtras = {
      sketch_id: region.sketchId,
      region_id: region.regionId,
      parent_id: region.parentId,
      query_point: region.queryPoint,
    } satisfies KittycadRegionExtras
    mesh.renderOrder = 3
    regionByObject.set(mesh, region)
    root.add(mesh)
  })

  return {
    model: root,
    parserState: {
      primitiveByObject,
      edgeByObject,
      sketchByObject,
      regionByObject,
    } satisfies RenderPacketParserState,
    modelBounds,
  }
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
    if (
      object.userData?.kittycadSurfaceBatch ||
      object.userData?.kittycadEdgeBatch ||
      object.userData?.kittycadRegionExtras
    ) {
      const materials = (
        isArray(object.material) ? object.material : [object.material]
      ) as Material[]
      materialCount += materials.length
      materials.forEach((material) => {
        materialTypes.add(material.type)
      })
      return
    }

    if (!object.geometry.getAttribute('normal')) {
      object.geometry.computeVertexNormals()
    }
  })

  return {
    meshCount,
    materialCount,
    materialTypes: Array.from(materialTypes.values()),
  }
}

type PreviewSurfaceMaterial = Material & { color: Color }

function getPreviewMaterials(mesh: Mesh): PreviewSurfaceMaterial[] {
  const materials = isArray(mesh.material) ? mesh.material : [mesh.material]
  return materials.filter(
    (material): material is PreviewSurfaceMaterial =>
      'color' in material && material.color instanceof Color
  )
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

type RenderPacketParserState = {
  primitiveByObject: WeakMap<Object3D, LocalRenderPacketPrimitive>
  edgeByObject: WeakMap<Object3D, LocalRenderPacketEdge>
  sketchByObject: WeakMap<Object3D, LocalRenderPacketSketchSegment>
  regionByObject: WeakMap<Object3D, LocalRenderPacketRegion>
}

type KittycadPrimitiveExtras = {
  object_id: string
  body_id: string
  face_id: string
  face_index: number
  primitive_index: number
}

type KittycadEdgeExtras = {
  object_id: string
  body_id: string
  edge_id: string
  edge_index: number
}

type KittycadSketchExtras = {
  sketch_id: string
  segment_id: string | null
  segment_index: number
  hole_index: number | null
  closed: boolean
  source_range: SourceRange | null
  node_path: PathToNode | null
}

type KittycadRegionExtras = {
  sketch_id: string
  region_id: string
  parent_id: string
  query_point: { x: number; y: number }
}

type RenderPacketTrimLoopSummary = {
  positions: ArrayLike<number>
}

function pointInTrimLoop(
  point: { x: number; y: number },
  loop: RenderPacketTrimLoopSummary
) {
  const { positions } = loop
  if (positions.length < 6) {
    return false
  }

  let inside = false
  let previousIndex = positions.length - 2
  for (
    let currentIndex = 0;
    currentIndex < positions.length;
    currentIndex += 2
  ) {
    const xi = positions[currentIndex]
    const yi = positions[currentIndex + 1]
    const xj = positions[previousIndex]
    const yj = positions[previousIndex + 1]

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-12) + xi

    if (intersects) {
      inside = !inside
    }

    previousIndex = currentIndex
  }

  return inside
}

function isUvInsideTrimLoops(
  uv: { x: number; y: number } | null | undefined,
  trimLoops: RenderPacketTrimLoopSummary[] | null | undefined
) {
  if (!uv || !trimLoops || trimLoops.length === 0) {
    return true
  }

  let inside = false
  for (const loop of trimLoops) {
    if (pointInTrimLoop(uv, loop)) {
      inside = !inside
    }
  }

  return inside
}

function unpackRegionLoop(loop: { positions: ArrayLike<number> }) {
  const points: Vector2[] = []
  for (let index = 0; index <= loop.positions.length - 2; index += 2) {
    points.push(new Vector2(loop.positions[index], loop.positions[index + 1]))
  }
  return points
}

function buildRegionGeometry(region: LocalRenderPacketRegion) {
  const contour = unpackRegionLoop(region.outerLoop)
  if (contour.length < 3) {
    return null
  }

  const holes = region.holeLoops
    .map(unpackRegionLoop)
    .filter((hole) => hole.length >= 3)

  const normalizedContour = ShapeUtils.isClockWise(contour)
    ? [...contour].reverse()
    : contour
  const normalizedHoles = holes.map((hole) =>
    ShapeUtils.isClockWise(hole) ? hole : [...hole].reverse()
  )

  const faces = ShapeUtils.triangulateShape(normalizedContour, normalizedHoles)
  if (faces.length === 0) {
    return null
  }

  const points = [...normalizedContour, ...normalizedHoles.flat()]
  const origin = new Vector3(
    region.planeOrigin.x,
    region.planeOrigin.y,
    region.planeOrigin.z
  )
  const xAxis = new Vector3(
    region.planeXAxis.x,
    region.planeXAxis.y,
    region.planeXAxis.z
  )
  const yAxis = new Vector3(
    region.planeYAxis.x,
    region.planeYAxis.y,
    region.planeYAxis.z
  )

  const positions = new Float32Array(points.length * 3)
  points.forEach((point, pointIndex) => {
    const worldPoint = origin
      .clone()
      .addScaledVector(xAxis, point.x)
      .addScaledVector(yAxis, point.y)
    const offset = pointIndex * 3
    positions[offset] = worldPoint.x
    positions[offset + 1] = worldPoint.y
    positions[offset + 2] = worldPoint.z
  })

  const indices = new Uint32Array(faces.length * 3)
  faces.forEach((face, faceIndex) => {
    const offset = faceIndex * 3
    indices[offset] = face[0]
    indices[offset + 1] = face[1]
    indices[offset + 2] = face[2]
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  return geometry
}

type ResolvedSelectionEntity = {
  entityId: string
  parentEntityId: string
  primitiveIndex: number
  entityType: 'face' | 'edge' | 'region'
}

type PacketPrimitiveUserData = {
  KITTYCAD: KittycadPrimitiveExtras
}

function toPoint3d(vector: Vector3) {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  }
}

function convertEngineWorldVectorToGltfWorld(
  vector: Vector3,
  scale = 1
): Vector3 {
  return new Vector3(vector.x * scale, vector.z * scale, -vector.y * scale)
}

function scalePoint3d(point: GetSketchModePlane['origin'], scale: number) {
  return {
    x: point.x * scale,
    y: point.y * scale,
    z: point.z * scale,
  }
}

function summarizeSketchModePlane(plane: GetSketchModePlane | null) {
  if (!plane) {
    return null
  }

  return {
    origin: [plane.origin.x, plane.origin.y, plane.origin.z],
    xAxis: [plane.x_axis.x, plane.x_axis.y, plane.x_axis.z],
    yAxis: [plane.y_axis.x, plane.y_axis.y, plane.y_axis.z],
    zAxis: [plane.z_axis.x, plane.z_axis.y, plane.z_axis.z],
  }
}

function summarizeMeshWorldGeometry(mesh: Mesh) {
  mesh.updateWorldMatrix(true, false)

  const positionAttribute = mesh.geometry.getAttribute('position')
  if (!positionAttribute || positionAttribute.count < 3) {
    return {
      meshWorldPosition: new Vector3().setFromMatrixPosition(mesh.matrixWorld),
      firstTriangleWorld: null,
    }
  }

  const indexAttribute = mesh.geometry.index
  const a = new Vector3()
    .fromBufferAttribute(
      positionAttribute,
      indexAttribute ? indexAttribute.getX(0) : 0
    )
    .applyMatrix4(mesh.matrixWorld)
  const b = new Vector3()
    .fromBufferAttribute(
      positionAttribute,
      indexAttribute ? indexAttribute.getX(1) : 1
    )
    .applyMatrix4(mesh.matrixWorld)
  const c = new Vector3()
    .fromBufferAttribute(
      positionAttribute,
      indexAttribute ? indexAttribute.getX(2) : 2
    )
    .applyMatrix4(mesh.matrixWorld)

  return {
    meshWorldPosition: new Vector3().setFromMatrixPosition(mesh.matrixWorld),
    indexed: Boolean(indexAttribute),
    firstTriangleWorld: [a.toArray(), b.toArray(), c.toArray()],
  }
}

function deriveSketchModePlaneFromMesh(
  mesh: Mesh,
  camera: PerspectiveCamera | OrthographicCamera | null
): GetSketchModePlane | null {
  mesh.updateWorldMatrix(true, false)

  const positionAttribute = mesh.geometry.getAttribute('position')
  if (!positionAttribute || positionAttribute.count < 3) {
    return null
  }
  const indexAttribute = mesh.geometry.index

  const centroid = new Vector3()
  const first = new Vector3()
  const second = new Vector3()
  const third = new Vector3()
  const edgeA = new Vector3()
  const edgeB = new Vector3()
  const normal = new Vector3()
  const yAxis = new Vector3()
  const xAxis = new Vector3()
  const viewDirection = new Vector3()
  const epsilon = 1e-10

  const referencedVertexIndices = indexAttribute
    ? Array.from({ length: indexAttribute.count }, (_, arrayIndex) =>
        indexAttribute.getX(arrayIndex)
      )
    : Array.from(
        { length: positionAttribute.count },
        (_, arrayIndex) => arrayIndex
      )

  if (referencedVertexIndices.length < 3) {
    return null
  }

  for (const vertexIndex of referencedVertexIndices) {
    centroid.add(
      first
        .fromBufferAttribute(positionAttribute, vertexIndex)
        .applyMatrix4(mesh.matrixWorld)
    )
  }
  centroid.multiplyScalar(1 / referencedVertexIndices.length)

  let foundNormal = false
  for (
    let referencedIndex = 0;
    referencedIndex <= referencedVertexIndices.length - 3;
    referencedIndex += 3
  ) {
    first
      .fromBufferAttribute(
        positionAttribute,
        referencedVertexIndices[referencedIndex]
      )
      .applyMatrix4(mesh.matrixWorld)
    second
      .fromBufferAttribute(
        positionAttribute,
        referencedVertexIndices[referencedIndex + 1]
      )
      .applyMatrix4(mesh.matrixWorld)
    third
      .fromBufferAttribute(
        positionAttribute,
        referencedVertexIndices[referencedIndex + 2]
      )
      .applyMatrix4(mesh.matrixWorld)

    edgeA.subVectors(second, first)
    edgeB.subVectors(third, first)
    normal.crossVectors(edgeA, edgeB)
    if (normal.lengthSq() > epsilon) {
      normal.normalize()
      foundNormal = true
      break
    }
  }

  if (!foundNormal) {
    return null
  }

  if (camera) {
    viewDirection.subVectors(camera.position, centroid)
    if (viewDirection.lengthSq() > epsilon && normal.dot(viewDirection) < 0) {
      normal.negate()
    }
    yAxis.copy(camera.up)
  } else {
    yAxis.set(0, 1, 0)
  }

  yAxis.projectOnPlane(normal)
  if (yAxis.lengthSq() <= epsilon) {
    yAxis.set(0, 0, 1).projectOnPlane(normal)
  }
  if (yAxis.lengthSq() <= epsilon) {
    yAxis.set(1, 0, 0).projectOnPlane(normal)
  }
  if (yAxis.lengthSq() <= epsilon) {
    return null
  }

  yAxis.normalize()
  xAxis.crossVectors(yAxis, normal).normalize()
  yAxis.crossVectors(normal, xAxis).normalize()

  return {
    origin: scalePoint3d(
      toPoint3d(centroid),
      GLTF_METERS_TO_ENGINE_MILLIMETERS
    ),
    x_axis: toPoint3d(xAxis),
    y_axis: toPoint3d(yAxis),
    z_axis: toPoint3d(normal),
  }
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
  parserState: GltfParserState | RenderPacketParserState | null
) {
  const primitiveExtrasFromUserData =
    object.userData?.gltfPrimitiveExtras &&
    typeof object.userData.gltfPrimitiveExtras === 'object' &&
    'KITTYCAD' in object.userData.gltfPrimitiveExtras
      ? object.userData.gltfPrimitiveExtras
      : null
  const kittycadPrimitiveExtrasFromUserData = isKittycadPrimitiveExtras(
    object.userData?.kittycadPrimitiveExtras
  )
    ? object.userData.kittycadPrimitiveExtras
    : null

  if (parserState && 'primitiveByObject' in parserState) {
    const primitive = parserState.primitiveByObject.get(object) ?? null
    const edge = parserState.edgeByObject.get(object) ?? null
    const sketch = parserState.sketchByObject.get(object) ?? null
    const region = parserState.regionByObject.get(object) ?? null
    return {
      association: primitive
        ? {
            meshes: 0,
            primitives: primitive.primitiveIndex,
          }
        : edge
          ? {
              edges: edge.edgeIndex,
            }
          : sketch
            ? {
                sketches: sketch.segmentIndex,
              }
            : region
              ? {
                  regions: region.regionId,
                }
              : null,
      primitiveExtras: primitiveExtrasFromUserData,
      meshExtras: null,
      nodeExtras: null,
      nodeIndex: null,
      kittycadPrimitiveExtras: kittycadPrimitiveExtrasFromUserData,
      kittycadEdgeExtras: isKittycadEdgeExtras(
        object.userData?.kittycadEdgeExtras
      )
        ? object.userData.kittycadEdgeExtras
        : edge
          ? {
              object_id: edge.objectId,
              body_id: edge.bodyId,
              edge_id: edge.edgeId,
              edge_index: edge.edgeIndex,
            }
          : null,
      kittycadSketchExtras: object.userData?.kittycadSketchExtras ?? null,
      kittycadRegionExtras: object.userData?.kittycadRegionExtras ?? null,
    }
  }

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
    kittycadPrimitiveExtrasFromUserData ??
    (primitiveExtras &&
    typeof primitiveExtras === 'object' &&
    'KITTYCAD' in primitiveExtras
      ? (primitiveExtras as Record<string, unknown>).KITTYCAD
      : null)

  return {
    association,
    primitiveExtras: primitiveExtras ?? primitiveExtrasFromUserData,
    meshExtras,
    nodeExtras,
    nodeIndex,
    kittycadPrimitiveExtras,
    kittycadEdgeExtras: isKittycadEdgeExtras(
      object.userData?.kittycadEdgeExtras
    )
      ? object.userData.kittycadEdgeExtras
      : null,
    kittycadSketchExtras: object.userData?.kittycadSketchExtras ?? null,
    kittycadRegionExtras: object.userData?.kittycadRegionExtras ?? null,
  }
}

function isKittycadPrimitiveExtras(
  value: unknown
): value is KittycadPrimitiveExtras {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as KittycadPrimitiveExtras).object_id === 'string' &&
    typeof (value as KittycadPrimitiveExtras).body_id === 'string' &&
    typeof (value as KittycadPrimitiveExtras).face_id === 'string' &&
    typeof (value as KittycadPrimitiveExtras).face_index === 'number' &&
    typeof (value as KittycadPrimitiveExtras).primitive_index === 'number'
  )
}

function isKittycadEdgeExtras(value: unknown): value is KittycadEdgeExtras {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as KittycadEdgeExtras).object_id === 'string' &&
    typeof (value as KittycadEdgeExtras).body_id === 'string' &&
    typeof (value as KittycadEdgeExtras).edge_id === 'string' &&
    typeof (value as KittycadEdgeExtras).edge_index === 'number'
  )
}

function isKittycadRegionExtras(value: unknown): value is KittycadRegionExtras {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as KittycadRegionExtras).sketch_id === 'string' &&
    typeof (value as KittycadRegionExtras).region_id === 'string' &&
    typeof (value as KittycadRegionExtras).parent_id === 'string' &&
    !!(value as KittycadRegionExtras).query_point &&
    typeof (value as KittycadRegionExtras).query_point.x === 'number' &&
    typeof (value as KittycadRegionExtras).query_point.y === 'number'
  )
}

function resolveSelectionEntityFromPrimitiveExtras(
  extras: KittycadPrimitiveExtras,
  artifactGraph: ArtifactGraph
): ResolvedSelectionEntity {
  const directArtifact = artifactGraph.get(extras.face_id)
  if (directArtifact) {
    if (directArtifact.type === 'primitiveFace') {
      return {
        entityId: directArtifact.id,
        parentEntityId: directArtifact.solidId,
        primitiveIndex: extras.primitive_index,
        entityType: 'face',
      }
    }

    if (
      directArtifact.type === 'wall' ||
      directArtifact.type === 'cap' ||
      directArtifact.type === 'edgeCut'
    ) {
      return {
        entityId: directArtifact.id,
        parentEntityId:
          'sweepId' in directArtifact &&
          typeof directArtifact.sweepId === 'string'
            ? directArtifact.sweepId
            : extras.object_id,
        primitiveIndex: extras.primitive_index,
        entityType: 'face',
      }
    }

    return {
      entityId: directArtifact.id,
      parentEntityId: extras.object_id,
      primitiveIndex: extras.primitive_index,
      entityType: 'face',
    }
  }

  const objectArtifact = artifactGraph.get(extras.object_id)
  const sweepArtifact =
    objectArtifact?.type === 'sweep'
      ? objectArtifact
      : objectArtifact?.type === 'path' && objectArtifact.sweepId
        ? artifactGraph.get(objectArtifact.sweepId)
        : null

  if (sweepArtifact?.type === 'sweep') {
    const surfaceEntityId =
      sweepArtifact.surfaceIds[extras.primitive_index] ??
      sweepArtifact.surfaceIds[extras.face_index]
    if (surfaceEntityId) {
      return {
        entityId: surfaceEntityId,
        parentEntityId: sweepArtifact.id,
        primitiveIndex: extras.primitive_index,
        entityType: 'face',
      }
    }
  }

  return {
    entityId: extras.face_id,
    parentEntityId: extras.object_id,
    primitiveIndex: extras.primitive_index,
    entityType: 'face',
  }
}

function resolveSelectionEntityFromEdgeExtras(
  extras: KittycadEdgeExtras,
  artifactGraph: ArtifactGraph
): ResolvedSelectionEntity {
  const directArtifact = artifactGraph.get(extras.edge_id)
  if (
    directArtifact?.type === 'primitiveEdge' ||
    directArtifact?.type === 'sweepEdge'
  ) {
    return {
      entityId: directArtifact.id,
      parentEntityId:
        directArtifact.type === 'primitiveEdge'
          ? directArtifact.solidId
          : directArtifact.sweepId,
      primitiveIndex: extras.edge_index,
      entityType: 'edge',
    }
  }

  return {
    entityId: extras.edge_id,
    parentEntityId: extras.object_id,
    primitiveIndex: extras.edge_index,
    entityType: 'edge',
  }
}

function isKittycadSketchExtras(value: unknown): value is KittycadSketchExtras {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as KittycadSketchExtras).sketch_id === 'string' &&
    ((value as KittycadSketchExtras).segment_id === null ||
      typeof (value as KittycadSketchExtras).segment_id === 'string') &&
    typeof (value as KittycadSketchExtras).segment_index === 'number' &&
    ((value as KittycadSketchExtras).hole_index === null ||
      typeof (value as KittycadSketchExtras).hole_index === 'number') &&
    typeof (value as KittycadSketchExtras).closed === 'boolean' &&
    ((value as KittycadSketchExtras).source_range === null ||
      isArray((value as KittycadSketchExtras).source_range)) &&
    ((value as KittycadSketchExtras).node_path === null ||
      isArray((value as KittycadSketchExtras).node_path))
  )
}

function resolveSelectionEntityFromSketchExtras(
  extras: KittycadSketchExtras,
  artifactGraph: ArtifactGraph
): ResolvedSelectionEntity | null {
  if (extras.node_path) {
    const artifactEntry = [...artifactGraph].find(([, artifact]) => {
      return (
        artifact.type === 'segment' &&
        JSON.stringify(artifact.codeRef.pathToNode) ===
          JSON.stringify(extras.node_path)
      )
    })
    if (artifactEntry?.[1].type === 'segment') {
      const artifact = artifactEntry[1]
      return {
        entityId: artifact.id,
        parentEntityId: artifact.pathId,
        primitiveIndex: extras.segment_index,
        entityType: 'edge',
      }
    }
  }

  if (extras.segment_id) {
    const artifact = artifactGraph.get(extras.segment_id)
    if (artifact?.type === 'segment') {
      return {
        entityId: artifact.id,
        parentEntityId: artifact.pathId,
        primitiveIndex: extras.segment_index,
        entityType: 'edge',
      }
    }
  }

  return null
}

function resolveSelectionEntityFromRegionExtras(
  extras: KittycadRegionExtras
): ResolvedSelectionEntity {
  return {
    entityId: extras.region_id,
    parentEntityId: extras.parent_id,
    primitiveIndex: -1,
    entityType: 'region',
  }
}

function setMeshHighlight(
  mesh: Mesh | null,
  mode: 'base' | 'hover' | 'selected'
) {
  if (!mesh) {
    return
  }

  const regionExtras = isKittycadRegionExtras(
    mesh.userData?.kittycadRegionExtras
  )
    ? mesh.userData.kittycadRegionExtras
    : null
  if (regionExtras) {
    const material =
      mesh.material instanceof MeshBasicMaterial ? mesh.material : null
    if (!material) {
      return
    }

    if (mode === 'selected') {
      material.color.copy(SELECTED_COLOR)
      material.opacity = 0.34
    } else if (mode === 'hover') {
      material.color.copy(HOVER_COLOR)
      material.opacity = 0.22
    } else {
      material.color.set(0xffffff)
      material.opacity = 0
    }
    material.needsUpdate = true
    return
  }

  for (const material of getPreviewMaterials(mesh)) {
    const nextColor =
      previewMaterialBaseColors.get(material)?.clone() ??
      ENGINE_DEFAULT_SURFACE_COLOR.clone()
    if (mode === 'selected') {
      nextColor.lerp(SELECTED_COLOR, 0.72)
    } else if (mode === 'hover') {
      nextColor.lerp(HOVER_COLOR, 0.5)
    }
    material.color.copy(nextColor)
  }
}

function setLineHighlight(
  line: Line | null,
  mode: 'base' | 'hover' | 'selected'
) {
  if (!line || !(line.material instanceof LineBasicMaterial)) {
    return
  }

  const nextColor = new Color('#f2f3f5')
  if (mode === 'selected') {
    nextColor.copy(SELECTED_COLOR)
  } else if (mode === 'hover') {
    nextColor.copy(HOVER_COLOR)
  }

  line.material.color.copy(nextColor)
  line.material.opacity = mode === 'base' ? 0.95 : 1
}

function summarizePickedObject(
  object: Object3D,
  parserState: GltfParserState | RenderPacketParserState | null,
  resolvedSelectionEntity: ResolvedSelectionEntity | null = null
) {
  const parentChain: string[] = []
  const associationChain: Array<PreviewAssociation | null> = []
  const associations =
    parserState && 'associations' in parserState
      ? parserState.associations
      : null
  let current: Object3D | null = object
  while (current && parentChain.length < 4) {
    parentChain.push(current.name || current.type)
    associationChain.push(
      summarizeAssociation(associations?.get(current) ?? null)
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
    kittycadEdgeExtras: metadata.kittycadEdgeExtras,
    kittycadRegionExtras: metadata.kittycadRegionExtras,
    resolvedSelectionEntity,
    userData: Object.fromEntries(userDataEntries),
    userDataKeys: Object.keys(object.userData ?? {}),
  }
}
