import type { CameraControls } from '@src/clientSideScene/CameraControls'
import { isErr } from '@src/lib/trap'
import {
  type Box3,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'
// Serve the classic SDK untouched; Vite's JS transforms can inject module imports.
import driverScriptUrl from '/vendor/3dconnexion.min.js?url'

const DRIVER_SCRIPT_ID = 'spacemouse-3dconnexion-driver-script'
const CONNECT_ERROR =
  'Cannot connect to the local 3Dconnexion service. Install or restart 3DxWare, allow local network access, and check that its local certificate is trusted.'

type Extents = [number, number, number, number, number, number]
type Position = [number, number, number]

export type SpaceMouseCameraControls = Pick<
  CameraControls,
  | 'camera'
  | 'target'
  | 'domElement'
  | 'localCameraMode'
  | 'enableRotate'
  | 'enablePan'
  | 'enableZoom'
  | 'isDragging'
  | 'isFovAnimationInProgress'
  | 'cameraChange'
  | 'onCameraChange'
>

export type SpaceMouseScene = {
  getBounds: () => Box3 | undefined
  getSelectionBounds: () => Box3 | undefined
  canRotate: () => boolean
}

type ThreeDconnexionInstance = {
  session: {
    call: (
      procedure: string,
      instance: string,
      properties: unknown
    ) => Promise<unknown>
  } | null
  _3dcontroller: number | string | null
  connect: () => number
  create3dmouse: (canvas: HTMLElement, name: string) => void
  update3dcontroller: (options: unknown) => void
  delete3dmouse: () => void
  close: () => void
}

type ThreeDconnexionConstructor = new (
  client: DriverSpaceMouseController
) => ThreeDconnexionInstance

declare const _3Dconnexion: ThreeDconnexionConstructor | undefined

let driverScriptLoadPromise: Promise<
  ThreeDconnexionConstructor | Error
> | null = null

function loadDriverScript(): Promise<ThreeDconnexionConstructor | Error> {
  if (typeof _3Dconnexion !== 'undefined') return Promise.resolve(_3Dconnexion)
  if (driverScriptLoadPromise) return driverScriptLoadPromise

  driverScriptLoadPromise = new Promise<ThreeDconnexionConstructor | Error>(
    (resolve) => {
      const script = document.createElement('script')
      script.id = DRIVER_SCRIPT_ID
      script.src = driverScriptUrl
      const timeout = setTimeout(
        () =>
          finish(new Error('Loading the 3Dconnexion driver script timed out.')),
        5000
      )
      const finish = (result: ThreeDconnexionConstructor | Error) => {
        clearTimeout(timeout)
        script.onload = null
        script.onerror = null
        if (isErr(result)) {
          script.remove()
          driverScriptLoadPromise = null
        }
        resolve(result)
      }
      script.onload = () =>
        finish(
          typeof _3Dconnexion === 'undefined'
            ? new Error(
                'The 3Dconnexion driver script could not be initialized.'
              )
            : _3Dconnexion
        )
      script.onerror = () =>
        finish(new Error('Unable to load the 3Dconnexion driver script.'))
      document.head.appendChild(script)
    }
  )
  return driverScriptLoadPromise
}

export class DriverSpaceMouseController {
  private spaceMouse: ThreeDconnexionInstance | null = null
  private disposed = false
  private frame: number | undefined
  private finishConnecting: ((result?: Error) => void) | undefined
  private cameraRevision = 0
  private syncedCameraRevision = 0
  private applyingDriverUpdate = false
  private synchronizingCamera = false
  private readonly removeCameraChangeListener: () => void
  private readonly previousCanvasId: string
  private readonly previousCanvasTabIndex: string | null
  private readonly previousCanvasOutline: string

  constructor(
    private readonly controls: SpaceMouseCameraControls,
    private readonly scene: SpaceMouseScene,
    private readonly onDisconnected: (reason: string) => void
  ) {
    this.removeCameraChangeListener = controls.cameraChange.add(() => {
      if (!this.applyingDriverUpdate) this.cameraRevision += 1
    })
    const canvas = controls.domElement
    this.previousCanvasId = canvas.id
    this.previousCanvasTabIndex = canvas.getAttribute('tabindex')
    this.previousCanvasOutline = canvas.style.outline
    if (!canvas.id) canvas.id = 'spacemouse-viewport'
    canvas.tabIndex = 0
    canvas.style.outline = 'none'
    canvas.addEventListener('pointerdown', this.focusCanvas)
    canvas.addEventListener('blur', this.onStopMotion)
    window.addEventListener('blur', this.onStopMotion)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
  }

  async connect(timeoutMs = 5000): Promise<undefined | Error> {
    const DriverConstructor = await loadDriverScript()
    if (this.disposed) return new Error('SpaceMouse connection cancelled.')
    if (isErr(DriverConstructor)) return DriverConstructor

    // A live websocket is insufficient: wait for the navigation controller.
    return new Promise<undefined | Error>((resolve) => {
      const timeout = setTimeout(
        () => this.finishConnecting?.(new Error(CONNECT_ERROR)),
        timeoutMs
      )
      this.finishConnecting = (error) => {
        clearTimeout(timeout)
        this.finishConnecting = undefined
        resolve(error)
      }
      try {
        this.spaceMouse = new DriverConstructor(this)
        if (!this.spaceMouse.connect())
          this.finishConnecting?.(new Error(CONNECT_ERROR))
      } catch (error) {
        this.finishConnecting?.(
          error instanceof Error ? error : new Error(String(error))
        )
      }
    })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.removeCameraChangeListener()
    this.onStopMotion()
    this.finishConnecting?.(new Error('SpaceMouse connection cancelled.'))
    this.closeDriver()
    const canvas = this.controls.domElement
    canvas.removeEventListener('pointerdown', this.focusCanvas)
    canvas.removeEventListener('blur', this.onStopMotion)
    window.removeEventListener('blur', this.onStopMotion)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    if (this.previousCanvasId) canvas.id = this.previousCanvasId
    else canvas.removeAttribute('id')
    if (this.previousCanvasTabIndex === null) canvas.removeAttribute('tabindex')
    else canvas.setAttribute('tabindex', this.previousCanvasTabIndex)
    canvas.style.outline = this.previousCanvasOutline
  }

  private closeDriver() {
    try {
      this.spaceMouse?.delete3dmouse()
      this.spaceMouse?.close()
    } catch (error) {
      console.warn('Unable to close the 3Dconnexion session.', error)
    }
  }

  private focusCanvas = () =>
    this.controls.domElement.focus({ preventScroll: true })

  private isViewportActive() {
    return (
      !this.disposed &&
      this.controls.localCameraMode &&
      document.hasFocus() &&
      !document.hidden &&
      document.activeElement === this.controls.domElement
    )
  }

  private canNavigate() {
    return (
      this.isViewportActive() &&
      this.cameraRevision === this.syncedCameraRevision &&
      !this.controls.isDragging &&
      !this.controls.isFovAnimationInProgress
    )
  }

  private onVisibilityChange = () => {
    if (document.hidden) this.onStopMotion()
  }

  private render = (time: number) => {
    this.frame = undefined
    if (!this.isViewportActive()) return
    if (!this.controls.isDragging && !this.controls.isFovAnimationInProgress) {
      if (this.cameraRevision !== this.syncedCameraRevision) {
        this.syncCameraToDriver().catch((error: unknown) => {
          this.onDisconnect(
            error instanceof Error
              ? error.message
              : 'Unable to synchronize the SpaceMouse camera.'
          )
        })
      } else {
        this.spaceMouse?.update3dcontroller({ frame: { time } })
      }
    }
    // Keep the clock running during mouse interaction so a held puck resumes.
    this.frame = window.requestAnimationFrame(this.render)
  }

  private async syncCameraToDriver() {
    const driver = this.spaceMouse
    if (
      !driver?.session ||
      driver._3dcontroller === null ||
      this.synchronizingCamera
    )
      return
    const revision = this.cameraRevision
    this.synchronizingCamera = true
    try {
      // The SDK's update helper hides the RPC promise. Wait for the cache update
      // before accepting any more camera writes from the navigation library.
      await driver.session.call(
        '3dx_rpc:update',
        `3dconnexion:3dcontroller/${driver._3dcontroller}`,
        {
          view: {
            affine: this.getViewMatrix(),
            target: this.getViewTarget(),
            perspective: this.getPerspective(),
            rotatable: this.getViewRotatable(),
            ...(this.getPerspective()
              ? { fov: this.getFov(), frustum: this.getViewFrustum() }
              : { extents: this.getViewExtents() }),
          },
        }
      )
      if (!this.disposed) this.syncedCameraRevision = revision
    } finally {
      this.synchronizingCamera = false
    }
  }

  onStartMotion() {
    if (this.frame === undefined && this.isViewportActive()) {
      this.frame = window.requestAnimationFrame(this.render)
    }
  }

  onStopMotion = () => {
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame)
    this.frame = undefined
  }

  onConnect() {
    // The SDK's initial HTTP request cannot be cancelled. Close a late session.
    if (this.disposed) {
      this.closeDriver()
      return
    }
    this.spaceMouse?.create3dmouse(
      this.controls.domElement,
      'Zoo Design Studio'
    )
  }

  onDisconnect(reason: string) {
    this.onStopMotion()
    const connecting = this.finishConnecting !== undefined
    this.finishConnecting?.(new Error(reason || CONNECT_ERROR))
    if (!this.disposed && !connecting)
      this.onDisconnected(reason || CONNECT_ERROR)
  }

  on3dmouseCreated() {
    if (this.disposed) {
      this.closeDriver()
      return
    }
    this.spaceMouse?.update3dcontroller({ frame: { timingSource: 1 } })
    this.finishConnecting?.()
  }

  getCoordinateSystem() {
    // Transform the client's Z-up world into Navlib's Y-up world.
    return [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
  }

  getFrontView() {
    // Camera-to-world pose looking along negative Y, with Z up.
    return [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
  }

  getModelExtents(): Extents {
    const bounds = this.scene.getBounds()
    if (bounds && !bounds.isEmpty()) return boxExtents(bounds)
    const target = this.controls.target
    return [
      target.x - 1,
      target.y - 1,
      target.z - 1,
      target.x + 1,
      target.y + 1,
      target.z + 1,
    ]
  }

  getUnitsToMeters() {
    return 0.001
  }

  getPerspective() {
    return this.controls.camera instanceof PerspectiveCamera
  }

  getViewMatrix() {
    const camera = this.controls.camera
    camera.updateMatrixWorld(true)
    return camera.matrixWorld.toArray()
  }

  getFov() {
    const camera = this.controls.camera
    return camera instanceof PerspectiveCamera
      ? (camera.fov * Math.PI) / 180
      : 0
  }

  getViewExtents(): Extents {
    const camera = this.controls.camera
    return camera instanceof OrthographicCamera
      ? [
          camera.left / camera.zoom,
          camera.bottom / camera.zoom,
          -camera.far,
          camera.right / camera.zoom,
          camera.top / camera.zoom,
          -camera.near,
        ]
      : [0, 0, 0, 0, 0, 0]
  }

  getViewFrustum(): Extents {
    const camera = this.controls.camera
    if (!(camera instanceof PerspectiveCamera)) return [0, 0, 0, 0, 0, 0]
    const top = camera.near * Math.tan((camera.fov * Math.PI) / 360)
    const right = top * camera.aspect
    return [-right, right, -top, top, camera.near, camera.far]
  }

  getFrameTime() {
    return performance.now()
  }
  getFrameTimingSource() {
    return 1
  }
  getViewRotatable() {
    return this.controls.enableRotate && this.scene.canRotate()
  }
  getLookAt() {
    return null
  }
  getViewTarget(): Position {
    return this.controls.target.toArray()
  }
  getPivotPosition(): Position {
    return this.getViewTarget()
  }
  getPointerPosition(): Position {
    return this.getViewTarget()
  }
  getSelectionEmpty() {
    return !this.scene.getSelectionBounds()
  }
  getSelectionExtents(): Extents {
    const bounds = this.scene.getSelectionBounds()
    return bounds ? boxExtents(bounds) : this.getModelExtents()
  }
  getSelectionAffine() {
    return new Matrix4().toArray()
  }
  getFloorPlane() {
    return [0, 0, 1, 0]
  }

  setMoving(moving: boolean) {
    if (moving) this.onStartMotion()
    else this.onStopMotion()
  }

  setViewMatrix(values: number[]) {
    if (
      !this.canNavigate() ||
      values.length !== 16 ||
      !values.every(Number.isFinite)
    )
      return
    const { camera, target } = this.controls
    const matrix = new Matrix4().fromArray(values)
    const position = new Vector3().setFromMatrixPosition(matrix)
    const rotation = new Quaternion().setFromRotationMatrix(matrix).normalize()
    if (!this.getViewRotatable() && camera.quaternion.angleTo(rotation) > 1e-6)
      return
    if (this.controls.enablePan || this.controls.enableZoom)
      camera.position.copy(position)
    if (this.getViewRotatable()) camera.quaternion.copy(rotation)
    // Project the old target onto the new view ray: pan moves it, orbit keeps
    // it fixed, and dolly changes the eye distance instead of dragging it along.
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const distance = Math.max(
      target.clone().sub(camera.position).dot(forward),
      0.001
    )
    target.copy(camera.position).addScaledVector(forward, distance)
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    this.cameraChanged()
  }

  setViewExtents(extents: Extents) {
    const camera = this.controls.camera
    if (
      !this.canNavigate() ||
      !this.controls.enableZoom ||
      !(camera instanceof OrthographicCamera)
    )
      return
    if (extents.length !== 6 || !extents.every(Number.isFinite)) return
    const height = extents[4] - extents[1]
    if (height <= 0) return
    // Keep the base frustum intact: resize and projection switching own it.
    camera.zoom = (camera.top - camera.bottom) / height
    this.cameraChanged()
  }

  setFov(fov: number) {
    const camera = this.controls.camera
    if (
      !this.canNavigate() ||
      !this.controls.enableZoom ||
      !(camera instanceof PerspectiveCamera)
    )
      return
    if (!Number.isFinite(fov) || fov <= 0 || fov >= Math.PI) return
    camera.fov = (fov * 180) / Math.PI
    this.cameraChanged()
  }

  setTarget(position: Position) {
    if (
      !this.canNavigate() ||
      !this.controls.enablePan ||
      position.length !== 3 ||
      !position.every(Number.isFinite)
    )
      return
    const target = new Vector3().fromArray(position)
    // Move the eye with the target so its orientation remains consistent.
    this.controls.camera.position.add(target.clone().sub(this.controls.target))
    this.controls.target.copy(target)
    this.cameraChanged()
  }

  private cameraChanged() {
    const camera = this.controls.camera
    camera.updateProjectionMatrix()
    this.applyingDriverUpdate = true
    try {
      this.controls.onCameraChange()
      // onCameraChange also synchronizes orthographic depth and clipping.
      camera.updateMatrixWorld(true)
    } finally {
      this.applyingDriverUpdate = false
    }
  }

  // These properties are part of the SDK callback table even when unused.
  setTransaction(_transaction: number) {}
  setActiveCommand(_commandId: string) {}
  setPivotPosition(_data: unknown) {}
  setPivotVisible(_data: unknown) {}
  setLookFrom(_data: unknown) {}
  setLookDirection(_data: unknown) {}
  setLookAperture(_data: unknown) {}
  setSelectionOnly(_data: unknown) {}
  setSelectionAffine(_data: unknown) {}
  setKeyPress(_data: unknown) {}
  setKeyRelease(_data: unknown) {}
  setSettingsChanged(_data: unknown) {}
}

function boxExtents({ min, max }: Box3): Extents {
  return [min.x, min.y, min.z, max.x, max.y, max.z]
}
