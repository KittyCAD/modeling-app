import type { OkModelingCmdResponse } from '@kittycad/lib'
import {
  registerLocalSelectionCommandProvider,
  type LocalSelectionCommandProvider,
} from '@src/clientSideScene/localSelectionCommandProxy'
import {
  LOCAL_WEBGPU_GTAO_SAMPLES,
  LOCAL_WEBGPU_GTAO_USE_DENOISE,
  LOCAL_WEBGPU_GTAO_USE_NORMAL_MRT,
} from '@src/clientSideScene/localRenderer/config'
import { EdgeRenderer } from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { PlaneRenderer } from '@src/clientSideScene/localRenderer/PlaneRenderer'
import { EnvMapLoader } from '@src/clientSideScene/localRenderer/EnvMapLoader'
import { IntegerIdPicker } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import { HDR_ENV_MAP_URL } from '@src/clientSideScene/localRenderer/maps'
import {
  type LocalRendererFrameMetrics,
  LocalRendererPerformanceMonitor,
} from '@src/clientSideScene/localRenderer/PerformanceMonitor'
import { SelectionHighlightRenderer } from '@src/clientSideScene/localRenderer/SelectionHighlightRenderer'
import type { KclExecutionDoneDetail, KclManager } from '@src/lang/KclManager'
import { KclManagerEvents } from '@src/lang/KclManager'
import { EngineDebugger } from '@src/lib/debugger'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { type ResolvedTheme, getThemeBackgroundColor } from '@src/lib/theme'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { PlaneVisibilityMap } from '@src/machines/modelingSharedTypes'
import {
  Box3,
  BufferGeometry,
  type Camera,
  Material,
  type Mesh,
  NeutralToneMapping,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Sphere,
  Texture,
  Vector2,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type DenoiseNode from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import type GTAONode from 'three/examples/jsm/tsl/display/GTAONode.js'
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js'
import { mrt, normalView, output, pass, vec3, vec4 } from 'three/tsl'
import {
  type Node,
  type PassNode,
  RenderPipeline,
  WebGPURenderer,
} from 'three/webgpu'

const WEBGPU_PORT_DEBUG_STORAGE_KEY = 'webgpu-port-debug'
const WEBGPU_PORT_LOG_PREFIX = '[WEBGPU_POC]'
const ENGINE_MILLIMETERS_TO_GLTF_METERS = 1 / 1000

// The installed typings omit support for reconstructing normals from depth.
type CreateAmbientOcclusion = (
  depthNode: Node,
  normalNode: Node | null,
  camera: Camera
) => GTAONode
type AmbientOcclusionPipeline = {
  camera: PerspectiveCamera | OrthographicCamera
  pipeline: RenderPipeline
  scenePass: PassNode
  aoPass: GTAONode
  denoisePass: DenoiseNode | null
  denoiseNoiseTexture: Texture | null
}
type DisposableGpuDevice = {
  destroy: () => void
}
export interface LocalRendererProps {
  theme: ResolvedTheme
  enableSSAO: boolean
  highlightEdges: boolean
  fixedSizeGrid: boolean
  onVisibilityChange: (isVisible: boolean) => void
  onModelLoadSettled?: () => void
  forceHide?: boolean
}

export class LocalRenderer {
  private readonly container: HTMLDivElement
  private readonly kclManager: KclManager
  private theme: ResolvedTheme
  private enableSSAO: boolean
  private highlightEdges: boolean
  private fixedSizeGrid: boolean
  private forceHide: boolean
  private onVisibilityChange: LocalRendererProps['onVisibilityChange']
  private onModelLoadSettled: LocalRendererProps['onModelLoadSettled']
  private isVisible = false
  private renderer: WebGPURenderer | null = null
  private device: DisposableGpuDevice | null = null
  private scene: Scene | null = null
  private envMapLoader: EnvMapLoader | null = null
  private edgeRenderer: EdgeRenderer | null = null
  private planeRenderer: PlaneRenderer | null = null
  private integerIdPicker: IntegerIdPicker | null = null
  private selectionHighlightRenderer: SelectionHighlightRenderer | null = null
  private performanceMonitor: LocalRendererPerformanceMonitor | null = null
  private resizeObserver: ResizeObserver | null = null
  private animationFrameId = -1
  private scheduledRenderAt = 0
  private currentModel: Object3D | null = null
  private readonly gltfLoader = new GLTFLoader()
  private modelLoadGeneration = 0
  private pendingModelRefresh = false
  private hasFittedModel = false
  private unregisterExecutionListener: (() => void) | null = null
  private previewCamera: PerspectiveCamera | OrthographicCamera | null = null
  private readonly previewTarget = new Vector3()
  private readonly convertedSharedPosition = new Vector3()
  private readonly convertedSharedTarget = new Vector3()
  private readonly convertedSharedUp = new Vector3()
  private readonly performanceDrawingBufferSize = new Vector2()
  private unregisterSharedCameraListener: (() => void) | null = null
  private readonly unregisterBaseUnitListener: () => void
  private ambientOcclusionRadius = 0.01
  private ambientOcclusionPipeline: AmbientOcclusionPipeline | null = null
  private modelLoadSettledAfterRender = false
  private baseRenderDirty = true
  private disposed = false
  private planeInteractionEnabled = false
  private defaultPlaneVisibility: PlaneVisibilityMap = {
    xy: true,
    xz: true,
    yz: true,
  }
  private selectedPlaneId: string | null = null
  private hoveredPlane: Mesh | null = null
  private hoverRequestVersion = 0
  private pointerOverCanvas = false
  private unregisterPlanePicking: (() => void) | null = null

  constructor(
    container: HTMLDivElement,
    kclManager: KclManager,
    props: LocalRendererProps
  ) {
    this.container = container
    this.kclManager = kclManager
    this.theme = props.theme
    this.enableSSAO = props.enableSSAO
    this.highlightEdges = props.highlightEdges
    this.fixedSizeGrid = props.fixedSizeGrid
    this.forceHide = props.forceHide ?? false
    this.onVisibilityChange = props.onVisibilityChange
    this.onModelLoadSettled = props.onModelLoadSettled

    this.container.style.opacity = '0'
    this.kclManager.addEventListener(
      KclManagerEvents.ExecutionDone,
      this.onExecutionDone
    )
    this.unregisterExecutionListener = kclManager.isExecutingSignal.subscribe(
      (isExecuting) => {
        if (isExecuting) {
          // A new execution invalidates any export or GLB parse still in flight.
          this.modelLoadGeneration += 1
          this.pendingModelRefresh = false
          this.modelLoadSettledAfterRender = false
          this.clearPlaneHover()
        }
      }
    )
    this.unregisterBaseUnitListener = kclManager.sceneInfra.baseUnitChange.add(
      this.syncPlaneScale
    )
    void this.initialize().catch(this.handleInitializationError)
  }

  setFixedSizeGrid(fixedSizeGrid: boolean) {
    if (this.fixedSizeGrid === fixedSizeGrid) return
    this.fixedSizeGrid = fixedSizeGrid
    this.syncPlaneScale()
  }

  setPlaneInteractionEnabled(enabled: boolean) {
    this.planeInteractionEnabled = enabled
    this.integerIdPicker?.invalidate()
    if (!enabled) this.clearPlaneHover()
  }

  setSelectedPlane(id: string | null) {
    this.selectedPlaneId = id
    this.updatePlaneSelection()
  }

  setDefaultPlaneVisibility(visibility: PlaneVisibilityMap) {
    this.defaultPlaneVisibility = { ...visibility }
    this.planeRenderer?.setDefaultVisibility(visibility)
    this.integerIdPicker?.invalidate()
    this.clearPlaneHover()
    this.updatePlaneSelection()
    this.invalidateBaseRender()
  }

  private getPlaneTarget(id: string | null): Mesh | null {
    if (!id) return null
    const plane = this.planeRenderer?.planes.get(id)
    return plane?.group.visible ? plane.mesh : null
  }

  private updatePlaneSelection() {
    const target = this.getPlaneTarget(this.selectedPlaneId)
    this.selectionHighlightRenderer?.setSelection(target ? [target] : [])
    this.scheduleRender()
  }

  private readonly clearPlaneHover = () => {
    this.hoverRequestVersion++
    this.hoveredPlane = null
    this.selectionHighlightRenderer?.setHover(null)
    this.scheduleRender()
  }

  private rebuildPlaneTargets() {
    if (!this.planeRenderer) return
    this.planeRenderer.updateDefaultPlanes(
      this.kclManager.rustContext.defaultPlanes
    )
    this.planeRenderer.setDefaultVisibility(this.defaultPlaneVisibility)
    const targets = Array.from(
      this.planeRenderer.planes.values(),
      ({ mesh }) => mesh
    )

    this.integerIdPicker?.setTargets(targets, this.currentModel)
    this.selectionHighlightRenderer?.setTargets(targets)
    this.clearPlaneHover()
    this.updatePlaneSelection()
  }

  private readonly handleLocalSelectionCommand: LocalSelectionCommandProvider['handleCommand'] =
    async (command, { streamDimensions }) => {
      if (command.type !== 'modeling_cmd_req') return null
      const { cmd } = command
      if (
        cmd.type === 'select_add' ||
        cmd.type === 'select_remove' ||
        cmd.type === 'select_clear'
      ) {
        // The modeling-machine selection is supplied by LocalWebGPUScene.
        return {}
      }
      if (
        cmd.type !== 'highlight_set_entity' &&
        cmd.type !== 'select_with_point'
      )
        return null
      const isHover = cmd.type === 'highlight_set_entity'
      const controls = this.kclManager.sceneInfra.camControls
      if (
        !this.planeInteractionEnabled ||
        this.kclManager.isExecuting ||
        controls.isDragging ||
        (isHover &&
          (!this.pointerOverCanvas || controls.hoverPickingDisabled)) ||
        (!isHover && controls.wasDragging) ||
        !this.previewCamera
      )
        return {}
      const requestVersion = isHover
        ? ++this.hoverRequestVersion
        : this.hoverRequestVersion
      const generation = this.modelLoadGeneration
      const result = await this.integerIdPicker?.pick({
        ...cmd.selected_at_window,
        streamWidth: streamDimensions.width,
        streamHeight: streamDimensions.height,
        camera: this.previewCamera,
      })

      if (
        this.disposed ||
        this.forceHide ||
        !this.planeInteractionEnabled ||
        this.kclManager.isExecuting ||
        generation !== this.modelLoadGeneration ||
        result?.diagnostics.stale ||
        (isHover && requestVersion !== this.hoverRequestVersion)
      )
        return {}
      const target = result?.target ?? null
      const entityId = target?.name || null
      if (isHover) {
        if (this.hoveredPlane !== target) {
          this.hoveredPlane = target
          this.selectionHighlightRenderer?.setHover(target)
          this.scheduleRender()
        }
        return {
          unreliableModelingResponse: {
            type: 'highlight_set_entity',
            data: { entity_id: entityId },
          },
        }
      }
      const response = {
        type: 'select_with_point',
        data: { entity_id: entityId ?? undefined },
      } satisfies Extract<OkModelingCmdResponse, { type: 'select_with_point' }>
      return {
        modelingResponse: response,
        websocketResponse: {
          success: true,
          request_id: command.cmd_id,
          resp: { type: 'modeling', data: { modeling_response: response } },
        },
      }
    }

  private get backgroundColor() {
    return getThemeBackgroundColor(this.theme)
  }

  setTheme(theme: ResolvedTheme) {
    if (this.theme === theme) return
    this.theme = theme
    this.selectionHighlightRenderer?.setBackgroundColor(this.backgroundColor)
    this.edgeRenderer?.setBackgroundColor(this.backgroundColor)
    this.planeRenderer?.setTheme(theme)
    this.invalidateBaseRender()
  }

  setEnableSSAO(enableSSAO: boolean) {
    if (this.enableSSAO === enableSSAO) {
      return
    }

    this.enableSSAO = enableSSAO
    this.invalidateBaseRender()
  }

  setHighlightEdges(highlightEdges: boolean) {
    if (this.highlightEdges === highlightEdges) {
      return
    }

    this.highlightEdges = highlightEdges
    this.edgeRenderer?.setVisible(highlightEdges)
    this.integerIdPicker?.setEdgesVisible(highlightEdges)
    this.invalidateBaseRender()
  }

  setForceHide(forceHide: boolean) {
    if (this.forceHide === forceHide) {
      return
    }

    this.forceHide = forceHide
    if (forceHide) this.clearPlaneHover()
    this.container.style.opacity = this.isVisible && !this.forceHide ? '1' : '0'
    this.invalidateBaseRender()
  }

  setOnVisibilityChange(
    onVisibilityChange: LocalRendererProps['onVisibilityChange']
  ) {
    this.onVisibilityChange = onVisibilityChange
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.unregisterPlanePicking?.()
    this.unregisterPlanePicking = null
    this.unregisterExecutionListener?.()
    this.unregisterExecutionListener = null
    this.kclManager.removeEventListener(
      KclManagerEvents.ExecutionDone,
      this.onExecutionDone
    )
    this.container.style.opacity = '0'
    this.isVisible = false
    this.unregisterSharedCameraListener?.()
    this.unregisterSharedCameraListener = null
    this.unregisterBaseUnitListener()
    this.clearModel()
    this.planeRenderer?.dispose()
    this.planeRenderer = null
    this.edgeRenderer?.dispose()
    this.edgeRenderer = null
    this.integerIdPicker?.dispose()
    this.integerIdPicker = null
    this.selectionHighlightRenderer?.dispose()
    this.selectionHighlightRenderer = null
    this.performanceMonitor = null
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

  private readonly syncPlaneScale = () => {
    const { camControls, baseUnitMultiplier } = this.kclManager.sceneInfra
    // Match the engine's fixed grid: ten file units, expressed in decimeters.
    // baseUnitMultiplier converts one file unit to mm; 100 mm = one dm.
    const fixedGridScale = this.fixedSizeGrid
      ? (10 * baseUnitMultiplier) / 100
      : undefined
    const distance = camControls.camera.position.distanceTo(camControls.target)
    this.planeRenderer?.updateScale(distance, fixedGridScale)
    this.integerIdPicker?.invalidate()
    this.invalidateBaseRender()
  }

  private readonly syncPreviewCameraFromShared = () => {
    this.clearPlaneHover()
    const cameraControls = this.kclManager.sceneInfra.camControls
    const sharedCamera = cameraControls.camera
    const sharedTarget = cameraControls.target
    this.syncPlaneScale()
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
    // Preserve the shared clip range, including a negative orthographic near plane.
    this.previewCamera.near =
      sharedCamera.near * ENGINE_MILLIMETERS_TO_GLTF_METERS
    this.previewCamera.far =
      sharedCamera.far * ENGINE_MILLIMETERS_TO_GLTF_METERS
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
    this.invalidateBaseRender()
  }

  private readonly handleInitializationError = (error: unknown) => {
    logLocalWebGpuPreview('preview initialization failed', { error })
    console.error('[LocalWebGPUScene] preview initialization failed', error)
    reportRejection(error)
  }

  private configureAmbientOcclusion(
    aoPass: GTAONode,
    denoisePass?: DenoiseNode | null
  ) {
    aoPass.radius.value = this.ambientOcclusionRadius
    aoPass.thickness.value = this.ambientOcclusionRadius * 3
    aoPass.distanceFallOff.value = 0.5
    aoPass.scale.value = 1
    aoPass.samples.value = LOCAL_WEBGPU_GTAO_SAMPLES
    if (denoisePass) {
      denoisePass.depthPhi.value = this.ambientOcclusionRadius * 3
    }
  }

  private disposeAmbientOcclusionPipeline() {
    this.ambientOcclusionPipeline?.pipeline.dispose()
    this.ambientOcclusionPipeline?.scenePass.dispose()
    this.ambientOcclusionPipeline?.aoPass.dispose()
    this.ambientOcclusionPipeline?.denoiseNoiseTexture?.dispose()
    this.ambientOcclusionPipeline?.denoisePass?.dispose()
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

    // Local geometry is expressed in meters. Keep the sampling radius
    // proportional to the part instead of GTAO's room-scale default.
    this.ambientOcclusionRadius = Math.max(modelScale * 0.05, 0.00001)
    if (this.ambientOcclusionPipeline) {
      this.configureAmbientOcclusion(
        this.ambientOcclusionPipeline.aoPass,
        this.ambientOcclusionPipeline.denoisePass
      )
    }
  }

  private renderPreview(requestAnimationFrameDelayMs: number) {
    const previewCamera = this.previewCamera
    const renderer = this.renderer
    const scene = this.scene
    if (!previewCamera || !renderer || !scene) {
      return
    }

    const frameStartedAt = performance.now()
    const renderInfoBefore = captureRendererWork(renderer)
    const frameSetupStartedAt = performance.now()
    const baseRendered =
      this.selectionHighlightRenderer?.beginFrame(this.baseRenderDirty) ?? true
    const frameSetupCpuMs = performance.now() - frameSetupStartedAt

    let sceneCpuSubmissionMs = 0
    let baseCacheCpuSubmissionMs = 0
    if (baseRendered) {
      const sceneStartedAt = performance.now()
      if (!this.enableSSAO || this.forceHide) {
        renderer.render(scene, previewCamera)
      } else {
        if (this.ambientOcclusionPipeline?.camera !== previewCamera) {
          this.disposeAmbientOcclusionPipeline()

          // GTAO expects a regular depth texture. The renderer itself can keep
          // using MSAA, but this intermediate pass must be single-sampled.
          const scenePass = pass(scene, previewCamera, {
            samples: 0,
          })
          if (LOCAL_WEBGPU_GTAO_USE_NORMAL_MRT) {
            scenePass.setMRT(
              mrt({
                output,
                normal: normalView,
              })
            )
          }
          const scenePassColor = LOCAL_WEBGPU_GTAO_USE_NORMAL_MRT
            ? scenePass.getTextureNode('output')
            : scenePass.getTextureNode()
          const scenePassNormal = LOCAL_WEBGPU_GTAO_USE_NORMAL_MRT
            ? scenePass.getTextureNode('normal')
            : null
          const scenePassDepth = scenePass.getTextureNode('depth')
          const aoPass = (ao as CreateAmbientOcclusion)(
            scenePassDepth,
            scenePassNormal,
            previewCamera
          )
          aoPass.resolutionScale = 0.5
          const denoisePass = LOCAL_WEBGPU_GTAO_USE_DENOISE
            ? denoise(
                aoPass.getTextureNode(),
                scenePassDepth,
                scenePassNormal as Node,
                previewCamera
              )
            : null
          const denoiseNoiseTexture = denoisePass
            ? (denoisePass.noiseNode as unknown as { value: Texture }).value
            : null
          this.configureAmbientOcclusion(aoPass, denoisePass)

          const pipeline = new RenderPipeline(renderer)
          pipeline.outputColorTransform = false
          // DenoiseNode produces vec4, but the bundled declaration omits its
          // TempNode output type.
          const aoOutput = denoisePass
            ? vec4(denoisePass as unknown as Node<'vec4'>)
            : aoPass.getTextureNode()
          // Preserve some indirect light even at maximum occlusion while leaving
          // enough contrast to make the setting visibly effective.
          const ambientOcclusion = aoOutput.r.mul(0.8).add(0.2)
          pipeline.outputNode = scenePassColor.mul(
            vec4(vec3(ambientOcclusion), 1)
          )

          this.ambientOcclusionPipeline = {
            camera: previewCamera,
            pipeline,
            scenePass,
            aoPass,
            denoisePass,
            denoiseNoiseTexture,
          }
        }

        this.ambientOcclusionPipeline.pipeline.render()
      }
      sceneCpuSubmissionMs = performance.now() - sceneStartedAt

      const baseCacheStartedAt = performance.now()
      this.selectionHighlightRenderer?.cacheBaseFrame()
      baseCacheCpuSubmissionMs = performance.now() - baseCacheStartedAt
      this.baseRenderDirty = false
    }

    const highlightMetrics = this.selectionHighlightRenderer?.render(
      previewCamera
    ) ?? {
      compositionCpuSubmissionMs: 0,
      highlightCpuSubmissionMs: 0,
      presentationCpuSubmissionMs: 0,
      maskPasses: 0,
      linePasses: 0,
    }
    const renderInfoAfter = captureRendererWork(renderer)
    const drawingBufferSize = renderer.getDrawingBufferSize(
      this.performanceDrawingBufferSize
    )
    this.performanceMonitor?.recordFrame({
      requestAnimationFrameDelayMs,
      frameSetupCpuMs,
      sceneCpuSubmissionMs,
      baseCacheCpuSubmissionMs,
      compositionCpuSubmissionMs: highlightMetrics.compositionCpuSubmissionMs,
      highlightCpuSubmissionMs: highlightMetrics.highlightCpuSubmissionMs,
      presentationCpuSubmissionMs: highlightMetrics.presentationCpuSubmissionMs,
      totalCpuSubmissionMs: performance.now() - frameStartedAt,
      rendererRenderCalls:
        renderInfoAfter.rendererRenderCalls -
        renderInfoBefore.rendererRenderCalls,
      drawCalls: renderInfoAfter.drawCalls - renderInfoBefore.drawCalls,
      triangles: renderInfoAfter.triangles - renderInfoBefore.triangles,
      lines: renderInfoAfter.lines - renderInfoBefore.lines,
      maskPasses: highlightMetrics.maskPasses,
      highlightLinePasses: highlightMetrics.linePasses,
      viewportWidth: drawingBufferSize.x,
      viewportHeight: drawingBufferSize.y,
      pixelRatio: renderer.getPixelRatio(),
      ssaoEnabled: this.enableSSAO && !this.forceHide,
      baseRendered,
      hoverActive: this.hoveredPlane !== null,
      selectionCount: this.selectedPlaneId ? 1 : 0,
    } satisfies LocalRendererFrameMetrics)

    if (this.modelLoadSettledAfterRender) {
      this.modelLoadSettledAfterRender = false
      this.onModelLoadSettled?.()
    }
  }

  private scheduleRender() {
    if (this.disposed || !this.previewCamera || this.animationFrameId !== -1) {
      return
    }

    this.scheduledRenderAt = performance.now()
    this.animationFrameId = requestAnimationFrame(() => {
      const requestAnimationFrameDelayMs =
        performance.now() - this.scheduledRenderAt
      this.animationFrameId = -1
      this.scheduledRenderAt = 0
      if (this.disposed || !this.previewCamera) {
        return
      }

      this.renderPreview(requestAnimationFrameDelayMs)
    })
  }

  private invalidateBaseRender() {
    this.baseRenderDirty = true
    this.scheduleRender()
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
    this.invalidateBaseRender()
  }

  private clearModel() {
    this.integerIdPicker?.clearModel()
    this.selectionHighlightRenderer?.clearModel()
    if (this.currentModel) {
      this.scene?.remove(this.currentModel)
      this.edgeRenderer?.removeFromParent()
      disposeObject3D(this.currentModel)
      this.currentModel = null
    }

    this.performanceMonitor?.setGeometry(null)
    this.invalidateBaseRender()
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
      device = await adapter.requestDevice({
        requiredLimits: {
          // TODO: Chunk geometry so large models work on
          // adapters with lower per-buffer limits.
          maxBufferSize: adapter.limits.maxBufferSize,
        },
      })
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
    scene.background = null
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
    // Keep reference planes separate from the GLB and its fit-to-model bounds.
    this.planeRenderer = new PlaneRenderer(this.theme)
    this.planeRenderer.addTo(scene)
    this.integerIdPicker = new IntegerIdPicker(renderer)
    this.integerIdPicker.setEdgesVisible(this.highlightEdges)
    this.selectionHighlightRenderer = new SelectionHighlightRenderer(
      renderer,
      this.backgroundColor
    )
    this.performanceMonitor = new LocalRendererPerformanceMonitor(renderer)

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

    this.rebuildPlaneTargets()
    const unregisterProvider = registerLocalSelectionCommandProvider({
      isActive: () =>
        !this.disposed && !this.forceHide && this.planeInteractionEnabled,
      handleCommand: this.handleLocalSelectionCommand,
    })
    const inputCanvas = kclManager.sceneInfra.camControls.domElement
    this.pointerOverCanvas = inputCanvas.matches(':hover')
    const onEnter = () => {
      this.pointerOverCanvas = true
    }
    const onLeave = () => {
      this.pointerOverCanvas = false
      this.clearPlaneHover()
    }
    inputCanvas.addEventListener('pointerenter', onEnter)
    inputCanvas.addEventListener('pointerleave', onLeave)
    this.unregisterPlanePicking = () => {
      unregisterProvider()
      inputCanvas.removeEventListener('pointerenter', onEnter)
      inputCanvas.removeEventListener('pointerleave', onLeave)
    }

    this.resize()
    this.syncPreviewCameraFromShared()
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(container)

    this.scheduleRender()

    this.setVisible(true)
    // Execution may finish while the GPU/environment is initializing, or before
    // this renderer is mounted. Load that completed scene once, too.
    if (
      this.pendingModelRefresh ||
      (!kclManager.isExecuting &&
        kclManager.engineSceneGenerationSignal.peek() > 0 &&
        !kclManager.hasErrors())
    ) {
      void this.refreshModel().catch(reportRejection)
    } else if (!kclManager.isExecuting) {
      this.modelLoadSettledAfterRender = true
    }
  }

  private readonly onExecutionDone = (event: Event) => {
    if (this.disposed || this.kclManager.isExecuting) return

    const { detail } = event as CustomEvent<KclExecutionDoneDetail>
    this.modelLoadGeneration += 1
    if (!detail.successful) {
      this.rebuildPlaneTargets()
      this.syncPlaneScale()
      this.pendingModelRefresh = false
      logLocalWebGpuPreview('KCL execution failed', detail)
      this.onModelLoadSettled?.()
      return
    }

    this.pendingModelRefresh = true
    if (this.renderer) {
      void this.refreshModel().catch(reportRejection)
    }
  }

  private async refreshModel() {
    this.pendingModelRefresh = false
    const generation = ++this.modelLoadGeneration
    const isCurrent = () =>
      !this.disposed && generation === this.modelLoadGeneration
    // Reference planes do not depend on a successful GLB export.
    this.planeRenderer?.updateOffsetPlanes(this.kclManager.artifactGraph)
    this.syncPlaneScale()
    // An empty execution has no GLB to export, but must clear the old model.
    if (this.kclManager.artifactGraph.size === 0) {
      this.clearModel()
      this.rebuildPlaneTargets()
      this.modelLoadSettledAfterRender = true
      return
    }
    this.rebuildPlaneTargets()
    const startedAt = performance.now()
    try {
      // Like viewer2: one whole-scene binary glTF export, without UUID extras.
      const files = await this.kclManager.rustContext.export(
        { type: 'gltf', storage: 'binary', presentation: 'compact' },
        jsAppSettings(this.kclManager.systemDeps.settings)
      )
      if (!isCurrent()) return

      const exportRoundTripMs = performance.now() - startedAt
      const file = files?.find((file) => file.name.endsWith('.glb'))
      if (!file) {
        this.handleModelLoadError(
          new Error('Engine export returned no GLB file.')
        )
        return
      }

      const bytes = new Uint8Array(file.contents)
      const gltf = await this.gltfLoader.parseAsync(bytes.buffer, '')
      if (!isCurrent()) {
        disposeObject3D(gltf.scene)
        return
      }

      this.clearModel()
      this.currentModel = gltf.scene
      this.scene?.add(gltf.scene)
      this.rebuildPlaneTargets()
      const bounds = new Box3().setFromObject(gltf.scene)
      this.updateAmbientOcclusionScale(bounds)
      if (!this.hasFittedModel && !bounds.isEmpty()) {
        this.fitSharedCameraToModel(bounds)
        this.hasFittedModel = true
      }
      this.modelLoadSettledAfterRender = true
      this.invalidateBaseRender()
      logLocalWebGpuPreview('GLB model loaded', {
        exportRoundTripMs,
        loadMs: performance.now() - startedAt - exportRoundTripMs,
        payloadBytes: bytes.byteLength,
      })
    } catch (error) {
      if (isCurrent()) this.handleModelLoadError(error)
    }
  }

  private handleModelLoadError(error: unknown) {
    this.clearModel()
    this.rebuildPlaneTargets()
    console.error('[LocalWebGPUScene] GLB model load failed', error)
    reportRejection(error)
    this.onModelLoadSettled?.()
  }

  private fitSharedCameraToModel(bounds: Box3) {
    const controls = this.kclManager.sceneInfra.camControls
    const camera = controls.camera
    const sphere = bounds.getBoundingSphere(new Sphere())
    // glTF is Y-up in meters; the shared navigation camera is Z-up in mm.
    const center = new Vector3(
      sphere.center.x,
      -sphere.center.z,
      sphere.center.y
    ).divideScalar(ENGINE_MILLIMETERS_TO_GLTF_METERS)
    const radius = Math.max(
      sphere.radius / ENGINE_MILLIMETERS_TO_GLTF_METERS,
      0.001
    )
    const direction = camera.position.clone().sub(controls.target)
    if (direction.lengthSq() === 0) direction.set(1, -1, 1)
    direction.normalize()
    let distance = radius * 3
    if (camera instanceof PerspectiveCamera) {
      const halfFovY = (camera.getEffectiveFOV() * Math.PI) / 360
      const aspect =
        Math.max(this.container.clientWidth, 1) /
        Math.max(this.container.clientHeight, 1)
      const halfFovX = Math.atan(Math.tan(halfFovY) * aspect)
      distance = (radius * 1.2) / Math.sin(Math.min(halfFovX, halfFovY))
    } else {
      camera.zoom =
        Math.min(camera.right - camera.left, camera.top - camera.bottom) /
        (2 * radius * 1.2)
    }
    controls.target.copy(center)
    camera.position.copy(center).addScaledVector(direction, distance)
    camera.lookAt(center)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    controls.onCameraChange()
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
    message === 'device request failed'

  if (shouldPrintToConsole) {
    console.info(
      `${WEBGPU_PORT_LOG_PREFIX}[LocalWebGPUScene]`,
      message,
      metadata ?? ''
    )
  }
}

function captureRendererWork(renderer: WebGPURenderer) {
  return {
    rendererRenderCalls: renderer.info.render.calls,
    drawCalls: renderer.info.render.drawCalls,
    triangles: renderer.info.render.triangles,
    lines: renderer.info.render.lines,
  }
}

function disposeObject3D(root: Object3D) {
  // GLTFLoader can share these resources between multiple nodes.
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    if ('geometry' in object && object.geometry instanceof BufferGeometry) {
      geometries.add(object.geometry)
    }

    if (!('material' in object)) return
    const objectMaterials = (
      isArray(object.material) ? object.material : [object.material]
    ).filter((material): material is Material => material instanceof Material)
    for (const material of objectMaterials) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value)
      }
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  textures.forEach((texture) => texture.dispose())
  materials.forEach((material) => material.dispose())
}

function convertEngineWorldVectorToGltfWorld(
  vector: Vector3,
  scale = 1
): Vector3 {
  return new Vector3(vector.x * scale, vector.z * scale, -vector.y * scale)
}
