import { Matrix4, Vector3, PerspectiveCamera, OrthographicCamera } from 'three'
import { sceneInfra, engineCommandManager } from '@src/lib/singletons'
import { uuidv4 } from '@src/lib/utils'
import * as THREE from 'three'
import { convertThreeCamValuesToEngineCam } from '@src/clientSideScene/CameraControls'
import type {
  CameraViewState_type,
  Point3d_type,
  Point4d_type,
  WorldCoordinateSystem_type,
} from '@kittycad/lib/dist/types/src/models'

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
function getApplicationCommands(buttonBank, images) {
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
  connect(): boolean
  debug: boolean
  create3dmouse(canvas: HTMLElement | null, name: string): void
  update3dcontroller(any): void
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
  getLookAt(): null

  // hit test properties
  setLookFrom?(p: Position): void
  setLookDirection?(p: Position): void
  setLookAperture?(a: number): void
  setSelectionOnly(b: boolean): void

  // Commands
  setActiveCommand(id: any): void
  setViewMatrix(viewMatrix: SixteenNumbers): void
  setFov(fov: number): void
  setTransaction(transaction: number): void
  onStartMotion(): void
  onStopMotion(): void

  // 3D mouse initialization
  init3DMouse(): void
  onConnect(): void
  onDisconnect(reason: string): void
  on3dmouseCreated(): void

  // huh?
  render(time: number): void

  // Custom
  deleteScene(): void
}

interface _3DMouseConfiguration {
  debug: boolean
  name: string
  canvasId: string
}

interface Model {
  extends: {
    min: Vector3
    max: Vector3
  }
}

class _3DMouseThreeJS implements _3DconnexionMiddleware {
  /**
   * Debug class vars
   */
  timesToPrint: number = 2

  spaceMouse: _3DconnexionMocked
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
  camera: PerspectiveCamera | OrthographicCamera | null = null

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
  viewportWidth: number

  /**
   * canvas.offsetHeight
   */
  viewportHeight: number

  /**
   * Camera view matrix state
   * The library creates a viewMatrix but we do not need all of these
   * values to send to the engine. The camera frusta should have nothing to do
   * with the position and rotation of the camera. This is only required for the
   * view matrix. They maybe dummy values...
   */
  fov: number
  frustumNear: number
  frustumFar: number
  left: number
  right: number
  bottom: number
  top: number

  constructor(configuration: _3DMouseConfiguration) {
    // no op for now
    console.log('_3DMouse has a no op constructor')

    this.name = configuration.name
    this.debug = configuration.debug
    this.canvasId = configuration.canvasId

    if (!_3Dconnexion) {
      console.error('Unable to find _3Dconnexion library')
    }
  }
  // custom
  deleteScene(): void {
    this.spaceMouse.delete3dmouse()
  }

  // callbacks

  getLookAt(): null {
    return null
  }

  getCoordinateSystem(): SixteenNumbers {
    // In this sample the cs has X to the right, Y-up, and Z out of the screen
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  getFrontView(): SixteenNumbers {
    // In this sample the front view corresponds to the world pose.
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  /** TODO: Does this even matter?  */
  getModelExtents(): BoundingBox {
    // Yes.
    const unit = 100
    return [-unit/2, -unit/2, -unit/2, unit/2, unit/2, unit/2]
  }

  getPerspective(): boolean {
    // Yes.
    return true
  }

  getViewMatrix = function () {
    // Yes.
    // THREE.js matrices are column major (same as openGL)
    return this.camera.matrixWorld.toArray()
  }

  getFov(): number {
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
    const tan_halffov = Math.tan((gl.fov * Math.PI) / 360.0)
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

  shouldPrint(): void {
    var a = new Error()
    console.log('SHOULD PRINT', a.stack)
  }

  setViewExtents(viewExtents: ViewExtents): void {
    this.camera.left = viewExtents[0]
    this.camera.bottom = viewExtents[1]
    this.camera.right = viewExtents[3]
    this.camera.top = viewExtents[4]
    this.camera.updateProjectionMatrix()
  }

  // 3D mouse initialization
  init3DMouse(): void {
    this.spaceMouse = new _3Dconnexion(this)
    this.spaceMouse.debug = this.debug
    if (!this.spaceMouse.connect()) {
      if (this.debug) console.log('Cannot connect to 3Dconnexion NL-Proxy')
    }
  }

  // init3DMouse needs onConnect
  onConnect(): void {
    // TODO: Fix this API usage.
    // const canvas = document.getElementById(this.canvasId)
    const canvas = document.querySelector('[data-engine]')

    if (!canvas) {
      console.error('[_3DMouse] no canvas found', canvas)
    }

    const clientCamera = sceneInfra.camControls.camera

    /**
     * initialize the camera intrinsics
     */
    this.viewportWidth = canvas.width
    this.viewportHeight = canvas.height
    /** TODO: Fov is only on perspective cameras */
    this.fov = clientCamera.fov || 45
    this.frustumNear = clientCamera.near
    this.frustumFar = clientCamera.far
    /** TODO: Only on ortho */
    this.left = clientCamera.left || 1
    /** TODO: Only on ortho */
    this.right = -this.left
    this.bottom =
      (-(this.right - this.left) * this.viewportHeight) / this.viewportWidth / 2
    this.top = -this.bottom

    this.camera = sceneInfra.camControls.camera.clone()
    // this.camera = new THREE.PerspectiveCamera(this.fov, this.frustumNear, this.frustumFar)
    // this.camera.position.set(clientCamera.position.x, clientCamera.position.y, clientCamera.position.z)
    // this.camera.lookAt(sceneInfra.camControls.target)
    this.camera.updateMatrix()
    this.camera.updateMatrixWorld()
    this.camera.updateProjectionMatrix()
    /**
     * seems legit?
     */
    // console.log('debug initial camera intrinsics')
    // console.log('viewportWidth: ', this.viewportWidth)
    // console.log('viewportHeight: ', this.viewportHeight)
    // console.log('fov: ', this.fov)
    // console.log('frustumNear: ', this.frustumNear)
    // console.log('frustumFar: ', this.frustumFar)
    // console.log('left: ', this.left)
    // console.log('right: ', this.right)
    // console.log('bottom: ', this.bottom)
    // console.log('top: ', this.top)
    console.log('STARTING POSITION', this.camera.position)
    console.log('STARTING LOOKAT', sceneInfra.camControls.target)

    /** TODO: camera.lookAt() ? */

    this.spaceMouse.create3dmouse(canvas, this.name)
  }

  onDisconnect(reason: string): void {
    console.log('3Dconnexion NL-Proxy disconnected ' + reason)
  }

  on3dmouseCreated(): void {
    // global reference from window
    const actionTree = new _3Dconnexion.ActionTree()
    const actionImages = new _3Dconnexion.ImageCache()

    // set ourselves as the timing source for the animation frames
    this.spaceMouse.update3dcontroller({
      frame: { timingSource: 1 },
    })

    actionImages.onload = () => {
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
    const clientCamera = sceneInfra.camControls.camera

    const value = this.camera?.position.toArray()
    value?.push('set_view_matrix')
    if (!window.mouseCamera) {
      window.mouseCamera = [value]
    }
    {
      window.mouseCamera.push(value)
    }

    // const cameraViewState: CameraViewState_type = {
    //   eye_offset: 0,
    //   /** TODO: Only perspective has FOV, if ortho do 45? */
    //   fov_y: clientCamera.fov || 45,
    //   /** Always true */
    //   ortho_scale_enabled: true,
    //   /** TODO: ?? */
    //   ortho_scale_factor: 1.4,
    //   /**
    //    * right_handed_up_z
    //    * right_handed_up_y
    //    */
    //   world_coord_system: 'right_handed_up_z',
    //   is_ortho: false,
    //   pivot_position: {x: this.camera?.position.x, y: this.camera?.position.y, z: this.camera?.position.z},
    //   pivot_rotation: {x: this.camera?.quaternion.x, y: this.camera?.quaternion.y, z:this.camera?.quaternion.z, w: this.camera?.quaternion.w},
    // }

    // // console.log(clientCamera)
    // // console.log(cameraViewState)
    // // is not directly compatible with the engine API
    // await engineCommandManager.sendSceneCommand({
    //   type: 'modeling_cmd_req',
    //   cmd_id: uuidv4(),
    //   cmd: {
    //     type: 'default_camera_set_view',
    //     view: {
    //       ...cameraViewState,
    //     },
    //   },
    // })
    // console.log('positon', this.camera?.position)
    // console.log('lookAtPoint',lookAtPoint)

    // Works for translation, kevin
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
          target: t2//sceneInfra.camControls.target.clone(),
    })
    // await engineCommandManager.sendSceneCommand({
    //   type: 'modeling_cmd_req',
    //   cmd_id: uuidv4(),
    //   cmd: {
    //     type: 'default_camera_look_at',
    //     ...convertThreeCamValuesToEngineCam({
    //       isPerspective: true,
    //       position: this.camera?.position.clone(),
    //       quaternion: this.camera?.quaternion.clone(),
    //       zoom: this.camera?.zoom,
    //       target: t2, //sceneInfra.camControls.target.clone(),
    //     }),
    //   },
    // })

    // // /** TODO: Immediately sync camera state? */
    await engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
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
    // console.log(this.camera.position, this.camera.quaternion, this.camera.scale)
    // this.sendToEngine()
    // if (this.timesToPrint) {
    //   console.log('set_view_matrix', this.camera?.position.toArray())
    //   this.timesToPrint -= 1
    // }

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

  render(time): void {
    if (this.animating) {
      this.spaceMouse.update3dcontroller({
        frame: { time: time },
      })
      window.requestAnimationFrame(this.render.bind(this))
    }
  }

  onStopMotion(): void {
    console.log('stopped!')
    this.animating = false
  }
}

export { _3DMouseThreeJS }
