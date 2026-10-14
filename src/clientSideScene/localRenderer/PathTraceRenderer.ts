import {
  LOCAL_WEBGPU_PATH_TRACE_DENOISED_SAMPLES,
  LOCAL_WEBGPU_PATH_TRACE_PIXEL_RATIO,
  LOCAL_WEBGPU_PATH_TRACE_SAMPLES,
} from '@src/clientSideScene/localRenderer/config'
import { reportRejection } from '@src/lib/trap'
import { initUNetFromURL, type UNet } from 'oidn-web'
import denoiserWeightsUrl from 'oidn-weights/rt_hdr_alb_nrm.tza?url'
import {
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
  type Texture,
} from 'three'
import { float, pmremTexture, screenUV, vec3, vec4 } from 'three/tsl'
import {
  NodeMaterial,
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

  setModel(model: Object3D | null) {
    this.model = model
    this.modelChanged = true
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
    this.samplesReached = false
    this.settled = false
    this.onChange()
  }

  /** Adds samples and draws the image into the current render target. */
  render(camera: PerspectiveCamera | OrthographicCamera) {
    const { pathTracer } = this
    if (this.modelChanged) {
      this.modelChanged = false
      this.rebuildScene()
      pathTracer.setScene(this.scene, camera)
      this.trackCamera(camera)
    } else if (camera !== this.camera) {
      pathTracer.setCamera(camera)
      // setCamera leaves the denoiser drawing its guides from the old camera.
      this.denoiser.setScene(this.scene, camera)
      this.trackCamera(camera)
    } else if (
      !this.cameraMatrix.equals(camera.matrixWorld) ||
      !this.projectionMatrix.equals(camera.projectionMatrix)
    ) {
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
    pathTracer.renderSample()

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
  }

  dispose() {
    this.disposed = true
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
    this.pathTracer
      .getSampleCountsAsync()
      .then(({ min }) => {
        this.measuringSamples = false
        if (this.disposed) {
          return
        }
        // A reset while measuring makes the count stale.
        if (
          this.pathTracer.getRenderTime() >= renderTime &&
          min >= this.pathTracer.maxSamples
        ) {
          this.samplesReached = true
          this.onChange()
        }
      })
      .catch(reportRejection)
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
