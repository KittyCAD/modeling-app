import { isDesktop } from '@src/lib/isDesktop'
import { err, report, reportRejection } from '@src/lib/trap'
import {
  DriverSpaceMouseController,
  type SpaceMouseCameraControls,
  type SpaceMouseScene,
} from './driverSpaceMouse'

export class SpaceMouseController {
  private driver: DriverSpaceMouseController | null = null
  private disposed = false

  constructor(
    private readonly cameraControls: SpaceMouseCameraControls,
    private readonly scene: SpaceMouseScene
  ) {}

  async autoConnect(): Promise<void> {
    if (this.disposed || !this.cameraControls.localCameraMode) return
    if (isDesktop()) return this.connect()

    let permission: PermissionState = 'prompt'
    try {
      const result = await navigator.permissions.query({
        // @ts-expect-error Chrome's loopback permission is not in lib.dom yet.
        name: 'loopback-network',
      })
      permission = result.state
    } catch {
      // Browsers without this permission query can try on the first click.
    }
    if (this.disposed) return
    if (permission === 'granted') return this.connect()
    if (permission === 'prompt') {
      this.cameraControls.domElement.addEventListener(
        'click',
        this.connectOnViewportClick,
        { once: true }
      )
    }
  }

  private connectOnViewportClick = () => {
    this.connect(true).catch(reportRejection)
  }

  private async connect(fromViewportClick = false): Promise<void> {
    if (this.disposed || this.driver || !this.cameraControls.localCameraMode)
      return
    const driver = new DriverSpaceMouseController(
      this.cameraControls,
      this.scene,
      (reason) => {
        if (this.driver !== driver) return
        this.disconnect()
        report(reason)
      }
    )
    this.driver = driver
    if (fromViewportClick) {
      this.cameraControls.domElement.focus({ preventScroll: true })
    }
    // Leave time for the browser's permission prompt before timing out.
    const result = await driver.connect(fromViewportClick ? 60_000 : undefined)
    if (this.driver === driver && err(result)) this.disconnect()
  }

  private disconnect() {
    const driver = this.driver
    this.driver = null
    driver?.dispose()
  }

  dispose() {
    this.disposed = true
    this.cameraControls.domElement.removeEventListener(
      'click',
      this.connectOnViewportClick
    )
    this.disconnect()
  }
}
