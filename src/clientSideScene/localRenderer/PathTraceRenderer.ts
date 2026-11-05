import type { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import {
  LOCAL_WEBGPU_PATH_TRACE_DENOISED_SAMPLES,
  LOCAL_WEBGPU_PATH_TRACE_PIXEL_RATIO,
  LOCAL_WEBGPU_PATH_TRACE_SAMPLES,
} from '@src/clientSideScene/localRenderer/config'
import { reportRejection } from '@src/lib/trap'
import { initUNetFromURL, type UNet } from 'oidn-web'
import denoiserWeightsUrl from 'oidn-weights/rt_hdr_alb_nrm.tza?url'
import {
  Color,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  RGBAFormat,
  Scene,
  Vector2,
  LinearSRGBColorSpace,
  type Texture,
} from 'three'
import {
  float,
  mix,
  uniform,
  pmremTexture,
  screenUV,
  texture,
  vec3,
  vec4,
} from 'three/tsl'
import {
  NodeMaterial,
  Line2NodeMaterial,
  MeshBasicNodeMaterial,
  QuadMesh,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu'
import { OIDNDenoiser, WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu'

const ENVIRONMENT_WIDTH = 512
const ENVIRONMENT_HEIGHT = 256

/**
 * Path traces the model with three-gpu-pathtracer. The path tracer gets a scene
 * of its own with only the model's meshes, because the edges and reference
 * planes are lines and unlit materials it cannot trace.
 */
export class PathTraceRenderer {
  private readonly scene = new Scene()
  private readonly traceTarget = new RenderTarget(1, 1, {
    depthBuffer: false,
    colorSpace: LinearSRGBColorSpace,
  })
  private readonly rasterTarget = new RenderTarget(1, 1, {
    colorSpace: LinearSRGBColorSpace,
    depthBuffer: true,
  })
  private readonly edgeTarget = new RenderTarget(1, 1, {
    colorSpace: LinearSRGBColorSpace,
    depthBuffer: true,
  })
  private readonly edgeOpacity = uniform(0)
  private readonly clearColor = new Color()
  private readonly blend = uniform(1)
  private readonly edgeMaterial = new Line2NodeMaterial()
  private readonly presentationMaterial = new NodeMaterial()
  private readonly presentationQuad = new QuadMesh(this.presentationMaterial)
  private readonly drawingBufferSize = new Vector2()
  private readonly depthMaterial = new MeshBasicNodeMaterial({
    colorWrite: false,
  })
  private readonly edgeScene = new Scene()
  private edgeSource: LineSegments2 | null = null
  private edgeOverlay: LineSegments2 | null = null
  private readonly pathTracer: WebGPUPathTracer
  private readonly denoiser: OIDNDenoiser
  private readonly unet: Promise<UNet>
  private readonly transparentBackground = new DataTexture(
    new Uint8Array(4),
    1,
    1
  )
  private model: Object3D | null = null
  private modelChanged = true
  private camera: PerspectiveCamera | OrthographicCamera | null = null
  private readonly cameraMatrix = new Matrix4()
  private readonly projectionMatrix = new Matrix4()
  private denoise = true
  private denoiserLoaded = false
  private lastRenderTime = -1
  private revision = 0
  private measuringSamples = false
  private samplesReached = false
  private disposed = false
  /** The image is final, so no more frames are needed until something changes. */
  settled = false

  private constructor(
    renderer: WebGPURenderer,
    device: GPUDevice,
    environment: Texture,
    environmentIntensity: number,
    private readonly onChange: () => void
  ) {
    this.transparentBackground.minFilter = LinearFilter
    this.transparentBackground.magFilter = LinearFilter
    this.transparentBackground.needsUpdate = true
    this.scene.background = this.transparentBackground
    this.scene.environment = environment
    this.scene.environmentIntensity = environmentIntensity
    this.traceTarget.texture.type = renderer.getOutputBufferType()
    this.rasterTarget.texture.type = renderer.getOutputBufferType()
    this.rasterTarget.samples = renderer.samples
    this.edgeTarget.texture.type = renderer.getOutputBufferType()
    this.edgeTarget.samples = renderer.samples
    const traced = texture(this.traceTarget.texture, screenUV)
    const edges = texture(this.edgeTarget.texture, screenUV)
    const edgeCoverage = edges.a.mul(this.edgeOpacity)
    // Both targets contain premultiplied color. Composite edges independently
    // so opacity never changes the accumulated image or selection materials.
    const tracedWithEdges = vec4(
      traced.rgb
        .mul(edgeCoverage.oneMinus())
        .add(edges.rgb.mul(this.edgeOpacity)),
      traced.a.mul(edgeCoverage.oneMinus()).add(edgeCoverage)
    )
    this.presentationMaterial.fragmentNode = mix(
      texture(this.rasterTarget.texture, screenUV),
      tracedWithEdges,
      this.blend
    )
    this.presentationMaterial.depthTest = false
    this.presentationMaterial.depthWrite = false
    this.pathTracer = new WebGPUPathTracer(renderer)
    // The denoiser does its own loading, but then it retries a failed load on
    // every frame. Loading the network here reports a failure once.
    this.unet = initUNetFromURL(
      denoiserWeightsUrl,
      { device },
      { aux: true, hdr: true }
    )
    this.denoiser = new OIDNDenoiser({
      initUNetFromURL: () => this.unet,
      auxWeightsUrl: denoiserWeightsUrl,
    })
    this.unet
      .then(() => {
        this.denoiserLoaded = true
        this.setDenoise(this.denoise)
      })
      .catch(reportRejection)
  }

  /**
   * The path tracer samples the environment from an equirect image on the CPU
   * as well, so the PMREM environment of the raster view is baked into one.
   */
  static async create(
    renderer: WebGPURenderer,
    device: GPUDevice,
    environment: Texture,
    environmentIntensity: number,
    onChange: () => void
  ) {
    const equirect = await bakeEquirectEnvironment(renderer, environment)
    return new PathTraceRenderer(
      renderer,
      device,
      equirect,
      environmentIntensity,
      onChange
    )
  }

  invalidateCamera() {
    this.invalidate()
  }

  setModel(model: Object3D | null) {
    this.model = model
    this.modelChanged = true
    this.invalidate()
  }

  setDenoise(denoise: boolean) {
    this.denoise = denoise
    if (this.disposed) {
      return
    }
    const denoiser = denoise && this.denoiserLoaded ? this.denoiser : null
    this.pathTracer.maxSamples = denoiser
      ? LOCAL_WEBGPU_PATH_TRACE_DENOISED_SAMPLES
      : LOCAL_WEBGPU_PATH_TRACE_SAMPLES
    this.pathTracer.setDenoiser(denoiser)
    this.invalidate()
    this.onChange()
  }

  /** Adds samples and draws the image into the current render target. */
  render(
    camera: PerspectiveCamera | OrthographicCamera,
    renderer: WebGPURenderer,
    stealth: boolean,
    draw = true
  ) {
    this.edgeOpacity.value = 0
    const previousTarget = renderer.getRenderTarget()
    renderer.getDrawingBufferSize(this.drawingBufferSize)
    const width = previousTarget?.width ?? this.drawingBufferSize.x
    const height = previousTarget?.height ?? this.drawingBufferSize.y
    if (
      this.traceTarget.width !== width ||
      this.traceTarget.height !== height
    ) {
      this.traceTarget.setSize(width, height)
      this.rasterTarget.setSize(width, height)
      this.edgeTarget.setSize(width, height)
      this.pathTracer.reset()
      this.invalidate()
    }
    const { pathTracer } = this
    if (this.modelChanged) {
      this.invalidate()
      this.modelChanged = false
      this.rebuildScene()
      pathTracer.setScene(this.scene, camera)
      this.trackCamera(camera)
    } else if (camera !== this.camera) {
      this.invalidate()
      pathTracer.setCamera(camera)
      // setCamera leaves the denoiser drawing its guides from the old camera.
      this.denoiser.setScene(this.scene, camera)
      this.trackCamera(camera)
    } else if (
      !this.cameraMatrix.equals(camera.matrixWorld) ||
      !this.projectionMatrix.equals(camera.projectionMatrix)
    ) {
      this.invalidate()
      pathTracer.updateCamera()
      this.trackCamera(camera)
    }

    pathTracer.renderScale = Math.min(
      1,
      LOCAL_WEBGPU_PATH_TRACE_PIXEL_RATIO / window.devicePixelRatio
    )
    const denoising = this.denoise && this.denoiserLoaded
    // The denoiser's last tile reaches the screen with the next draw.
    const denoised = denoising && this.denoiser.complete
    renderer.setRenderTarget(this.traceTarget)
    try {
      pathTracer.renderSample()
    } finally {
      renderer.setRenderTarget(previousTarget)
    }

    // Any reset, including one for a resized canvas, restarts the render time.
    const renderTime = pathTracer.getRenderTime()
    const restarted = renderTime < this.lastRenderTime
    this.lastRenderTime = renderTime
    if (restarted) {
      this.samplesReached = false
    }
    this.settled = !restarted && (denoising ? denoised : this.samplesReached)
    if (!denoising && !this.samplesReached) {
      this.measureSamples()
    }
    const present = !stealth || this.settled
    if (present && draw) {
      this.blend.value = 1
      this.presentationQuad.render(renderer)
    }
    return present
  }

  /** Composite both views in linear color before the existing display transform. */
  present(renderer: WebGPURenderer, opacity: number, renderRaster: () => void) {
    const target = renderer.getRenderTarget()
    if (opacity < 1) {
      renderer.setRenderTarget(this.rasterTarget)
      try {
        renderRaster()
      } finally {
        renderer.setRenderTarget(target)
      }
    }
    this.blend.value = opacity
    this.presentationQuad.render(renderer)
  }

  /** Populate depth from the BREP faces so hidden edges stay hidden. */
  renderEdges(
    renderer: WebGPURenderer,
    camera: PerspectiveCamera | OrthographicCamera,
    edges: LineSegments2,
    opacity = 0.45
  ) {
    if (this.edgeSource !== edges) {
      this.edgeScene.clear()
      this.edgeSource = edges
      this.edgeMaterial.copy(edges.material)
      this.edgeMaterial.linewidth = 1
      this.edgeMaterial.transparent = false
      this.edgeMaterial.opacity = 1
      this.edgeMaterial.depthWrite = false
      this.edgeOverlay = edges.clone()
      this.edgeOverlay.material = this.edgeMaterial
      this.edgeOverlay.matrixAutoUpdate = false
      this.edgeScene.add(this.edgeOverlay)
    }
    this.edgeOpacity.value = opacity
    const target = renderer.getRenderTarget()
    renderer.setRenderTarget(this.edgeTarget)
    edges.updateWorldMatrix(true, false)
    this.edgeOverlay?.matrix.copy(edges.matrixWorld)
    const autoClear = renderer.autoClear
    const background = this.scene.background
    renderer.getClearColor(this.clearColor)
    const clearAlpha = renderer.getClearAlpha()
    try {
      renderer.autoClear = false
      renderer.setClearColor(0, 0)
      renderer.clear()
      this.scene.background = null
      this.scene.overrideMaterial = this.depthMaterial
      renderer.render(this.scene, camera)
      renderer.render(this.edgeScene, camera)
    } finally {
      this.scene.overrideMaterial = null
      this.scene.background = background
      renderer.autoClear = autoClear
      renderer.setClearColor(this.clearColor, clearAlpha)
      renderer.setRenderTarget(target)
    }
  }

  dispose() {
    this.disposed = true
    this.traceTarget.dispose()
    this.rasterTarget.dispose()
    this.edgeTarget.dispose()
    this.edgeMaterial.dispose()
    this.presentationMaterial.dispose()
    this.depthMaterial.dispose()
    this.edgeScene.clear()
    this.pathTracer.dispose()
    this.denoiser.dispose()
    // The denoiser only frees the network once it has run. A failed load was
    // reported when it happened.
    this.unet.then(
      (unet) => unet.dispose(),
      () => undefined
    )
    this.transparentBackground.dispose()
    this.scene.environment?.dispose()
    this.scene.clear()
  }

  private trackCamera(camera: PerspectiveCamera | OrthographicCamera) {
    this.camera = camera
    this.cameraMatrix.copy(camera.matrixWorld)
    this.projectionMatrix.copy(camera.projectionMatrix)
  }

  private rebuildScene() {
    this.scene.clear()
    this.model?.updateWorldMatrix(true, true)
    this.model?.traverse((object) => {
      if (
        object instanceof Mesh &&
        object.material instanceof MeshStandardMaterial
      ) {
        const mesh = new Mesh(object.geometry, object.material)
        mesh.matrixAutoUpdate = false
        mesh.matrix.copy(object.matrixWorld)
        this.scene.add(mesh)
      }
    })
  }

  /** Without a denoiser, the render settles when every pixel has its samples. */
  private measureSamples() {
    if (this.measuringSamples) {
      return
    }
    this.measuringSamples = true
    const renderTime = this.pathTracer.getRenderTime()
    const revision = this.revision
    this.pathTracer
      .getSampleCountsAsync()
      .then(({ min }) => {
        this.measuringSamples = false
        if (this.disposed) {
          return
        }
        // A reset while measuring makes the count stale.
        if (
          revision === this.revision &&
          this.pathTracer.getRenderTime() >= renderTime &&
          min >= this.pathTracer.maxSamples
        ) {
          this.samplesReached = true
          this.onChange()
        }
      })
      .catch(reportRejection)
      .finally(() => {
        this.measuringSamples = false
      })
  }

  private invalidate() {
    this.revision++
    this.samplesReached = false
    this.settled = false
  }
}

async function bakeEquirectEnvironment(
  renderer: WebGPURenderer,
  environment: Texture
) {
  // The path tracer's equirect mapping: rows run from -Y up to +Y, and
  // columns go around the Y axis.
  const theta = screenUV.x.sub(0.5).mul(2 * Math.PI)
  const phi = screenUV.y.oneMinus().mul(Math.PI)
  const direction = vec3(
    phi.sin().mul(theta.cos()),
    phi.cos(),
    phi.sin().mul(theta.sin())
  )
  const material = new NodeMaterial()
  material.fragmentNode = vec4(
    pmremTexture(environment, direction, float(0)).rgb,
    1
  )
  const quad = new QuadMesh(material)
  const target = new RenderTarget(ENVIRONMENT_WIDTH, ENVIRONMENT_HEIGHT, {
    type: FloatType,
    depthBuffer: false,
  })
  const previousTarget = renderer.getRenderTarget()
  try {
    renderer.setRenderTarget(target)
    quad.render(renderer)
    const pixels = await renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      ENVIRONMENT_WIDTH,
      ENVIRONMENT_HEIGHT
    )
    const equirect = new DataTexture(
      pixels,
      ENVIRONMENT_WIDTH,
      ENVIRONMENT_HEIGHT,
      RGBAFormat,
      FloatType
    )
    equirect.mapping = EquirectangularReflectionMapping
    // The path tracer samples it with a sampler, which three.js leaves out
    // for a texture with the DataTexture default of nearest filtering.
    equirect.minFilter = LinearFilter
    equirect.magFilter = LinearFilter
    equirect.needsUpdate = true
    return equirect
  } finally {
    renderer.setRenderTarget(previousTarget)
    target.dispose()
    material.dispose()
  }
}
