import { signal } from '@preact/signals-core'
import { isErr } from '@src/lib/trap'
import {
  DriverSpaceMouseController,
  type SpaceMouseCameraControls,
  type SpaceMouseScene,
} from './driverSpaceMouse'

export type SpaceMouseState = {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
}

export const spaceMouseState = signal<SpaceMouseState>({
  status: 'disconnected',
})

export const activeSpaceMouseController = signal<SpaceMouseController | null>(
  null
)

export class SpaceMouseController {
  private driver: DriverSpaceMouseController | null = null
  private disposed = false

  constructor(
    readonly cameraControls: SpaceMouseCameraControls,
    private readonly scene: SpaceMouseScene
  ) {}

  async connect(): Promise<undefined | Error> {
    if (this.disposed || this.driver) return
    spaceMouseState.value = { status: 'connecting' }
    const driver = new DriverSpaceMouseController(
      this.cameraControls,
      this.scene,
      (reason) => {
        if (this.disposed || this.driver !== driver) return
        this.disconnect()
        spaceMouseState.value = { status: 'error', error: reason }
      }
    )
    this.driver = driver
    const result = await driver.connect()
    if (this.disposed || this.driver !== driver) return
    if (isErr(result)) {
      this.disconnect()
      spaceMouseState.value = { status: 'error', error: result.message }
      return result
    }
    spaceMouseState.value = { status: 'connected' }
  }

  disconnect() {
    const driver = this.driver
    this.driver = null
    driver?.dispose()
    spaceMouseState.value = { status: 'disconnected' }
  }

  dispose() {
    this.disposed = true
    this.disconnect()
  }
}
