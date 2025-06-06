import type { Vector3 } from 'three'
import { PerspectiveCamera, OrthographicCamera } from 'three'
import { sceneInfra, engineCommandManager } from '@src/lib/singletons'
import { uuidv4 } from '@src/lib/utils'
import { EXTERNAL_MOUSE_ERROR_PREFIX } from '@src/lib/constants'
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
  onStartMotion(): void
  onStopMotion(): void

  // 3D mouse initialization
  init3DMouse(): Promise<{ value: boolean; message: string }>
  onConnect(): void
  onDisconnect(reason: string): void
  on3dmouseCreated(): void

  // huh?
  render(time: number): void

  // Custom
  destroy(): void

  /**
   * Client read
   * These are class functions called in the 3dconnexion.js library with the navigaiton library and the proxy server
   */
  /** View */
  getViewMatrix(): SixteenNumbers
  getConstructionPlane?(): PlaneEquation // TODO
  getViewExtents(): ViewExtents
  getFov(): number
  getViewFrustum(): ViewExtents
  getPerspective(): boolean
  getViewTarget?(): void // TODO
  getViewRotatable?(): boolean

  /** Model */
  getModelExtents(): BoundingBox
  getFloorPlane?(): PlaneEquation // TODO
  getUnitsToMeters?(): void // TODO

  /** Pivot */
  getPivotPositon?(): Position

  /** Hit testing */
  getLookAt?(): Position | null // TODO

  /** Selection */
  getSelectionAffine?(): void // TODO
  getSelectionEmpty?(): boolean // TODO
  getSelectionExtents?(): void // TODO

  /** Cursor */
  getPointerPosition?(): Position // TODO

  /** World */
  getCoordinateSystem(): SixteenNumbers

  /** Predefined views */
  getFrontView(): SixteenNumbers

  /** Frame */
  getFrameTimingSource?(): void // TODO
  getFrameTime(): number

  /**
   * Client update
   * These are class functions called in the 3dconnexion.js library with the navigaiton library and the proxy server
   */
  setMoving?(data: any): void // TODO
  setTransaction(transaction: number): void

  /** View / Camera */
  setViewMatrix(viewMatrix: SixteenNumbers): void
  setViewExtents(viewExtents: ViewExtents): void
  setFov(fov: number): void
  setTarget?(data: any): void // TODO

  /** Commands */
  setActiveCommand(id: any): void // TODO

  /** Pivot */
  setPivotPosition?(data: any): void // TODO
  setPivotVisible?(data: any): void // TODO

  /** Hit testing */
  setLookFrom?(p: Position): void
  setLookDirection?(p: Position): void
  setLookAperture?(a: number): void
  setSelectionOnly?(b: boolean): void

  /** Selection */
  setSelectionAffine?(data: any): void // TODO

  /** Keys */
  setKeyPress?(data: any): void // TODO
  setKeyRelease?(data: any): void // TODO

  /** Settings */
  setSettingsChanged?(data: any): void // TODO
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

class _3DMouseThreeJSWindows implements _3DconnexionMiddleware {
  PERSPECTIVE: boolean
  TRACE_MESSAGES: boolean
  aspect: number
  spaceMouse: any
  animating: boolean
  canvas: any
  _camera: any
  appName: string
  debug: boolean
  gl: {
    fov: number
    near: number
    far: number
    left: number
    right: number
    bottom: number
    top: number
    viewportWidth: number
    viewportHeight: number
  }

  look: {
    origin: Vector3
    direction: Vector3
    aperture: number
    selection: boolean
  }

  log(message: string, data): void {
    console.log(`prefix ${message} data:${data}`)
  }

  constructor({ camera, canvasId, appName, debug }) {
    const canvas = document.getElementById(canvasId)
    this.canvas = canvas
    this.aspect = canvas?.offsetWidth / canvas?.offsetHeight
    this.appName = appName
    this.debug = debug
    this.PERSPECTIVE = true

    const viewportWidth = canvas.width
    const viewportHeight = canvas.height
    const fov = camera instanceof PerspectiveCamera ? camera.fov : -1
    const near = camera.near
    const far = camera.far
    const left = camera instanceof OrthographicCamera ? camera.left : 0
    const right = -left
    const bottom = (-(right - left) * viewportHeight) / viewportWidth / 2
    const top = -bottom
    // This will get out of date?
    this.gl = {
      fov,
      near,
      far,
      left,
      right,
      bottom,
      top,
      viewportWidth,
      viewportHeight,
    }

    this.look = {
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      aperture: 0.01,
      selection: false,
    }

    this.camera = camera.clone()
    // this.camera.updateMatrix()
    // this.camera.updateMatrixWorld()
    // this.camera.updateProjectionMatrix()
    this.log('constructor called _3DMouseThreeJSWindows')
  }

  get camera () {
    return this._camera
  }

  set camera(newCamera) {
    this._camera = newCamera.clone()
  }

  render(now: number) {
    if (this.animating) {
      this.spaceMouse.update3dcontroller({
        frame: { time: now },
      })
      window.requestAnimationFrame(
        function (theTime) {
          this.render(theTime)
        }.bind(this)
      )
    }
    this.log('rendering!', now)
  }

  updateScene() {
    this.log('updateScene')
    if (!this.animating) {
      // window.requestAnimationFrame(this.render)
      window.requestAnimationFrame(
        function (theTime) {
          this.render(theTime)
        }.bind(this)
      )
    }
  }

  deleteScene() {
    this.log('deleting scene')
    this.spaceMouse.delete3dmouse()
  }

  // navigation model
  // getCoordinateSystem is queried to determine the coordinate system of the application
  // described as X to the right, Y-up and Z out of the screen
  getCoordinateSystem() {
    const a = [ 1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1]
    this.log('getCoordinateSystem', a)
    return a
  }

  getConstructionPlane() {
    throw new Error('getConstructionPlane')
    const a = [0, 0, 0, 0]
    this.log('getConstructionPlane', a)
    return a
  }

  getFloorPlane() {
    throw new Error('getFloorPlane')
    const a = [0, 0, 0, 0]
    this.log('getFloorPlane', a)
    return a
  }

  getUnitsToMeters() {
    // originall 10.0 in the documentation?
    // Anything from the client side is in mm so mm to meters is 1mm * 0.001 = 0.001m
    const a = 0.001
    this.log('getUnitsToMeter', a)
    return a
  }

  getFov() {
    const fov =
      2 *
      Math.atan(
        Math.atan2(this.camera.fov * Math.PI, 360.0) *
          Math.sqrt(1 + this.camera.aspect * this.camera.aspect)
      )
    if (this.TRACE_MESSAGES) console.log('fov=' + (fov * 180.0) / Math.PI)

    const a = fov
    this.log('getFov', a)
    return a
  }

  getFrontView() {
    // Method called by the Navigation Library when a connection is established to determine the pose
    // of the front view. When the user presses the ‘Front’ button on a 3D Mouse this will be the pose
    // the Navigation Library switches to. All other view orientations are calculated from this.
    const a = [1, 0, 0, 0,
               0, 1, 0, 0,
               0, 0, 1, 0,
               0, 0, 0, 1]
    this.log('getFrontView', a)
    return a
  }

  getLookAt() {
    // Method called by the Navigation Library when it requires the world position of the nearest
    // intersection of the “look” ray with the scene or selection set.
    // Required for the auto pivot algorithms.
    // if nothing was hit return nothing
    const a = null
    this.log('getLookAt', a)
    return a
  }

  getModelExtents() {
    // Method called by the Navigation Library when it needs to know the bounding box of the model.
    //   One example of when this will happen is when the library needs to zoom the view to the extents
    // of the model. The extents are returned as an array containing the min and max values of the
    // bounding box in world coordinates.
    // Required for the pivot and zoom algorithms.

    const unit = 100
    const a = [-unit / 2, -unit / 2, -unit / 2, unit / 2, unit / 2, unit / 2]
    this.log('getModelExtents', a)
    return a
  }

  getPerspective() {
    // Required to distinguish between orthographic and perspective navigation algorithms.
    const a = this.PERSPECTIVE
    this.log('getPerspective', a)
    return a
  }

  getPivotPositon() {
    // Method called by the Navigation Library when it wants to know the position of the 2D mouse
    // pivot or of a pivot manually set by the user. The position is returned as a 1x3 array in world
    // coordinates.
    // Required for rotating about the pivot position
    if (this.TRACE_MESSAGES)
      console.log('pivot=[' + 0 + ', ' + 0 + ', ' + 0 + ']')
    const a = [0, 0, 0]
    this.log('getPivotPosition', a)
    return a
  }

  getPointerPosition() {
    // Method called by the Navigation Library when it requires the world position of the mouse pointer
    // on the projection/near plane.
    // Required for the quick zoom algorithms.
    this.log('getPointerPosition')
    throw new Error('implement getPointerPosition')
  }

  getViewRotatable() {
    // The method returns a true of false. This may be called by the Navigation Library when
    // calculating a next frame. The rotatable describes whether the view in an orthographic project
    // can be rotated
    // Required for 2d navigation.
    // The Navigation Library will treat non-rotatable views as pure pan-zoom views and also disable
    // the views keys (Right, Left, Top, etc.). To allow the navigation library to rotate the view to an
    // alternative orientation such as Top, define the view as rotatable and a corresponding
    // construction plane.
    const a = true
    this.log('getViewRotatable', a)
    return a
  }

  getViewExtents() {
    // The method returns a 1x6 java array containing the min and max extents of the view bounding
    // box. The view extents defines the visible viewing volume of an orthographic projection in view
    // coordinates as min = [left, bottom, -far] and max = [right, top, far].
    // Required for orthographic projections.
    const a = [
      this.camera.left,
      this.camera.bottom,
      this.camera.far * -1,
      this.camera.right,
      this.camera.top,
      this.camera.near * -1,
    ]
    this.log('getViewExtents', a)
    return a
  }

  getViewFrustum() {
    // The method returns a 1x 6 java array containing the frustum of the perspective view/camera in
    // camera coordinates. This may be called by the Navigation Library when it needs to calculate the
    // field-of-view of the camera, or during algorithms that need to know if the model is currently
    // visible within the frustum. The Navigation Library will not write to the ‘view.frustum’ property,
    // Required for perspective projections.
    // The values in the array are the same as those passed to glFrustum in OpenGL.

    // Why isn't this the cameras.fov?
    // in setFov it should be this.camera.fov = this.gl.fov
    // and this should be this.camera.fov
    const tan_halffov = Math.tan((this.gl.fov * Math.PI) / 360.0)
    const bottom = -this.camera.near * tan_halffov
    const left = bottom * this.camera.aspect
    if (this.TRACE_MESSAGES)
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
    const a = [left, -left, bottom, -bottom, this.camera.near, this.camera.far]
    this.log('getViewFrustum', a)
    return a
  }

  getViewMatrix() {
    // The method returns a java array containing the view 4x4 column major matrix. This may be
    // called by the Navigation Library when calculating a next frame. The view matrix describes the
    // transform from view coordinates to world coordinates of the view/camera position. Generally
    // getViewMatrix() is called by the library at the beginning of motion.
    const a = this.camera.matrixWorld.toArray()
    this.log('getViewMatrix', a)
    return a
  }

  setActiveCommand(id) {
    this.log(`setActiveCommand`, id)
  }

  setLookFrom(data) {
    // Method called by the Navigation Library that defines the origin of the ray used in hit-testing.
    this.log('setLookFrom', data)
    this.look.origin.set(data[0], data[1], data[2])
  }

  setLookDirection(data) {
    // Method called by the Navigation Library that defines the direction of the ray used in hit-testing
    this.log('setLookDirection', data)
    this.look.direction.set(data[0], data[1], data[2])
  }

  setLookAperture(data) {
    // Method called by the Navigation Library that defines the diameter of the ray used in hit-testing.
    this.log('setLookAperture', data)
    this.look.aperture = data
  }

  setSelectionOnly(data) {
    // Method called by the Navigation Library that defines whether hit-testing should include all the
    // objects or be limited to the current selection set.
    this.log('setSelectionOnly', data)
    this.look.selection = data
  }

  setViewExtents(data) {
    // The method receives a 1x6 java array containing the min and max extents of the view bounding
    // box. The view extents defines the visible viewing volume of an orthographic projection in view
    // coordinates as min = [left, bottom, far] and max = [right, top, near]. The Navigation Library will
    // call setViewExtents when navigating in an orthographic projection in order to zoom the view.
    this.log('setViewExtents', data)
    this.camera.left = data[0]
    this.camera.bottom = data[1]
    this.camera.right = data[3]
    this.camera.top = data[4]
    this.camera.updateProjectionMatrix()
  }

  setViewMatrix(data) {
    this.log('setViewMatrix', data)
    // Note data is a column major matrix
    let cameraMatrix = new THREE.Matrix4()
    cameraMatrix.fromArray(data)

    // update the camera
    cameraMatrix.decompose(
      this.camera.position,
      this.camera.quaternion,
      this.camera.scale
    )
    this.camera.updateMatrixWorld(true)
    this.sendToEngine()
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

  /**
   * What? Why wouldn't it actually translate, zooming is faking?
   */
  setFov(data) {
    // Method called by the Navigation Library when it wants to update the fov of the camera/view.
    // Required for zooming in perspective projections.
    // The fov in radians.
    this.log('setFov', data)
    this.gl.fov = (data * 180.0) / Math.PI
  }

  setTransaction(transaction) {
    // Method called by the Navigation Library at the beginning and end of a frame change. At the
    // beginning of a frame change the Navigation Library will set the ‘transaction’ property to a
    // value >0. When the Navigation Library has completed the changes to the frame, the value is
    // reset to 0. Clients that do not use an animation loop and need to actively refresh the view can
    // trigger the update when the value is set to 0.
    this.log('setTransaction', transaction)
    if (transaction === 0) {
      this.updateScene()
    }
  }

  onStartMotion() {
    this.log('onStartMotion')
    if (!this.animating) {
      this.animating = true
      // window.requestAnimationFrame(this.render)
      window.requestAnimationFrame(
        function (theTime) {
          this.render(theTime)
        }.bind(this)
      )
    }
  }

  onStopMotion() {
    this.log('onStopMotion')
    this.animating = false
  }

  onConnect() {
    this.log('onConnect')
    this.spaceMouse.create3dmouse(this.canvas, this.appName)
  }

  on3dmouseCreated() {
    this.log('on3dmouseCreated')
    this.spaceMouse.update3dcontroller({
      frame: { timingSource: 1 },
    })
    // ignore image cache
    // ignore action images
    // ignore action tree
    // ignore button bank
    // ignore application commands
  }

  onDisconnect(reason) {
    this.log('onDisconnect', reason)
    if (this.TRACE_MESSAGES) {
      console.log('3Dconnexion NL-Proxy disconnected ' + reason)
    }
  }

  init3DMouse() {
    this.log('init3DMouse')
    this.spaceMouse = new _3Dconnexion(this)
    this.spaceMouse.debug = this.debug
    this.spaceMouse.connect()
    return Promise.resolve({ value: true, message: 'wtf' })
  }
  // HERE
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

  settings = {
    changed: false,
  }

  pivot = {
    position: [0, 0, 0],
    visible: true,
  }

  motion = false

  hit = {
    lookfrom: [0, 0, 0],
    lookat: [0, 0, 0],
    direction: [0, 0, 0],
  }

  look = {
    origin: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    aperture: 0.01,
    selection: false,
  }

  constructor(configuration: _3DMouseConfiguration) {
    this.name = configuration.name
    this.debug = true
    this.canvasId = configuration.canvasId
    this.camera = configuration.camera

    if (!_3Dconnexion) {
      console.error(
        `${EXTERNAL_MOUSE_ERROR_PREFIX} Unable to find _3Dconnexion library`
      )
    }
  }

  getLookAt(): null {
    return null
  }

  setLookFrom(data) {
    console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} setLookFrom: ${data}`)
    this.look.origin.set(data[0], data[1], data[2])
  }

  setLookDirection(data) {
    console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} setLookDirection: ${data}`)
    this.look.direction.set(data[0], data[1], data[2])
  }

  setLookAperture(data) {
    console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} setLookAperture: ${data}`)
    this.look.aperture = data
  }

  setSelectionOnly(data) {
    console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} setSelectionOnly: ${data}`)
    this.look.selection = data
  }

  getPivotPosition() {
    return [0, 0, 0]
  }

  // custom
  destroy(): void {
    // if (this.spaceMouse) {
    //   this.spaceMouse.delete3dmouse()
    // }
  }

  // // callbacks
  getCoordinateSystem(): SixteenNumbers {
    // In this sample the cs has X to the right, Y-up, and Z out of the screen
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  getFrontView(): SixteenNumbers {
    // In this sample the front view corresponds to the world pose.
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }

  // /**
  //  * This is critical to compute to the rotation part of the viewMatrix from the navigation library
  //  * The new affine viewMatrix will be a rotation about the model's extent's center position followed by a translation.
  //  * It takes the center point of this min,max AABB then applies the rotational diffierence to this pivot point.
  //  */
  getModelExtents(): BoundingBox {
    // This is called after onStartMotion
    const unit = 100
    return [-unit / 2, -unit / 2, -unit / 2, unit / 2, unit / 2, unit / 2]
  }

  getUnitsToMeters() {
    // 1 unit is 10m
    return 1.0
  }

  getPerspective(): boolean {
    // This is called after onStartMotion
    console.log('invoked getPerspective')
    return true
  }

  getViewMatrix() {
    console.log('invoked getViewMatrix')
    // This is called after onStartMotion
    // THREE.js matrices are column major (same as openGL)
    return this.camera.matrixWorld.toArray()
  }

  getFov(): number {
    if (this.camera instanceof PerspectiveCamera === false) {
      console.error(
        `${EXTERNAL_MOUSE_ERROR_PREFIX} Camera is not a perspective camera, unable to get the FOV of this camera.`
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
        `${EXTERNAL_MOUSE_ERROR_PREFIX} Camera is not orthographic camera, unable to get the viewExtents`
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
        `${EXTERNAL_MOUSE_ERROR_PREFIX} Camera is not a perspective camera, unable to get the view frustum of this camera.`
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
        `${EXTERNAL_MOUSE_ERROR_PREFIX} Camera is not orthographic camera, unable to set the viewExtents`
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
  async init3DMouse(
    timeout: number = 15000,
    self: any
  ): Promise<{ value: boolean; message: string }> {
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
    this.spaceMouse = new _3Dconnexion(self)
    // set the debug flag in the wrapper library
    this.spaceMouse.debug = this.debug
    this.spaceMouse.connect()

    // artifically wait to hope it connects within that timeframe
    return new Promise((resolve, reject) => {
      if (this.spaceMouse) {
        setTimeout(() => {
          let message = '3DConnexion mouse is connected'
          let success = true
          console.log(this.spaceMouse)
          if (this.spaceMouse.connected === false) {
            message = 'Cannot connect to 3Dconnexion NL-Proxy'
            success = false
          } else if (this.spaceMouse.session === null) {
            message = 'Unable to find spaceMouse session to the proxy server'
            success = false
          }
          resolve({
            value: success,
            message,
          })
        }, timeout) // 15 seconds
      }
    })
  }

  // init3DMouse needs onConnect
  onConnect(): void {
    console.log('trying to do on connect?')
    const canvas: HTMLCanvasElement = document.getElementById(
      'client-side-scene-canvas'
    )

    if (!canvas) {
      console.error(
        `${EXTERNAL_MOUSE_ERROR_PREFIX} no canvas found, failed onConnect`,
        canvas
      )
      return
    }

    if (!this.spaceMouse) {
      console.error(
        `${EXTERNAL_MOUSE_ERROR_PREFIX} spaceMouse is not defined, failed onConnect`
      )
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
      this.destroy()
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

    console.log(this.camera.position)
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
    console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} setTransaction: ${transaction}`)
    if (transaction === 0) {
      console.log('request a redraw not animating')
    }
  }

  onStartMotion(): void {
    // NO OP
    if (this.debug) {
      console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} mouse movement started`)
    }
  }

  render(time: number): void {
    if (!this.spaceMouse) {
      console.error(
        `${EXTERNAL_MOUSE_ERROR_PREFIX} spaceMouse is not defined, failed render`
      )
      return
    }
    // NO OP
  }

  /**
   * Method called by the Navigation Server after it has invoked onStartMotion() when it will no
   * longer update the view. onStartMotion() and onStopMotion() occur in pairs.
   */
  onStopMotion(): void {
    // NO OP
    if (this.debug) {
      console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} mouse movement stopped`)
    }
  }

  setPivotVisible(data: any): void {
    console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} setPivotVislble: ${data}`)
    this.pivot.visible = data
  }

  getSelectionEmpty(): boolean {
    console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} getSelectionEmpty`)
    return true
  }

  setMoving(data: any): void {
    console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} setMoving: ${data}`)
    this.motion = data
  }

  setSettingsChanged(data: any): void {
    console.log(`${EXTERNAL_MOUSE_ERROR_PREFIX} setSettingsChanged: ${data}`)
    this.settings.changed = data
  }
}

export { _3DMouseThreeJS, _3DMouseThreeJSWindows }
