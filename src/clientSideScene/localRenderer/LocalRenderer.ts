import type { GetSketchModePlane } from '@kittycad/lib'
import { LOCAL_WEBGPU_RENDERING_ENABLED } from '@src/clientSideScene/localRenderer/config'
import { EdgeRenderer } from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { EnvMapLoader } from '@src/clientSideScene/localRenderer/EnvMapLoader'
import {
  IntegerIdPicker,
  type IntegerIdPickerGeometryStats,
  type IntegerIdPickSource,
  type IntegerIdPickTarget,
} from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import { HDR_ENV_MAP_URL } from '@src/clientSideScene/localRenderer/maps'
import {
  decodeRenderPacket,
  type LocalRenderPacket,
  type LocalRenderPacketEdge,
  type LocalRenderPacketPrimitive,
  type LocalRenderPacketRegion,
  type LocalRenderPacketSketchSegment,
} from '@src/clientSideScene/localRenderer/renderPacketBinary'
import {
  createWebGpuSurfaceResources,
  type WebGpuSurfaceResources,
} from '@src/clientSideScene/localRenderer/webgpuTrim'
import { registerLocalSelectionCommandProvider } from '@src/clientSideScene/localSelectionCommandProxy'
import type { KclExecutionDoneDetail, KclManager } from '@src/lang/KclManager'
import { KclManagerEvents } from '@src/lang/KclManager'
import type { ArtifactGraph } from '@src/lang/wasm'
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
  Scene,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three'
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js'
import { pass, vec3, vec4 } from 'three/tsl'
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'

const WEBGPU_PORT_DEBUG_STORAGE_KEY = 'webgpu-port-debug'
const WEBGPU_PORT_LOG_PREFIX = '[WEBGPU_POC]'
const WEBGPU_TRIMMING_ENABLED = true
const GLTF_METERS_TO_ENGINE_MILLIMETERS = 1000
const ENGINE_MILLIMETERS_TO_GLTF_METERS = 1 / GLTF_METERS_TO_ENGINE_MILLIMETERS
const ENGINE_DEFAULT_SURFACE_COLOR = new Color(0.9, 0.9, 0.9)
const HOVER_COLOR = new Color(SKETCH_HIGHLIGHT_COLOR)
const SELECTED_COLOR = new Color(SKETCH_SELECTION_COLOR)
const previewMaterialBaseColors = new WeakMap<Material, Color>()

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
type DisposableGpuDevice = {
  destroy: () => void
}
type RenderPacketSelectionSource = IntegerIdPickSource
type RenderPacketSelectionEntry = IntegerIdPickTarget
type RenderPacketModelIndex = {
  packet: LocalRenderPacket
  selectionEntries: RenderPacketSelectionEntry[]
  previewObjects: WeakSet<Object3D>
  regionObjects: WeakSet<Object3D>
  surfaceObjects: Mesh[]
  pickingGeometryStats: IntegerIdPickerGeometryStats
}
type SelectionTarget = RenderPacketSelectionEntry & {
  entity: ResolvedSelectionEntity
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
  private renderer: WebGPURenderer | null = null
  private device: DisposableGpuDevice | null = null
  private scene: Scene | null = null
  private envMapLoader: EnvMapLoader | null = null
  private edgeRenderer: EdgeRenderer | null = null
  private integerIdPicker: IntegerIdPicker | null = null
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
  private selectionTargetByEntityId = new Map<string, SelectionTarget>()
  private modelIndex: RenderPacketModelIndex | null = null
  private activeSketchModePlane: GetSketchModePlane | null = null
  private unregisterLocalSelectionProvider: (() => void) | null = null
  private unregisterSharedCameraListener: (() => void) | null = null
  private ambientOcclusionRadius = 0.01
  private ambientOcclusionPipeline: AmbientOcclusionPipeline | null = null
  private currentRefreshId = 0
  private pendingRefreshRequest = false
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
      this.scheduleRender()
    }
  }

  setEnableSSAO(enableSSAO: boolean) {
    this.enableSSAO = enableSSAO
    this.scheduleRender()
  }

  setHighlightEdges(highlightEdges: boolean) {
    if (this.highlightEdges === highlightEdges) {
      return
    }

    this.highlightEdges = highlightEdges
    this.edgeRenderer?.setVisible(highlightEdges)
    this.integerIdPicker?.setEdgesVisible(highlightEdges)
    this.scheduleRender()
  }

  setForceHide(forceHide: boolean) {
    this.forceHide = forceHide
    this.container.style.opacity = this.isVisible && !this.forceHide ? '1' : '0'
    this.scheduleRender()
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
    if (this.renderer && !this.disposed) {
      this.onExportReady?.(this.exportCurrentScene)
    }
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.currentRefreshId += 1
    this.kclManager.removeEventListener(
      KclManagerEvents.ExecutionDone,
      this.onExecutionDone
    )
    this.container.style.opacity = '0'
    this.isVisible = false
    this.onExportReady?.(null)
    this.unregisterLocalSelectionProvider?.()
    this.unregisterLocalSelectionProvider = null
    this.unregisterSharedCameraListener?.()
    this.unregisterSharedCameraListener = null
    this.clearHover()
    const previousSelectedObjects = [...this.selectedObjects]
    this.selectedObjects.clear()
    for (const object of previousSelectedObjects) {
      this.applyObjectState(object)
    }
    this.clearModel()
    this.edgeRenderer?.dispose()
    this.edgeRenderer = null
    this.integerIdPicker?.dispose()
    this.integerIdPicker = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.animationFrameId !== -1) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = -1
    }
    this.disposeAmbientOcclusionPipeline()
    this.envMapLoader?.dispose()
    this.envMapLoader = null
    this.renderer?.domElement.remove()
    this.renderer?.dispose()
    this.renderer = null
    this.device?.destroy()
    this.device = null
    this.scene = null
    this.previewCamera = null
    this.modelIndex = null
    this.activeSketchModePlane = null
  }

  private getSelectionTarget(target: IntegerIdPickTarget | null | undefined) {
    if (!target || !this.modelIndex) {
      return null
    }

    const entity = resolveSelectionEntity(
      target.source,
      this.modelIndex.packet,
      this.kclManager.artifactGraph
    )
    return entity ? { ...target, entity } : null
  }

  private setVisible(nextVisible: boolean) {
    if (this.isVisible === nextVisible) {
      return
    }

    this.isVisible = nextVisible
    this.container.style.opacity = nextVisible && !this.forceHide ? '1' : '0'
    this.onVisibilityChange(nextVisible)
    this.scheduleRender()
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
    this.integerIdPicker?.invalidate()
    this.scheduleRender()
  }

  private applyObjectState(object: Object3D | null) {
    if (!object) {
      return
    }

    const mode = this.selectedObjects.has(object)
      ? 'selected'
      : object === this.hoveredObject
        ? 'hover'
        : 'base'
    if (object instanceof Mesh) {
      setMeshHighlight(
        object,
        mode,
        this.modelIndex?.regionObjects.has(object) ?? false
      )
    } else if (object instanceof Line) {
      setLineHighlight(object, mode)
    }
    this.scheduleRender()
  }

  private clearHover() {
    if (!this.hoveredObject) {
      return
    }

    const previousHoveredObject = this.hoveredObject
    this.hoveredObject = null
    this.applyObjectState(previousHoveredObject)
  }

  private async pickRenderableFromWindowCoordinates({
    x,
    y,
    streamWidth,
    streamHeight,
  }: {
    x: number
    y: number
    streamWidth: number
    streamHeight: number
  }) {
    if (
      !this.isVisible ||
      !this.previewCamera ||
      !this.currentModel ||
      !this.integerIdPicker ||
      streamWidth <= 0 ||
      streamHeight <= 0
    ) {
      return null
    }

    return this.integerIdPicker.pick({
      x,
      y,
      streamWidth,
      streamHeight,
      camera: this.previewCamera,
    })
  }

  private updateHoverFromTarget(
    target: IntegerIdPickTarget | null | undefined
  ) {
    const nextHoveredObject = target?.object ?? null
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
  }

  private updateSelectedMeshes({
    nextSelectedMeshes,
    selectionSummary,
  }: {
    nextSelectedMeshes: Set<Object3D>
    selectionSummary: unknown
  }) {
    if (
      nextSelectedMeshes.size === this.selectedObjects.size &&
      [...nextSelectedMeshes].every((mesh) => this.selectedObjects.has(mesh))
    ) {
      return
    }

    const previousSelectedMeshes = [...this.selectedObjects]
    this.selectedObjects = nextSelectedMeshes
    for (const object of previousSelectedMeshes) {
      this.applyObjectState(object)
    }
    this.applyObjectState(this.hoveredObject)
    for (const object of this.selectedObjects) {
      this.applyObjectState(object)
    }
    ;(
      window as typeof window & { __WEBGPU_POC_SELECTION__?: unknown }
    ).__WEBGPU_POC_SELECTION__ = selectionSummary
  }

  private readonly exportCurrentScene = async () => {
    if (!this.currentModel) {
      return
    }

    const modelToExport = this.currentModel
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
    const scene = this.scene
    if (!previewCamera || !renderer || !scene) {
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
      const scenePass = pass(scene, previewCamera, {
        samples: 0,
      })
      const scenePassColor = scenePass.getTextureNode()
      const scenePassDepth = scenePass.getTextureNode('depth')
      const aoPass = (ao as CreateAmbientOcclusion)(
        scenePassDepth,
        null,
        previewCamera
      )
      aoPass.resolutionScale = 0.5
      this.configureAmbientOcclusion(aoPass)

      const pipeline = new RenderPipeline(renderer)
      const aoOutput = aoPass.getTextureNode()
      // Preserve some indirect light even at maximum occlusion while leaving
      // enough contrast to make the setting visibly effective.
      const ambientOcclusion = aoOutput.r.mul(0.8).add(0.2)
      pipeline.outputNode = scenePassColor.mul(vec4(vec3(ambientOcclusion), 1))

      this.ambientOcclusionPipeline = {
        camera: previewCamera,
        pipeline,
        scenePass,
        aoPass,
      }
    }

    this.ambientOcclusionPipeline.pipeline.render()
  }

  private scheduleRender() {
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
    this.integerIdPicker?.invalidate()
    this.scheduleRender()
  }

  private clearModel() {
    this.integerIdPicker?.clearModel()
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
    this.modelIndex = null
    this.selectionTargetByEntityId.clear()
    this.scheduleRender()
  }

  private indexCurrentModelForSelection() {
    const modelIndex = this.modelIndex
    if (!this.currentModel || !modelIndex) {
      this.selectionTargetByEntityId.clear()
      return
    }

    this.selectionTargetByEntityId = new Map<string, SelectionTarget>()
    this.currentModel.traverse((object) => {
      object.layers.mask = this.previewCamera?.layers.mask ?? object.layers.mask
    })

    for (const entry of modelIndex.selectionEntries) {
      const entity = resolveSelectionEntity(
        entry.source,
        modelIndex.packet,
        this.kclManager.artifactGraph
      )
      if (!entity) {
        continue
      }

      const target = { ...entry, entity }
      this.selectionTargetByEntityId.set(entity.entityId, target)
      const packetEntityId = getPacketEntityId(entry.source, modelIndex.packet)
      if (packetEntityId) {
        this.selectionTargetByEntityId.set(packetEntityId, target)
      }
    }
  }

  private async refreshModel() {
    if (this.disposed) {
      return
    }

    const edgeRenderer = this.edgeRenderer
    const scene = this.scene
    if (!edgeRenderer || !scene) {
      this.pendingRefreshRequest = true
      return
    }

    this.pendingRefreshRequest = false
    const refreshId = ++this.currentRefreshId
    await this.kclManager.rustContext.waitForAllEngineModelingCommands()

    if (this.disposed || refreshId !== this.currentRefreshId) {
      return
    }

    const exportSettings = jsAppSettings(
      this.kclManager.rustContext.settingsActor
    )
    let renderPacket: LocalRenderPacket | undefined
    const maxRenderPacketAttempts = 3
    for (let attempt = 1; attempt <= maxRenderPacketAttempts; attempt++) {
      renderPacket = undefined
      const encodedRenderPacket: RenderPacket | undefined =
        await this.kclManager.rustContext.exportRenderPacket(exportSettings)

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
        return
      }

      if (
        renderPacket &&
        (renderPacket.primitives.length > 0 || renderPacket.edges.length > 0)
      ) {
        break
      }

      if (attempt < maxRenderPacketAttempts) {
        await new Promise((resolve) => window.setTimeout(resolve, 150))
      }
    }

    if (this.disposed || refreshId !== this.currentRefreshId) {
      return
    }

    if (
      renderPacket &&
      (renderPacket.primitives.length > 0 || renderPacket.edges.length > 0)
    ) {
      this.clearModel()
      const surfaceResources = createWebGpuSurfaceResources(
        renderPacket.primitives,
        renderPacket.bodyMaterials ?? [],
        WEBGPU_TRIMMING_ENABLED
      )
      this.currentSurfaceResources = surfaceResources
      const packetModel = buildRenderPacketModel(
        renderPacket,
        surfaceResources,
        edgeRenderer
      )
      this.currentModel = packetModel.model
      this.updateAmbientOcclusionScale(packetModel.modelBounds)
      this.modelIndex = packetModel.modelIndex
      this.indexCurrentModelForSelection()
      scene.add(this.currentModel)
      this.integerIdPicker?.setModel({
        packet: renderPacket,
        targets: packetModel.modelIndex.selectionEntries,
        surfaceObjects: packetModel.modelIndex.surfaceObjects,
        edgeLines: edgeRenderer.lines,
        geometryStats: packetModel.modelIndex.pickingGeometryStats,
      })
      const loadedModelStats = prepareLoadedModelForPreview(
        this.currentModel,
        packetModel.modelIndex
      )
      console.info(
        `${WEBGPU_PORT_LOG_PREFIX}[LocalWebGPUScene] render packet trim stats`,
        summarizeRenderPacketTrimModes(renderPacket.primitives)
      )
      if (loadedModelStats.meshCount === 0) {
        this.clearModel()
        this.setVisible(false)
        return
      }
      this.syncPreviewCameraFromShared()
      this.setVisible(true)
      this.scheduleRender()
      return
    }

    logLocalWebGpuPreview('render packet unavailable; keeping stream active', {
      refreshId,
    })
    this.clearModel()
    this.setVisible(false)
    this.scheduleRender()
  }

  private async initialize() {
    const { kclManager } = this
    const { container } = this

    const hasNavigatorGpu = typeof navigator !== 'undefined' && !!navigator.gpu
    if (!hasNavigatorGpu) {
      logLocalWebGpuPreview('WebGPU unavailable', {
        isSecureContext: window.isSecureContext,
      })
      this.setVisible(false)
      return
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    })
    if (!adapter) {
      logLocalWebGpuPreview('WebGPU adapter request failed')
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
    if (this.disposed) {
      device.destroy()
      return
    }

    const renderer = new WebGPURenderer({
      antialias: true,
      alpha: false,
      device,
    })
    await renderer.init()
    if (this.disposed) {
      renderer.dispose()
      device.destroy()
      return
    }
    renderer.toneMapping = NeutralToneMapping
    renderer.toneMappingExposure = 1
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.domElement.className =
      'absolute inset-0 z-20 h-full w-full pointer-events-none'
    container.appendChild(renderer.domElement)

    const scene = new Scene()
    this.scene = scene
    scene.background = new Color(this.backgroundColor)
    const envMapLoader = new EnvMapLoader(renderer, device)
    const hdrEnvMapUrl = HDR_ENV_MAP_URL?.trim()
    if (hdrEnvMapUrl) {
      try {
        await envMapLoader.loadHdr(scene, hdrEnvMapUrl)
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
      device.destroy()
      this.scene = null
      return
    }

    const edgeRenderer = new EdgeRenderer(
      this.backgroundColor,
      this.highlightEdges
    )
    this.edgeRenderer = edgeRenderer
    this.integerIdPicker = new IntegerIdPicker(renderer)
    this.integerIdPicker.setEdgesVisible(this.highlightEdges)

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
    this.unregisterSharedCameraListener =
      kclManager.sceneInfra.camControls.cameraChange.add(
        this.syncPreviewCameraFromShared
      )

    this.renderer = renderer
    this.device = device
    this.envMapLoader = envMapLoader

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
              const pickStartedAt = performance.now()
              const pickResult = await this.pickRenderableFromWindowCoordinates(
                {
                  x: cmd.selected_at_window.x,
                  y: cmd.selected_at_window.y,
                  streamWidth: streamDimensions.width,
                  streamHeight: streamDimensions.height,
                }
              )
              const pickDurationMs = performance.now() - pickStartedAt
              const pickTarget = pickResult?.target ?? null
              this.updateHoverFromTarget(pickTarget)
              const selectionTarget = this.getSelectionTarget(pickTarget)
              console.info(
                `${WEBGPU_PORT_LOG_PREFIX}[LocalWebGPUScene] hover ID pick`,
                {
                  entity: selectionTarget?.entity ?? null,
                  pickDurationMs,
                  ...(pickResult?.diagnostics ?? {}),
                }
              )
              return {
                unreliableModelingResponse: {
                  type: 'highlight_set_entity',
                  data: {
                    entity_id: selectionTarget?.entity.entityId ?? '',
                    sequence: 'sequence' in cmd ? cmd.sequence : undefined,
                  },
                },
              }
            }
            case 'select_with_point': {
              if (!this.commandProxyEnabled) {
                return null
              }
              const pickStartedAt = performance.now()
              const pickResult = await this.pickRenderableFromWindowCoordinates(
                {
                  x: cmd.selected_at_window.x,
                  y: cmd.selected_at_window.y,
                  streamWidth: streamDimensions.width,
                  streamHeight: streamDimensions.height,
                }
              )
              const pickDurationMs = performance.now() - pickStartedAt
              const pickTarget = pickResult?.target ?? null
              const selectionTarget = this.getSelectionTarget(pickTarget)
              console.info(
                `${WEBGPU_PORT_LOG_PREFIX}[LocalWebGPUScene] selection ID pick`,
                {
                  entity: selectionTarget?.entity ?? null,
                  pickDurationMs,
                  ...(pickResult?.diagnostics ?? {}),
                }
              )
              const modelingResponse = {
                type: 'select_with_point',
                data: {
                  entity_id: selectionTarget?.entity.entityId ?? '',
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
              const selectionTarget = this.selectionTargetByEntityId.get(
                cmd.entity_id
              )
              const modelingResponse = {
                type: 'entity_get_parent_id',
                data: {
                  entity_id: selectionTarget?.entity.parentEntityId ?? '',
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
              const selectionTarget = this.selectionTargetByEntityId.get(
                cmd.entity_id
              )
              const modelingResponse = {
                type: 'entity_get_primitive_index',
                data: {
                  entity_type: selectionTarget?.entity.entityType ?? 'face',
                  primitive_index: selectionTarget?.entity.primitiveIndex ?? -1,
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
              const selectionTarget = this.selectionTargetByEntityId.get(
                cmd.region_id
              )
              const region =
                selectionTarget?.source.type === 'region' && this.modelIndex
                  ? this.modelIndex.packet.regions[
                      selectionTarget.source.packetIndex
                    ]
                  : null
              const modelingResponse = {
                type: 'region_get_query_point',
                data: {
                  query_point: region?.queryPoint ?? { x: 0, y: 0 },
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
              let firstSelectionTarget: SelectionTarget | null = null
              for (const entityId of cmd.entities) {
                const selectionTarget =
                  this.selectionTargetByEntityId.get(entityId)
                if (selectionTarget) {
                  firstSelectionTarget ??= selectionTarget
                  nextSelectedMeshes.add(selectionTarget.object)
                }
              }
              this.updateSelectedMeshes({
                nextSelectedMeshes,
                selectionSummary: firstSelectionTarget
                  ? summarizeSelectionTarget(firstSelectionTarget)
                  : null,
              })
              return { websocketResponse: null }
            }
            case 'enable_sketch_mode': {
              const selectionTarget =
                this.selectionTargetByEntityId.get(cmd.entity_id) ?? null
              const mesh = selectionTarget?.object ?? null
              if (!mesh) {
                logLocalWebGpuPreview('local sketch mode plane mesh missing', {
                  entityId: cmd.entity_id,
                  knownSelectionEntityIds: Array.from(
                    this.selectionTargetByEntityId.keys()
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
                kclManager.sceneInfra.camControls.camera,
                selectionTarget?.source.type === 'primitive' && this.modelIndex
                  ? this.modelIndex.packet.primitives[
                      selectionTarget.source.packetIndex
                    ]
                  : null
              )
              if (!this.activeSketchModePlane) {
                logLocalWebGpuPreview(
                  'local sketch mode plane derivation failed',
                  {
                    entityId: cmd.entity_id,
                    meshName: mesh.name || null,
                    meshType: mesh.type,
                    selectionTarget: selectionTarget
                      ? summarizeSelectionTarget(selectionTarget)
                      : null,
                  }
                )
                return null
              }
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

    this.scheduleRender()

    if (kclManager.lastSuccessfulCode) {
      await this.refreshModel()
    } else if (this.pendingRefreshRequest) {
      this.pendingRefreshRequest = false
      await this.refreshModel()
    }
  }

  private readonly onExecutionDone = (event: Event) => {
    const { detail } = event as CustomEvent<KclExecutionDoneDetail>
    if (!detail.successful) {
      logLocalWebGpuPreview('KCL execution failed', detail)
      return
    }

    void this.refreshModel()
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
  const selectionEntries: RenderPacketSelectionEntry[] = []
  const previewObjects = new WeakSet<Object3D>()
  const regionObjects = new WeakSet<Object3D>()
  const surfaceObjects: Mesh[] = []
  let regionTriangleCount = 0

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

  surfaceResources.batches.forEach((batch, batchIndex) => {
    if (batch.primitiveOffsets.length === 0) {
      return
    }

    const mesh = new Mesh(
      createSurfaceGeometry(batch.primitiveOffsets),
      batch.material
    )
    mesh.name = `surface_batch_${batchIndex}`
    mesh.renderOrder = batch.transparent ? 1 : 0
    surfaceObjects.push(mesh)
    previewObjects.add(mesh)
    for (const packetIndex of batch.primitiveOffsets) {
      selectionEntries.push({
        object: mesh,
        source: { type: 'primitive', packetIndex },
      })
    }
    root.add(mesh)
  })

  surfaceResources.complexSurfaces.forEach((surface) => {
    const primitive = packet.primitives[surface.primitiveOffset]
    const mesh = new Mesh(
      createSurfaceGeometry([surface.primitiveOffset]),
      surface.material
    )
    mesh.name = `complex_surface_${primitive.primitiveIndex}`
    mesh.renderOrder = surface.material.transparent ? 1 : 0
    surfaceObjects.push(mesh)
    previewObjects.add(mesh)
    selectionEntries.push({
      object: mesh,
      source: { type: 'primitive', packetIndex: surface.primitiveOffset },
    })
    root.add(mesh)
  })

  for (const { packetIndex, object } of edgeRenderer.setEdges(packet.edges)) {
    const source = { type: 'edge', packetIndex } as const
    selectionEntries.push({ object, source })
  }
  edgeRenderer.addTo(root)
  previewObjects.add(edgeRenderer.lines)

  packet.sketches.forEach((segment, packetIndex) => {
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
    line.renderOrder = 3
    const source = { type: 'sketch', packetIndex } as const
    selectionEntries.push({ object: line, source })
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
    mesh.renderOrder = 3
    const source = { type: 'region', packetIndex: regionIndex } as const
    selectionEntries.push({ object: mesh, source })
    previewObjects.add(mesh)
    regionObjects.add(mesh)
    regionTriangleCount += geometry.index?.count
      ? geometry.index.count / 3
      : geometry.getAttribute('position').count / 3
    root.add(mesh)
  })

  const edgeSegmentCount = packet.edges.reduce(
    (count, edge) =>
      count + Math.max(0, Math.floor(edge.positions.length / 3) - 1),
    0
  )
  const trimLoops = packet.primitives.flatMap((primitive) =>
    primitive.trimLoops.filter((loop) => loop.positions.length >= 6)
  )

  return {
    model: root,
    modelIndex: {
      packet,
      selectionEntries,
      previewObjects,
      regionObjects,
      surfaceObjects,
      pickingGeometryStats: {
        vertexCount: packet.vertices.byteLength / packet.vertexLayout.stride,
        faceCount: packet.primitives.length,
        faceTriangleCount:
          packet.primitives.reduce(
            (count, primitive) => count + primitive.indexCount,
            0
          ) / 3,
        surfaceMeshCount: surfaceObjects.length,
        edgeCount: packet.edges.length,
        edgeSegmentCount,
        sketchCount: packet.sketches.length,
        sketchSegmentCount: packet.sketches.reduce(
          (count, sketch) =>
            count + Math.max(0, Math.floor(sketch.positions.length / 3) - 1),
          0
        ),
        regionCount: packet.regions.length,
        regionTriangleCount,
        trimmedFaceCount: packet.primitives.filter(
          (primitive) => primitive.trimLoops.length > 0
        ).length,
        trimLoopCount: trimLoops.length,
        trimPointCount: trimLoops.reduce(
          (count, loop) => count + loop.positions.length / 2,
          0
        ),
        vertexBufferBytes: packet.vertices.byteLength,
        indexBufferBytes: packet.indices.byteLength,
        primitiveIndexBufferBytes: packet.primitiveIndices.byteLength,
        edgeSegmentBufferBytes:
          edgeSegmentCount * 2 * 3 * Float32Array.BYTES_PER_ELEMENT,
        trimPointBufferBytes: trimLoops.reduce(
          (bytes, loop) => bytes + loop.positions.byteLength,
          0
        ),
      },
    } satisfies RenderPacketModelIndex,
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

function prepareLoadedModelForPreview(
  root: Object3D,
  modelIndex: RenderPacketModelIndex
) {
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
    if (modelIndex.previewObjects.has(object)) {
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

function deriveSketchModePlaneFromMesh(
  mesh: Mesh,
  camera: PerspectiveCamera | OrthographicCamera | null,
  primitive: LocalRenderPacketPrimitive | null
): GetSketchModePlane | null {
  mesh.updateWorldMatrix(true, false)

  const positionAttribute = mesh.geometry.getAttribute('position')
  if (!positionAttribute || positionAttribute.count < 3) {
    return null
  }
  const indexAttribute = mesh.geometry.index
  const primitiveIndexAttribute = mesh.geometry.getAttribute('primitiveIndex')
  if (primitive && !primitiveIndexAttribute) {
    return null
  }

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

  const allReferencedVertexIndices = indexAttribute
    ? Array.from({ length: indexAttribute.count }, (_, arrayIndex) =>
        indexAttribute.getX(arrayIndex)
      )
    : Array.from(
        { length: positionAttribute.count },
        (_, arrayIndex) => arrayIndex
      )
  const referencedVertexIndices = primitive
    ? allReferencedVertexIndices.filter(
        (vertexIndex) =>
          primitiveIndexAttribute?.getX(vertexIndex) ===
          primitive.primitiveIndex
      )
    : allReferencedVertexIndices

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

function getPacketEntityId(
  source: RenderPacketSelectionSource,
  packet: LocalRenderPacket
) {
  switch (source.type) {
    case 'primitive':
      return packet.primitives[source.packetIndex]?.faceId ?? null
    case 'edge':
      return packet.edges[source.packetIndex]?.edgeId ?? null
    case 'sketch':
      return packet.sketches[source.packetIndex]?.segmentId ?? null
    case 'region':
      return packet.regions[source.packetIndex]?.regionId ?? null
  }
}

function resolveSelectionEntity(
  source: RenderPacketSelectionSource,
  packet: LocalRenderPacket,
  artifactGraph: ArtifactGraph
) {
  switch (source.type) {
    case 'primitive': {
      const primitive = packet.primitives[source.packetIndex]
      return primitive
        ? resolveSelectionEntityFromPrimitive(primitive, artifactGraph)
        : null
    }
    case 'edge': {
      const edge = packet.edges[source.packetIndex]
      return edge ? resolveSelectionEntityFromEdge(edge, artifactGraph) : null
    }
    case 'sketch': {
      const sketch = packet.sketches[source.packetIndex]
      return sketch
        ? resolveSelectionEntityFromSketch(sketch, artifactGraph)
        : null
    }
    case 'region': {
      const region = packet.regions[source.packetIndex]
      return region ? resolveSelectionEntityFromRegion(region) : null
    }
  }
}

function resolveSelectionEntityFromPrimitive(
  primitive: LocalRenderPacketPrimitive,
  artifactGraph: ArtifactGraph
): ResolvedSelectionEntity {
  const directArtifact = artifactGraph.get(primitive.faceId)
  if (directArtifact) {
    if (directArtifact.type === 'primitiveFace') {
      return {
        entityId: directArtifact.id,
        parentEntityId: directArtifact.solidId,
        primitiveIndex: primitive.primitiveIndex,
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
            : primitive.objectId,
        primitiveIndex: primitive.primitiveIndex,
        entityType: 'face',
      }
    }

    return {
      entityId: directArtifact.id,
      parentEntityId: primitive.objectId,
      primitiveIndex: primitive.primitiveIndex,
      entityType: 'face',
    }
  }

  const objectArtifact = artifactGraph.get(primitive.objectId)
  const sweepArtifact =
    objectArtifact?.type === 'sweep'
      ? objectArtifact
      : objectArtifact?.type === 'path' && objectArtifact.sweepId
        ? artifactGraph.get(objectArtifact.sweepId)
        : null

  if (sweepArtifact?.type === 'sweep') {
    const surfaceEntityId =
      sweepArtifact.surfaceIds[primitive.primitiveIndex] ??
      sweepArtifact.surfaceIds[primitive.faceIndex]
    if (surfaceEntityId) {
      return {
        entityId: surfaceEntityId,
        parentEntityId: sweepArtifact.id,
        primitiveIndex: primitive.primitiveIndex,
        entityType: 'face',
      }
    }
  }

  return {
    entityId: primitive.faceId,
    parentEntityId: primitive.objectId,
    primitiveIndex: primitive.primitiveIndex,
    entityType: 'face',
  }
}

function resolveSelectionEntityFromEdge(
  edge: LocalRenderPacketEdge,
  artifactGraph: ArtifactGraph
): ResolvedSelectionEntity {
  const directArtifact = artifactGraph.get(edge.edgeId)
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
      primitiveIndex: edge.edgeIndex,
      entityType: 'edge',
    }
  }

  return {
    entityId: edge.edgeId,
    parentEntityId: edge.objectId,
    primitiveIndex: edge.edgeIndex,
    entityType: 'edge',
  }
}

function resolveSelectionEntityFromSketch(
  sketch: LocalRenderPacketSketchSegment,
  artifactGraph: ArtifactGraph
): ResolvedSelectionEntity | null {
  const nodePath = sketch.nodePath
    ? pathToNodeFromRustNodePath(sketch.nodePath)
    : null
  if (nodePath) {
    const artifactEntry = [...artifactGraph].find(([, artifact]) => {
      return (
        artifact.type === 'segment' &&
        JSON.stringify(artifact.codeRef.pathToNode) === JSON.stringify(nodePath)
      )
    })
    if (artifactEntry?.[1].type === 'segment') {
      const artifact = artifactEntry[1]
      return {
        entityId: artifact.id,
        parentEntityId: artifact.pathId,
        primitiveIndex: sketch.segmentIndex,
        entityType: 'edge',
      }
    }
  }

  if (sketch.segmentId) {
    const artifact = artifactGraph.get(sketch.segmentId)
    if (artifact?.type === 'segment') {
      return {
        entityId: artifact.id,
        parentEntityId: artifact.pathId,
        primitiveIndex: sketch.segmentIndex,
        entityType: 'edge',
      }
    }
  }

  return null
}

function resolveSelectionEntityFromRegion(
  region: LocalRenderPacketRegion
): ResolvedSelectionEntity {
  return {
    entityId: region.regionId,
    parentEntityId: region.parentId,
    primitiveIndex: -1,
    entityType: 'region',
  }
}

function setMeshHighlight(
  mesh: Mesh | null,
  mode: 'base' | 'hover' | 'selected',
  isRegion: boolean
) {
  if (!mesh) {
    return
  }

  if (isRegion) {
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

function summarizeSelectionTarget(target: SelectionTarget) {
  const parentChain: string[] = []
  let current: Object3D | null = target.object
  while (current && parentChain.length < 4) {
    parentChain.push(current.name || current.type)
    current = current.parent
  }

  return {
    type: target.object.type,
    name: target.object.name || null,
    parentChain,
    source: target.source,
    entity: target.entity,
  }
}
