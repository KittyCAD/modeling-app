import {
  EquirectangularReflectionMapping,
  type RenderTarget,
  type Scene,
} from 'three'
import type { Renderer } from 'three/webgpu'

const DEFAULT_ENVIRONMENT_INTENSITY = 1
const DEFAULT_PMREM_SIZE = 128

export class EnvMapLoader {
  private environmentRenderTarget: RenderTarget | null = null
  private scene: Scene | null = null

  constructor(
    private readonly renderer: Renderer,
    private readonly device: GPUDevice
  ) {}

  async loadDefault(scene: Scene) {
    this.dispose()

    const [{ PMREMGenerator }, { RoomEnvironment }] = await Promise.all([
      import('three/webgpu'),
      import('three/examples/jsm/environments/RoomEnvironment.js'),
    ])
    const roomEnvironment = new RoomEnvironment()
    const pmremGenerator = new PMREMGenerator(this.renderer)

    let environmentRenderTarget: RenderTarget | null = null
    try {
      environmentRenderTarget = pmremGenerator.fromScene(
        roomEnvironment,
        0.04,
        0.1,
        100,
        { size: DEFAULT_PMREM_SIZE }
      )
      await this.device.queue.onSubmittedWorkDone()
    } catch (error) {
      environmentRenderTarget?.dispose()
      throw error
    } finally {
      roomEnvironment.dispose()
      pmremGenerator.dispose()
    }

    this.applyEnvironment(scene, environmentRenderTarget)
  }

  async loadHdr(scene: Scene, url: string) {
    this.dispose()

    const [{ HDRLoader }, { PMREMGenerator }] = await Promise.all([
      import('three/examples/jsm/loaders/HDRLoader.js'),
      import('three/webgpu'),
    ])
    const hdrTexture = await new HDRLoader().loadAsync(url)
    hdrTexture.mapping = EquirectangularReflectionMapping
    const pmremGenerator = new PMREMGenerator(this.renderer)
    let environmentRenderTarget: RenderTarget | null = null

    try {
      environmentRenderTarget = pmremGenerator.fromEquirectangular(hdrTexture)
      await this.device.queue.onSubmittedWorkDone()
    } catch (error) {
      environmentRenderTarget?.dispose()
      throw error
    } finally {
      hdrTexture.dispose()
      pmremGenerator.dispose()
    }

    this.applyEnvironment(scene, environmentRenderTarget)
  }

  dispose() {
    if (
      this.scene &&
      this.scene.environment === this.environmentRenderTarget?.texture
    ) {
      this.scene.environment = null
    }
    this.environmentRenderTarget?.dispose()
    this.environmentRenderTarget = null
    this.scene = null
  }

  private applyEnvironment(
    scene: Scene,
    environmentRenderTarget: RenderTarget
  ) {
    this.environmentRenderTarget = environmentRenderTarget
    this.scene = scene
    scene.environment = environmentRenderTarget.texture
    scene.environmentIntensity = DEFAULT_ENVIRONMENT_INTENSITY
  }
}
