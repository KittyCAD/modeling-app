import { signal } from '@preact/signals-core'
import type { CameraControls } from '@src/clientSideScene/CameraControls'
import {
  DriverSpaceMouseController,
  isDriverSpaceMouseSupported,
} from './driverSpaceMouse'

const INPUT_REPORT_INITIAL_LOG_LIMIT = 10
const INPUT_REPORT_LOG_INTERVAL_MS = 1000
const SPACEMOUSE_LOG_PREFIX = '[SpaceMouse]'

type SpaceMouseLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type SpaceMouseState = {
  status: 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error'
  deviceName?: string
  error?: string
  lastInputAt?: number
}

export const spaceMouseState = signal<SpaceMouseState>({
  status: 'disconnected',
})

let activeController: SpaceMouseController | null = null

export function logSpaceMouse(
  level: SpaceMouseLogLevel,
  message: string,
  data?: unknown
) {
  const method = console[level] ?? console.log
  if (data === undefined) {
    method(`${SPACEMOUSE_LOG_PREFIX} ${message}`)
    return
  }

  method(`${SPACEMOUSE_LOG_PREFIX} ${message}`, data)
}

export function isSpaceMouseSupported() {
  return isDriverSpaceMouseSupported()
}

export function setActiveSpaceMouseController(
  controller: SpaceMouseController | null
) {
  activeController = controller
  logSpaceMouse(
    'debug',
    controller ? 'active controller set' : 'active controller cleared'
  )
  if (!controller && spaceMouseState.value.status !== 'unsupported') {
    spaceMouseState.value = { status: 'disconnected' }
  }
}

export function getActiveSpaceMouseController() {
  return activeController
}

export class SpaceMouseController {
  private driverSpaceMouse: DriverSpaceMouseController | null = null
  private inputReportLogCount = 0
  private lastInputReportLogAt = 0

  constructor(private readonly cameraControls: CameraControls) {
    spaceMouseState.value = isSpaceMouseSupported()
      ? { status: 'disconnected' }
      : { status: 'unsupported' }

    logSpaceMouse('info', 'controller created', {
      driverBridgeAvailable: isDriverSpaceMouseSupported(),
    })
  }

  async connect() {
    if (!isDriverSpaceMouseSupported()) {
      const error =
        '3Dconnexion driver bridge is not supported in this runtime.'
      spaceMouseState.value = { status: 'unsupported', error }
      logSpaceMouse('warn', error)
      throw new Error(error)
    }

    spaceMouseState.value = { status: 'connecting' }
    this.disposeDriverSpaceMouse()
    this.driverSpaceMouse = new DriverSpaceMouseController(
      this.cameraControls,
      {
        log: logSpaceMouse,
        onConnected: (deviceName) => {
          spaceMouseState.value = {
            ...spaceMouseState.value,
            status: 'connected',
            deviceName,
          }
        },
        onDisconnected: (reason) => {
          spaceMouseState.value = {
            status: 'disconnected',
            error: reason,
          }
        },
        onInput: ({ viewMatrix }) => {
          const now = Date.now()
          spaceMouseState.value = {
            ...spaceMouseState.value,
            status: 'connected',
            deviceName:
              spaceMouseState.value.deviceName || '3Dconnexion driver',
            lastInputAt: now,
          }
          if (this.shouldLogInputReport(now)) {
            logSpaceMouse('info', '3Dconnexion driver view matrix input', {
              viewMatrix,
            })
          }
        },
      }
    )

    try {
      const result = await this.driverSpaceMouse.connect()
      logSpaceMouse(
        result.ok ? 'info' : 'warn',
        '3Dconnexion driver bridge connect result',
        result
      )
      if (!result.ok) {
        this.disposeDriverSpaceMouse()
        spaceMouseState.value = { status: 'error', error: result.error }
        throw new Error(result.error)
      }
    } catch (error) {
      this.disposeDriverSpaceMouse()
      const message = error instanceof Error ? error.message : String(error)
      spaceMouseState.value = { status: 'error', error: message }
      logSpaceMouse('warn', '3Dconnexion driver bridge connect failed', error)
      throw error
    }
  }

  dispose() {
    logSpaceMouse('info', 'disposing controller')
    this.disposeDriverSpaceMouse()
  }

  private shouldLogInputReport(now: number) {
    this.inputReportLogCount += 1
    if (this.inputReportLogCount <= INPUT_REPORT_INITIAL_LOG_LIMIT) {
      this.lastInputReportLogAt = now
      return true
    }

    if (now - this.lastInputReportLogAt >= INPUT_REPORT_LOG_INTERVAL_MS) {
      this.lastInputReportLogAt = now
      return true
    }

    return false
  }

  private disposeDriverSpaceMouse() {
    this.driverSpaceMouse?.dispose()
    this.driverSpaceMouse = null
  }
}
