import type { CameraControls } from '@src/clientSideScene/CameraControls'
import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import driverScriptUrl from './3dconnexion.min.js?url'

const DRIVER_SCRIPT_ID = 'spacemouse-3dconnexion-driver-script'
const DEFAULT_CONNECT_TIMEOUT_MS = 2500
const SPACEMOUSE_CANVAS_ID = 'client-side-scene-canvas'

type SpaceMouseLogLevel = 'debug' | 'info' | 'warn' | 'error'
type SixteenNumbers = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]
type ViewExtents = [number, number, number, number, number, number]
type BoundingBox = ViewExtents
type Position = [number, number, number]

type DriverSpaceMouseLog = (
  level: SpaceMouseLogLevel,
  message: string,
  data?: unknown
) => void

type DriverSpaceMouseEvents = {
  log: DriverSpaceMouseLog
  onConnected: (deviceName: string) => void
  onDisconnected: (reason: string) => void
  onInput: (data: { viewMatrix: SixteenNumbers }) => void
}

type ThreeDconnexionInstance = {
  connect: () => number
  debug: boolean
  create3dmouse: (canvas: HTMLElement, name: string, options?: number) => void
  update3dcontroller: (options: unknown) => void
  delete3dmouse: () => void
  close?: () => void
  connected: boolean
  session: unknown
}

type ThreeDconnexionConstructor = {
  new (client: DriverSpaceMouseController): ThreeDconnexionInstance
  nlOptions?: {
    none: number
    rowMajorOrder: number
  }
}

declare const _3Dconnexion: ThreeDconnexionConstructor | undefined

let driverScriptLoadPromise: Promise<ThreeDconnexionConstructor> | null = null

export function isDriverSpaceMouseSupported() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export async function load3DconnexionDriverScript(
  log: DriverSpaceMouseLog
): Promise<ThreeDconnexionConstructor> {
  const existingConstructor = get3DconnexionConstructor()
  if (existingConstructor) {
    return existingConstructor
  }

  if (driverScriptLoadPromise) {
    return driverScriptLoadPromise
  }

  driverScriptLoadPromise = new Promise<ThreeDconnexionConstructor>(
    (resolve, reject) => {
      if (!isDriverSpaceMouseSupported()) {
        reject(
          new Error('3Dconnexion driver bridge requires a browser window.')
        )
        return
      }

      const existingScript = document.getElementById(DRIVER_SCRIPT_ID)
      if (existingScript instanceof HTMLScriptElement) {
        if (existingScript.dataset.loaded === 'true') {
          const constructor = get3DconnexionConstructor()
          if (constructor) {
            resolve(constructor)
            return
          }
          existingScript.remove()
          reject(
            new Error('3Dconnexion driver script did not expose _3Dconnexion.')
          )
          return
        }

        existingScript.addEventListener('load', () => {
          const constructor = get3DconnexionConstructor()
          if (constructor) {
            resolve(constructor)
            return
          }
          reject(
            new Error('3Dconnexion driver script did not expose _3Dconnexion.')
          )
        })
        existingScript.addEventListener('error', () => {
          reject(new Error('Unable to load 3Dconnexion driver script.'))
        })
        return
      }

      const script = document.createElement('script')
      script.id = DRIVER_SCRIPT_ID
      script.async = true
      script.src = driverScriptUrl
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true'
        const constructor = get3DconnexionConstructor()
        if (!constructor) {
          script.remove()
          reject(
            new Error('3Dconnexion driver script did not expose _3Dconnexion.')
          )
          return
        }

        log('info', '3Dconnexion driver script loaded', {
          src: script.src,
        })
        resolve(constructor)
      })
      script.addEventListener('error', () => {
        script.remove()
        reject(new Error('Unable to load 3Dconnexion driver script.'))
      })

      log('info', 'loading 3Dconnexion driver script', { src: script.src })
      document.head.appendChild(script)
    }
  ).catch((error) => {
    driverScriptLoadPromise = null
    throw error
  })

  return driverScriptLoadPromise
}

export class DriverSpaceMouseController {
  private spaceMouse: ThreeDconnexionInstance | null = null
  private animating = false
  private disposed = false
  private readonly canvas: HTMLCanvasElement
  private readonly previousCanvasId: string
  private readonly previousCanvasTabIndex: string | null
  private readonly previousCanvasOutline: string

  constructor(
    private readonly cameraControls: CameraControls,
    private readonly events: DriverSpaceMouseEvents
  ) {
    this.canvas = cameraControls.domElement
    this.previousCanvasId = this.canvas.id
    this.previousCanvasTabIndex = this.canvas.getAttribute('tabindex')
    this.previousCanvasOutline = this.canvas.style.outline
    this.prepareCanvas()
  }

  async connect(timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
    this.events.log('info', 'connecting to 3Dconnexion driver bridge', {
      timeoutMs,
    })

    const DriverConstructor = await load3DconnexionDriverScript(this.events.log)
    this.spaceMouse = new DriverConstructor(this)
    this.spaceMouse.debug = false
    const connectResult = this.spaceMouse.connect()
    this.events.log('info', '3Dconnexion driver bridge connect requested', {
      connectResult,
    })

    await delay(timeoutMs)

    if (this.disposed) {
      return {
        ok: false,
        error: '3Dconnexion driver bridge was disposed before it connected.',
      }
    }

    if (!this.spaceMouse.connected) {
      return {
        ok: false,
        error:
          'Cannot connect to the local 3Dconnexion driver service. Make sure 3DxWare is running. If the web console shows ERR_CERT_AUTHORITY_INVALID for 127.51.68.120, restart Electron so the local 3Dconnexion certificate exception is active.',
      }
    }

    if (this.spaceMouse.session === null) {
      return {
        ok: false,
        error: 'Connected to 3Dconnexion driver service without a session.',
      }
    }

    this.events.onConnected('3Dconnexion driver')
    return { ok: true }
  }

  dispose() {
    this.disposed = true
    this.animating = false
    try {
      this.spaceMouse?.delete3dmouse()
    } catch (error) {
      this.events.log(
        'warn',
        'failed to delete 3Dconnexion driver mouse',
        error
      )
    }
    try {
      this.spaceMouse?.close?.()
    } catch (error) {
      this.events.log(
        'warn',
        'failed to close 3Dconnexion driver session',
        error
      )
    }
    this.spaceMouse = null
    this.restoreCanvas()
  }

  render(time: number) {
    if (!this.animating || !this.spaceMouse) {
      return
    }

    this.spaceMouse.update3dcontroller({
      frame: { time },
    })
    window.requestAnimationFrame((nextTime) => this.render(nextTime))
  }

  onStartMotion() {
    this.events.log('debug', '3Dconnexion driver motion started')
    if (this.animating) {
      return
    }

    this.animating = true
    window.requestAnimationFrame((time) => this.render(time))
  }

  onStopMotion() {
    this.events.log('debug', '3Dconnexion driver motion stopped')
    this.animating = false
  }

  onConnect() {
    this.events.log('info', '3Dconnexion driver bridge connected')
    if (!this.spaceMouse) {
      throw new Error('3Dconnexion driver bridge is missing after connect.')
    }

    this.canvas.focus({ preventScroll: true })
    this.spaceMouse.create3dmouse(this.canvas, 'Zoo Design Studio')
  }

  onDisconnect(reason: string) {
    this.events.log('warn', '3Dconnexion driver bridge disconnected', {
      reason,
    })
    this.events.onDisconnected(reason)
  }

  on3dmouseCreated() {
    this.events.log('info', '3Dconnexion driver mouse created')
    if (!this.spaceMouse) {
      throw new Error(
        '3Dconnexion driver bridge is missing after mouse create.'
      )
    }

    this.spaceMouse.update3dcontroller({
      frame: { timingSource: 1 },
    })
    this.events.onConnected('3Dconnexion driver')
  }

  getCoordinateSystem(): SixteenNumbers {
    return identityMatrix()
  }

  getFrontView(): SixteenNumbers {
    return identityMatrix()
  }

  getModelExtents(): BoundingBox {
    const distance = Math.max(
      this.cameraControls.camera.position.distanceTo(
        this.cameraControls.target
      ),
      10
    )
    const center = this.cameraControls.target
    return [
      center.x - distance,
      center.y - distance,
      center.z - distance,
      center.x + distance,
      center.y + distance,
      center.z + distance,
    ]
  }

  getUnitsToMeters() {
    return 0.001
  }

  getPerspective() {
    return this.cameraControls.camera instanceof PerspectiveCamera
  }

  getViewMatrix(): SixteenNumbers {
    this.cameraControls.camera.updateMatrixWorld(true)
    return asSixteenNumbers(this.cameraControls.camera.matrixWorld.toArray())
  }

  getFov() {
    const camera = this.cameraControls.camera
    if (!(camera instanceof PerspectiveCamera)) {
      return 0
    }

    return (
      2 *
      Math.atan(
        Math.atan2((camera.fov * Math.PI) / 180, 2) *
          Math.sqrt(1 + camera.aspect * camera.aspect)
      )
    )
  }

  getViewExtents(): ViewExtents {
    const camera = this.cameraControls.camera
    if (!(camera instanceof OrthographicCamera)) {
      return [0, 0, 0, 0, 0, 0]
    }

    return [
      camera.left,
      camera.bottom,
      -camera.far,
      camera.right,
      camera.top,
      -camera.near,
    ]
  }

  getViewFrustum(): ViewExtents {
    const camera = this.cameraControls.camera
    if (!(camera instanceof PerspectiveCamera)) {
      return [0, 0, 0, 0, 0, 0]
    }

    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360)
    const bottom = -camera.near * tanHalfFov
    const left = bottom * camera.aspect
    return [left, -left, bottom, -bottom, camera.near, camera.far]
  }

  getFrameTime() {
    return performance.now()
  }

  getFrameTimingSource() {
    return 1
  }

  getViewRotatable() {
    return true
  }

  getLookAt() {
    return null
  }

  getViewTarget(): Position {
    const target = this.cameraControls.target
    return [target.x, target.y, target.z]
  }

  getPivotPosition(): Position {
    const target = this.cameraControls.target
    return [target.x, target.y, target.z]
  }

  getPointerPosition(): Position {
    const target = this.cameraControls.target
    return [target.x, target.y, target.z]
  }

  getSelectionEmpty() {
    return true
  }

  getSelectionExtents(): BoundingBox {
    return this.getModelExtents()
  }

  getSelectionAffine(): SixteenNumbers {
    return identityMatrix()
  }

  getConstructionPlane() {
    return [0, 0, 1, 0]
  }

  getFloorPlane() {
    return [0, 0, 1, 0]
  }

  setMoving(isMoving: boolean) {
    if (isMoving) {
      this.onStartMotion()
      return
    }
    this.onStopMotion()
  }

  setTransaction(transaction: number) {
    this.events.log('debug', '3Dconnexion driver transaction', {
      transaction,
    })
  }

  setViewMatrix(viewMatrix: SixteenNumbers) {
    this.events.onInput({ viewMatrix })
    this.applyViewMatrix(viewMatrix)
  }

  setViewExtents(viewExtents: ViewExtents) {
    const camera = this.cameraControls.camera
    if (!(camera instanceof OrthographicCamera)) {
      return
    }

    camera.left = viewExtents[0]
    camera.bottom = viewExtents[1]
    camera.right = viewExtents[3]
    camera.top = viewExtents[4]
    camera.updateProjectionMatrix()
    this.cameraControls.onCameraChange(true)
  }

  setFov(fov: number) {
    const camera = this.cameraControls.camera
    if (!(camera instanceof PerspectiveCamera)) {
      return
    }

    camera.fov = (fov * 180) / Math.PI
    camera.updateProjectionMatrix()
    this.cameraControls.onCameraChange(true)
  }

  setActiveCommand(commandId: string) {
    this.events.log('info', '3Dconnexion driver command', {
      commandId,
    })
  }

  setTarget(data: unknown) {
    this.events.log('debug', '3Dconnexion driver set target', data)
  }

  setPivotPosition(data: unknown) {
    this.events.log('debug', '3Dconnexion driver set pivot position', data)
  }

  setPivotVisible(data: unknown) {
    this.events.log('debug', '3Dconnexion driver set pivot visible', data)
  }

  setLookFrom(data: unknown) {
    this.events.log('debug', '3Dconnexion driver set look from', data)
  }

  setLookDirection(data: unknown) {
    this.events.log('debug', '3Dconnexion driver set look direction', data)
  }

  setLookAperture(data: unknown) {
    this.events.log('debug', '3Dconnexion driver set look aperture', data)
  }

  setSelectionOnly(data: unknown) {
    this.events.log('debug', '3Dconnexion driver set selection only', data)
  }

  setSelectionAffine(data: unknown) {
    this.events.log('debug', '3Dconnexion driver set selection affine', data)
  }

  setKeyPress(data: unknown) {
    this.events.log('info', '3Dconnexion driver key press', data)
  }

  setKeyRelease(data: unknown) {
    this.events.log('info', '3Dconnexion driver key release', data)
  }

  setSettingsChanged(data: unknown) {
    this.events.log('debug', '3Dconnexion driver settings changed', data)
  }

  private prepareCanvas() {
    if (!this.canvas.id) {
      this.canvas.id = SPACEMOUSE_CANVAS_ID
    }
    this.canvas.tabIndex = 0
    this.canvas.style.outline = 'none'
  }

  private restoreCanvas() {
    if (this.previousCanvasId) {
      this.canvas.id = this.previousCanvasId
    } else {
      this.canvas.removeAttribute('id')
    }

    if (this.previousCanvasTabIndex === null) {
      this.canvas.removeAttribute('tabindex')
    } else {
      this.canvas.setAttribute('tabindex', this.previousCanvasTabIndex)
    }

    this.canvas.style.outline = this.previousCanvasOutline
  }

  private applyViewMatrix(viewMatrix: SixteenNumbers) {
    const camera = this.cameraControls.camera
    const previousDistance = Math.max(
      camera.position.distanceTo(this.cameraControls.target),
      1
    )

    const cameraMatrix = new Matrix4().fromArray([...viewMatrix])
    cameraMatrix.decompose(camera.position, camera.quaternion, camera.scale)

    const forward = new Vector3(0, 0, -1)
      .applyQuaternion(camera.quaternion)
      .normalize()
    this.cameraControls.target
      .copy(camera.position)
      .add(forward.multiplyScalar(previousDistance))
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize()

    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    this.cameraControls.onCameraChange(true)
  }
}

function get3DconnexionConstructor() {
  return typeof _3Dconnexion === 'undefined' ? null : _3Dconnexion
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function identityMatrix(): SixteenNumbers {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function asSixteenNumbers(values: number[]): SixteenNumbers {
  if (values.length !== 16) {
    throw new Error('Expected a 16-value 3Dconnexion view matrix.')
  }

  return values as unknown as SixteenNumbers
}
