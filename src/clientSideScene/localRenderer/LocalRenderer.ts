import {
  LOCAL_WEBGPU_GTAO_SAMPLES,
  LOCAL_WEBGPU_GTAO_USE_DENOISE,
  LOCAL_WEBGPU_GTAO_USE_NORMAL_MRT,
} from '@src/clientSideScene/localRenderer/config'
import { EdgeRenderer } from '@src/clientSideScene/localRenderer/EdgeRenderer'
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
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import {
  type Box3,
  type Material,
  NeutralToneMapping,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  type Texture,
  Vector2,
  Vector3,
} from 'three'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js'
import { mrt, normalView, output, pass, vec3, vec4 } from 'three/tsl'
import { type Node, RenderPipeline, WebGPURenderer } from 'three/webgpu'

const WEBGPU_PORT_DEBUG_STORAGE_KEY = 'webgpu-port-debug'
const WEBGPU_PORT_LOG_PREFIX = '[WEBGPU_POC]'
const ENGINE_MILLIMETERS_TO_GLTF_METERS = 1 / 1000

type AoFactory = typeof ao
type AmbientOcclusionPass = ReturnType<AoFactory> & { dispose: () => void }
type AmbientOcclusionDenoisePass = ReturnType<typeof denoise>
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
  denoisePass: AmbientOcclusionDenoisePass | null
  denoiseNoiseTexture: Texture | null
}
type DisposableGpuDevice = {
  destroy: () => void
}
export interface LocalRendererProps {
  backgroundColor: string
  enableSSAO: boolean
  highlightEdges: boolean
  onVisibilityChange: (isVisible: boolean) => void
  onModelLoadSettled?: () => void
  forceHide?: boolean
}

export class LocalRenderer {
  private readonly container: HTMLDivElement
  private readonly kclManager: KclManager
  private backgroundColor: string
  private enableSSAO: boolean
  private highlightEdges: boolean
  private forceHide: boolean
  private onVisibilityChange: LocalRendererProps['onVisibilityChange']
  private onModelLoadSettled: LocalRendererProps['onModelLoadSettled']
  private isVisible = false
  private renderer: WebGPURenderer | null = null
  private device: DisposableGpuDevice | null = null
  private scene: Scene | null = null
  private envMapLoader: EnvMapLoader | null = null
  private edgeRenderer: EdgeRenderer | null = null
  private integerIdPicker: IntegerIdPicker | null = null
  private selectionHighlightRenderer: SelectionHighlightRenderer | null = null
  private performanceMonitor: LocalRendererPerformanceMonitor | null = null
  private resizeObserver: ResizeObserver | null = null
  private animationFrameId = -1
  private scheduledRenderAt = 0
  private currentModel: Object3D | null = null
  private previewCamera: PerspectiveCamera | OrthographicCamera | null = null
  private readonly previewTarget = new Vector3()
  private readonly convertedSharedPosition = new Vector3()
  private readonly convertedSharedTarget = new Vector3()
  private readonly convertedSharedUp = new Vector3()
  private readonly performanceDrawingBufferSize = new Vector2()
  private unregisterSharedCameraListener: (() => void) | null = null
  private ambientOcclusionRadius = 0.01
  private ambientOcclusionPipeline: AmbientOcclusionPipeline | null = null
  private modelLoadSettledAfterRender = false
  private baseRenderDirty = true
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
    this.onVisibilityChange = props.onVisibilityChange
    this.onModelLoadSettled = props.onModelLoadSettled

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
      this.selectionHighlightRenderer?.setBackgroundColor(backgroundColor)
      this.edgeRenderer?.setBackgroundColor(backgroundColor)
      this.invalidateBaseRender()
    }
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
    this.kclManager.removeEventListener(
      KclManagerEvents.ExecutionDone,
      this.onExecutionDone
    )
    this.container.style.opacity = '0'
    this.isVisible = false
    this.unregisterSharedCameraListener?.()
    this.unregisterSharedCameraListener = null
    this.clearModel()
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

  private readonly syncPreviewCameraFromShared = () => {
    const cameraControls = this.kclManager.sceneInfra.camControls
    const sharedCamera = cameraControls.camera
    const sharedTarget = cameraControls.target
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
    this.invalidateBaseRender()
  }

  private readonly handleInitializationError = (error: unknown) => {
    logLocalWebGpuPreview('preview initialization failed', { error })
    console.error('[LocalWebGPUScene] preview initialization failed', error)
    reportRejection(error)
  }

  private configureAmbientOcclusion(
    aoPass: AmbientOcclusionPass,
    denoisePass?: AmbientOcclusionDenoisePass | null
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
                scenePassNormal as Parameters<typeof denoise>[2],
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
      hoverActive: false,
      selectionCount: 0,
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

    this.resize()
    this.syncPreviewCameraFromShared()
    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(container)

    this.scheduleRender()

    // Geometry loading is disconnected until the glTF loader is added.
    this.setVisible(true)
    this.modelLoadSettledAfterRender = true
  }

  private readonly onExecutionDone = (event: Event) => {
    const { detail } = event as CustomEvent<KclExecutionDoneDetail>
    if (!detail.successful) {
      logLocalWebGpuPreview('KCL execution failed', detail)
      this.onModelLoadSettled?.()
      return
    }

    this.clearModel()
    this.modelLoadSettledAfterRender = true
    this.scheduleRender()
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

function convertEngineWorldVectorToGltfWorld(
  vector: Vector3,
  scale = 1
): Vector3 {
  return new Vector3(vector.x * scale, vector.z * scale, -vector.y * scale)
}
