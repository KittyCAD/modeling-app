import type { RenderTarget, Scene } from 'three'
import type Renderer from 'three/src/renderers/common/Renderer.js'

const DEFAULT_ENVIRONMENT_INTENSITY = 0.85
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

    const [{ default: PMREMGenerator }, { RoomEnvironment }] =
      await Promise.all([
        import('three/src/renderers/common/extras/PMREMGenerator.js'),
        import('three/examples/jsm/environments/RoomEnvironment.js'),
      ])
    const roomEnvironment = new RoomEnvironment()
    const pmremGenerator = new PMREMGenerator(this.renderer)

    try {
      const environmentRenderTarget = pmremGenerator.fromScene(
        roomEnvironment,
        0.04,
        0.1,
        100,
        { size: DEFAULT_PMREM_SIZE }
      )
      this.environmentRenderTarget = environmentRenderTarget
      await this.device.queue.onSubmittedWorkDone()
    } catch (error) {
      this.environmentRenderTarget?.dispose()
      this.environmentRenderTarget = null
      throw error
    } finally {
      roomEnvironment.dispose()
      pmremGenerator.dispose()
    }

    this.scene = scene
    scene.environment = this.environmentRenderTarget.texture
    scene.environmentIntensity = DEFAULT_ENVIRONMENT_INTENSITY
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
}
