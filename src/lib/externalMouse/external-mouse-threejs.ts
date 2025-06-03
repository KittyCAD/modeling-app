import type { Vector3 } from 'three'
import { PerspectiveCamera, OrthographicCamera } from 'three'
import { sceneInfra, engineCommandManager } from '@src/lib/singletons'
import { uuidv4 } from '@src/lib/utils'
import * as THREE from 'three'
declare global {
  var _3Dconnexion: any
  interface Window {
    the3DMouse: any
  }
}

type SixteenNumbers = [
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

type Min = number
type Max = number
type BoundingBox = [Min, Min, Min, Max, Max, Max]
type PlaneEquation = [number, number, number, number]
type Left = number
type Bottom = number
type FrustumFar = number
type Right = number
type Top = number
type FrustrumNear = number
type Position = [number, number, number]
type ViewExtents = [Left, Bottom, FrustumFar, Right, Top, FrustrumNear]

// this function fills the action and images structures that are exposed
// to the 3Dconnexion button configuration editor
function getApplicationCommands(buttonBank: any, images: any) {
  // Add a couple of categiores / menus / tabs to the buttonbank/menubar/toolbar
  // Use the categories to group actions so that the user can find them easily
  var fileNode = buttonBank.push(
    new _3Dconnexion.Category('CAT_ID_FILE', 'File')
  )
  var editNode = buttonBank.push(
    new _3Dconnexion.Category('CAT_ID_EDIT', 'Edit')
  )

  // Add menu items / actions
  fileNode.push(new _3Dconnexion.Action('ID_OPEN', 'Open', 'Open file'))
  fileNode.push(new _3Dconnexion.Action('ID_CLOSE', 'Close', 'Close file'))
  fileNode.push(new _3Dconnexion.Action('ID_EXIT', 'Exit', 'Exit program'))

  // Add menu items / actions
  editNode.push(
    new _3Dconnexion.Action('ID_UNDO', 'Undo', 'Shortcut is Ctrl + Z')
  )
  editNode.push(
    new _3Dconnexion.Action('ID_REDO', 'Redo', 'Shortcut is Ctrl + Y')
  )
  editNode.push(
    new _3Dconnexion.Action('ID_CUT', 'Cut', 'Shortcut is Ctrl + X')
  )
  editNode.push(
    new _3Dconnexion.Action('ID_COPY', 'Copy', 'Shortcut is Ctrl + C')
  )
  editNode.push(
    new _3Dconnexion.Action('ID_PASTE', 'Paste', 'Shortcut is Ctrl + V')
  )

  // Now add the images to the cache and associate it with the menu item by using the same id as the menu item / action
  // These images will be shown in the 3Dconnexion properties editor and in the UI elements which display the
  // active button configuration of the 3dmouse
  images.push(_3Dconnexion.ImageItem.fromURL('images/open.png', 'ID_OPEN'))
  images.push(_3Dconnexion.ImageItem.fromURL('images/close.png', 'ID_CLOSE'))
  images.push(_3Dconnexion.ImageItem.fromURL('images/exit.png', 'ID_EXIT'))
  images.push(_3Dconnexion.ImageItem.fromURL('images/Macro_Cut.png', 'ID_CUT'))
  images.push(
    _3Dconnexion.ImageItem.fromURL('images/Macro_Copy.png', 'ID_COPY')
  )
  images.push(
    _3Dconnexion.ImageItem.fromURL('images/Macro_Paste.png', 'ID_PASTE')
  )
  images.push(
    _3Dconnexion.ImageItem.fromURL('images/Macro_Undo.png', 'ID_UNDO')
  )
  images.push(
    _3Dconnexion.ImageItem.fromURL('images/Macro_Redo.png', 'ID_REDO')
  )
}

interface _3DconnexionMocked {
  connect(): number
  debug: boolean
  create3dmouse(canvas: HTMLElement | null, name: string): void
  update3dcontroller(options: any): void
  delete3dmouse(): void
}

interface _3DconnexionMiddleware {
  // Callbacks
  getCoordinateSystem(): SixteenNumbers
  getFrontView(): SixteenNumbers
  getViewMatrix(): SixteenNumbers
  getFov(): number
  getPerspective(): boolean
  getModelExtents(): BoundingBox
  getPointerPosition?(): Position
  getPivotPositon?(): Position
  getViewExtents(): ViewExtents
  getFrameTime(): number
  setViewExtents(viewExtents: ViewExtents): void
  getViewFrustum(): ViewExtents

  getConstructionPlane?(): PlaneEquation
  getFloorPlane?(): PlaneEquation
  getUnitsToMeters?(): number
  getLookAt?(): Position | null
  getViewRotatable?(): boolean

  // hit test properties
  setLookFrom?(p: Position): void
  setLookDirection?(p: Position): void
  setLookAperture?(a: number): void
  setSelectionOnly?(b: boolean): void

  // Commands
  setActiveCommand(id: any): void
  setViewMatrix(viewMatrix: SixteenNumbers): void
  setFov(fov: number): void
  setTransaction(transaction: number): void
  onStartMotion(): void
  onStopMotion(): void

  // 3D mouse initialization
  init3DMouse(): Promise<{value: boolean, message: string}>
  onConnect(): void
  onDisconnect(reason: string): void
  on3dmouseCreated(): void

  // huh?
  render(time: number): void

  // Custom
  destroy(): void
}

interface _3DMouseConfiguration {
  debug: boolean
  name: string
  canvasId: string
  camera: PerspectiveCamera | OrthographicCamera
}

interface Model {
  extends: {
    min: Vector3
    max: Vector3
  }
}

class _3DMouseThreeJS implements _3DconnexionMiddleware {
  spaceMouse: _3DconnexionMocked | null = null
  debug: boolean
  name: string
  canvasId: string
  animating: boolean = false
  cameraMatrix: SixteenNumbers = new THREE.Matrix4().identity().toArray()
  /**
   * Does this actually need to be perspective or orthographic?
   * This should not matter for position and orientation?
   * I think this would only matter for the viewMatrix and render?
   * Feels useless to support an orthographic camera. We should only need a camera API
   * to proxy the orientation and position?
   */
  camera: PerspectiveCamera | OrthographicCamera

  /**
   * These maybe dummy values because to move the camera the basic 6DOF we should
   * not need the model dimensions unless they do sensitivity scaling based on the
   * size of the model?
   */
  model: Model = {
    extends: {
      min: new THREE.Vector3(),
      max: new THREE.Vector3(),
    },
  }

  /**
   * canvas.offsetWidth
   */
  viewportWidth: number = 0

  /**
   * canvas.offsetHeight
   */
  viewportHeight: number = 0

  /**
   * Camera view matrix state
   * The library creates a viewMatrix but we do not need all of these
   * values to send to the engine. The camera frusta should have nothing to do
   * with the position and rotation of the camera. This is only required for the
   * view matrix. They maybe dummy values...
   */
  fov: number = 0
  frustumNear: number = 0
  frustumFar: number = 0
  left: number = 0
  right: number = 0
  bottom: number = 0
  top: number = 0

  constructor(configuration: _3DMouseConfiguration) {
    this.name = configuration.name
    this.debug = configuration.debug
    this.canvasId = configuration.canvasId
    this.camera = configuration.camera

    if (!_3Dconnexion) {
      console.error('Unable to find _3Dconnexion library')
    }
  }

  // custom
  destroy(): void {
    if (this.spaceMouse) {
      this.spaceMouse.delete3dmouse()
    }
  }

  // callbacks
  getCoordinateSystem(): SixteenNumbers {
    // In this sample the cs has X to the right, Y-up, and Z out of the screen
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  getFrontView(): SixteenNumbers {
    // In this sample the front view corresponds to the world pose.
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  /**
   * This is critical to compute to the rotation part of the viewMatrix from the navigation library
   * The new affine viewMatrix will be a rotation about the model's extent's center position followed by a translation.
   * It takes the center point of this min,max AABB then applies the rotational diffierence to this pivot point.
   */
  getModelExtents(): BoundingBox {
    // This is called after onStartMotion
    const unit = 100
    return [-unit / 2, -unit / 2, -unit / 2, unit / 2, unit / 2, unit / 2]
  }

  getPerspective(): boolean {
    // This is called after onStartMotion
    return true
  }

  getViewMatrix() {
    // This is called after onStartMotion
    // THREE.js matrices are column major (same as openGL)
    return this.camera.matrixWorld.toArray()
  }

  getFov(): number {
    if (this.camera instanceof PerspectiveCamera === false) {
      console.error(
        'Camera is not a perspective camera, unable to get the FOV of this camera.'
      )
      // try to brick it during runtime on purpose
      return -1
    }

    const fov =
      2 *
      Math.atan(
        Math.atan2(this.camera.fov * Math.PI, 360.0) *
          Math.sqrt(1 + this.camera.aspect * this.camera.aspect)
      )
    if (this.debug) console.log('fov=' + (fov * 180.0) / Math.PI)

    return fov
  }

  getViewExtents(): ViewExtents {
    if (this.camera instanceof OrthographicCamera === false) {
      console.error(
        'Camera is not orthographic camera, unable to get the viewExtents'
      )
      // try to brick it during runtime on purpose
      return [0, 0, 0, 0, 0, 0]
    }
    return [
      this.camera.left,
      this.camera.bottom,
      -this.camera.far,
      this.camera.right,
      this.camera.top,
      -this.camera.near,
    ]
  }

  getViewFrustum(): ViewExtents {
    if (this.camera instanceof PerspectiveCamera === false) {
      console.error(
        'Camera is not a perspective camera, unable to get the view frustum of this camera.'
      )
      // try to brick it during runtime on purpose
      return [0, 0, 0, 0, 0, 0]
    }
    const tan_halffov = Math.tan((this.camera.fov * Math.PI) / 360.0)
    const bottom = -this.camera.near * tan_halffov
    const left = bottom * this.camera.aspect
    if (this.debug)
      console.log(
        'frustum=[' +
          left +
          ', ' +
          -left +
          ', ' +
          bottom +
          ', ' +
          -bottom +
          ', ' +
          this.camera.near +
          ', ' +
          this.camera.far +
          ']'
      )
    return [left, -left, bottom, -bottom, this.camera.near, this.camera.far]
  }

  getFrameTime(): number {
    return performance.now()
  }

  setViewExtents(viewExtents: ViewExtents): void {
    if (this.camera instanceof OrthographicCamera === false) {
      console.error(
        'Camera is not orthographic camera, unable to set the viewExtents'
      )
      return
    }
    this.camera.left = viewExtents[0]
    this.camera.bottom = viewExtents[1]
    this.camera.right = viewExtents[3]
    this.camera.top = viewExtents[4]
    this.camera.updateProjectionMatrix()
  }

  /**
   * Entry location, after calling new on this class
   * invoke this method! I know its not in the constructor... TBD.
   * Everything will initialize after this function call.
   */
  async init3DMouse(timeout: number = 15000): Promise<{value: boolean, message: string}> {
    /**
     * _3Dconnexion.connect() is buggy, the code is implemented wrong.
     * It is using half async and half sync code.
     * The xmlhttprequest calls .open with true for async but they do not handle the async scenario
     * The timeout is set to 0 though??? why?
     * It will return 1 if it fails to connect
     * It will return 1 if it connects
     * It will return 0 on certain errors
     * the xmlHttpRequest is not sync and it has no await logic
     * It would require an N ms timeout wait to see if the libray has connected to the proxy server
     * Also the convention is backwards, 1 says success and 0 says failure, this is confusing.
     */
    this.spaceMouse = new _3Dconnexion(this)

    if (this.spaceMouse) {
      // set the debug flag in the wrapper library
      this.spaceMouse.debug = this.debug
    }

    // artifically wait to hope it connects within that timeframe
    return new Promise((resolve, reject) => {
      if (this.spaceMouse) {
        setTimeout(() => {
          let message = '3DConnexion mouse is connected'
          let success = true
          if (this.spaceMouse.connected === false) {
            message = 'Cannot connect to 3Dconnexion NL-Proxy'
            success = false
          } else if (this.spaceMouse.session === null) {
            message = 'Unable to find spaceMouse session to the proxy server'
            success = false
          }
          resolve({
            value: success,
            message
          })
        }, timeout) // 15 seconds
      }
    })
  }

  // init3DMouse needs onConnect
  onConnect(): void {
    const canvas : HTMLCanvasElement | null = document.querySelector('#'+this.canvasId)

    if (!canvas) {
      console.error('[_3DMouse] no canvas found, failed onConnect', canvas)
      return
    }

    if (!this.spaceMouse) {
      console.error('spaceMouse is not defined, failed onConnect')
      return
    }

    const clientCamera = sceneInfra.camControls.camera

    /**
     * initialize the camera intrinsics
     */

    this.viewportWidth = canvas.width
    this.viewportHeight = canvas.height

    /** Make fov -1 on purpose */
    this.fov = clientCamera instanceof PerspectiveCamera ? clientCamera.fov : -1
    this.frustumNear = clientCamera.near
    this.frustumFar = clientCamera.far

    /** Make left 0 on purpose */
    this.left =
      clientCamera instanceof OrthographicCamera ? clientCamera.left : 0
    this.right = -this.left
    this.bottom =
      (-(this.right - this.left) * this.viewportHeight) / this.viewportWidth / 2
    this.top = -this.bottom

    this.camera = sceneInfra.camControls.camera.clone()
    this.camera.updateMatrix()
    this.camera.updateMatrixWorld()
    this.camera.updateProjectionMatrix()

    this.spaceMouse.create3dmouse(canvas, this.name)
  }

  onDisconnect(reason: string): void {
    console.log('3Dconnexion NL-Proxy disconnected ' + reason)
  }

  on3dmouseCreated(): void {
    if (!this.spaceMouse) {
      console.error('spaceMouse is not defined, failed on3dmouseCreated')
      return
    }

    // global reference from window
    const actionTree = new _3Dconnexion.ActionTree()
    const actionImages = new _3Dconnexion.ImageCache()

    // set ourselves as the timing source for the animation frames
    this.spaceMouse.update3dcontroller({
      frame: { timingSource: 1 },
    })

    actionImages.onload = () => {
      if (!this.spaceMouse) {
        console.error('spaceMouse is not defined, failed on3dmouseCreated')
        return
      }
      this.spaceMouse.update3dcontroller({ images: actionImages.images })
    }

    // An actionset can also be considered to be a buttonbank, a menubar, or a set of toolbars
    // Define a unique string for the action set to be able to specify the active action set
    // Because we only have one action set use the 'Default' action set id to not display the label
    var buttonBank = actionTree.push(
      new _3Dconnexion.ActionSet('Default', 'Custom action set')
    )
    getApplicationCommands(buttonBank, actionImages)

    // Expose the commands to 3Dxware and specify the active buttonbank / action set
    this.spaceMouse.update3dcontroller({
      commands: { activeSet: 'Default', tree: actionTree },
    })
  }

  // commands
  setActiveCommand(id: any): void {
    if (id && id == 'ID_CLOSE') {
      console.log('Id of command to execute= ' + id)
      this.deleteScene()
      window.alert('Scene closed.')
      return
    }
    /** TODO: onCommand(id) */
    console.log('Command Id=' + id)
  }

  async sendToEngine() {
    /** TODO: Kevin, this does not work for rotational component since the lookAt is broken. Translation only is okay */
    const c1 = sceneInfra.camControls.camera.position.clone()
    const c2 = this.camera?.position.clone()
    const diff = c2?.clone()?.sub(c1.clone())
    const t1 = sceneInfra.camControls.target.clone()
    const t2 = diff?.clone().add(t1.clone())

    sceneInfra.camControls.throttledUpdateEngineCamera({
      isPerspective: true,
      position: this.camera?.position.clone(),
      quaternion: this.camera?.quaternion.clone(),
      zoom: this.camera?.zoom,
      target: t2, //sceneInfra.camControls.target.clone(),
    })

    /** TODO: How to sync state after the throttled call? in the callback?*/
    // await engineCommandManager.sendSceneCommand({
    //   type: 'modeling_cmd_req',
    //   cmd_id: uuidv4(),
    //   cmd: {
    //     type: 'default_camera_get_settings',
    //   },
    // })
  }

  setViewMatrix(viewMatrix: SixteenNumbers): void {
    // Note data is a column major matrix
    let cameraMatrix = new THREE.Matrix4()

    cameraMatrix.fromArray(viewMatrix)

    // update the camera
    cameraMatrix.decompose(
      this.camera.position,
      this.camera.quaternion,
      this.camera.scale
    )

    this.camera.updateMatrixWorld(true)
    this.sendToEngine()
  }

  setFov(fov: number): void {
    this.fov = (fov * 180.0) / Math.PI
  }

  /**
   * setTransaction is called twice per frame
   * transaction >0 at the beginning of a frame change
   * transaction ===0 at the end of a frame change
   */
  setTransaction(transaction: number): void {
    if (transaction === 0) {
      console.log('request a redraw not animating')
    }
  }

  onStartMotion(): void {
    console.log('started!')
    if (!this.animating) {
      this.animating = true
      window.requestAnimationFrame(this.render.bind(this))
    }
  }

  render(time: number): void {
    if (!this.spaceMouse) {
      console.error('spaceMouse is not defined, failed render')
      return
    }

    if (this.animating) {
      this.spaceMouse.update3dcontroller({
        frame: { time: time },
      })
      window.requestAnimationFrame(this.render.bind(this))
    }
  }

  onStopMotion(): void {
    this.animating = false
  }
}

export { _3DMouseThreeJS }
