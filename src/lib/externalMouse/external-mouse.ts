
import { Matrix4, Vector3} from 'three';
// @ts-ignore
import * as THREE from "../../node_modules/three/build/three.module.js"

declare global {
  var _3Dconnexion: any;
  interface Window {
    the3DMouse: any;
  }
}

type SixteenNumbers = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

type Min = number
type Max = number
type BoundingBox = [Min, Min, Min, Max, Max, Max]
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
    var fileNode = buttonBank.push(new _3Dconnexion.Category('CAT_ID_FILE', 'File'));
    var editNode = buttonBank.push(new _3Dconnexion.Category('CAT_ID_EDIT', 'Edit'));

    // Add menu items / actions
    fileNode.push(new _3Dconnexion.Action('ID_OPEN', 'Open', 'Open file'));
    fileNode.push(new _3Dconnexion.Action('ID_CLOSE', 'Close', 'Close file'));
    fileNode.push(new _3Dconnexion.Action('ID_EXIT', 'Exit', 'Exit program'));

    // Add menu items / actions
    editNode.push(new _3Dconnexion.Action('ID_UNDO', 'Undo', 'Shortcut is Ctrl + Z'));
    editNode.push(new _3Dconnexion.Action('ID_REDO', 'Redo', 'Shortcut is Ctrl + Y'));
    editNode.push(new _3Dconnexion.Action('ID_CUT', 'Cut', 'Shortcut is Ctrl + X'));
    editNode.push(new _3Dconnexion.Action('ID_COPY', 'Copy', 'Shortcut is Ctrl + C'));
    editNode.push(new _3Dconnexion.Action('ID_PASTE', 'Paste', 'Shortcut is Ctrl + V'));

    // Now add the images to the cache and associate it with the menu item by using the same id as the menu item / action
    // These images will be shown in the 3Dconnexion properties editor and in the UI elements which display the
    // active button configuration of the 3dmouse
    images.push(_3Dconnexion.ImageItem.fromURL('images/open.png', 'ID_OPEN'));
    images.push(_3Dconnexion.ImageItem.fromURL('images/close.png', 'ID_CLOSE'));
    images.push(_3Dconnexion.ImageItem.fromURL('images/exit.png', 'ID_EXIT'));
    images.push(_3Dconnexion.ImageItem.fromURL('images/Macro_Cut.png', 'ID_CUT'));
    images.push(_3Dconnexion.ImageItem.fromURL('images/Macro_Copy.png', 'ID_COPY'));
    images.push(_3Dconnexion.ImageItem.fromURL('images/Macro_Paste.png', 'ID_PASTE'));
    images.push(_3Dconnexion.ImageItem.fromURL('images/Macro_Undo.png', 'ID_UNDO'));
    images.push(_3Dconnexion.ImageItem.fromURL('images/Macro_Redo.png', 'ID_REDO'));
}

interface _3DconnexionHelper {
  connect(): boolean;
  debug: boolean;
  create3dmouse(canvas: HTMLElement | null, name: string): void;
  update3dcontroller(any): void
}

interface _3DconnexionMiddleware {
    // Callbacks
    getCoordinateSystem(): SixteenNumbers;
    getFrontView(): SixteenNumbers;
    getViewMatrix():SixteenNumbers;
    getFov():number;
    getPerspective():boolean;
    getModelExtents(): BoundingBox;
    getPointerPosition?(): Position;
    getPivotPositon?(): Position;
    getViewExtents(): ViewExtents;
    getFrameTime(): number;
    setViewExtents(viewExtents: ViewExtents): void;

    // Commands
    setActiveCommand(id:any): void;
    setViewMatrix(viewMatrix: SixteenNumbers): void;
    setFov(fov: number): void;
    setTransaction(transaction: number): void;
    onStartMotion(): void;
    onStopMotion(): void;

    // 3D mouse initialization
    init3DMouse(): void;
    onConnect(): void;
    onDisconnect(reason: string): void;
    on3dmouseCreated(): void

    // huh?
    render(time: number): void
}

interface _3DMouseConfiguration {
  debug: boolean,
  name: string
  canvasId: string
}

interface Model {
  extends: {
    min: Vector3
    max: Vector3
  }
}

class _3DMouse implements _3DconnexionMiddleware {
    spaceMouse: _3DconnexionHelper
    debug: boolean
    name: string
    canvasId: string
    animating: boolean = false
    cameraMatrix: SixteenNumbers = new THREE.Matrix4().identity().toArray()

    model: Model = {
      extends: {
        min: new THREE.Vector3(),
        max: new THREE.Vector3()
      }
    }

    // huh okay?
    viewportWidth: number
    viewportHeight : number
    fov : number
    frustumNear : number
    frustumFar : number
    left : number
    right: number
    bottom : number
    top : number

    constructor(configuration: _3DMouseConfiguration) {
        // no op for now
        console.log("_3DMouse has a no op constructor")

        this.name = configuration.name
        this.debug = configuration.debug
        this.canvasId = configuration.canvasId

        if (!_3Dconnexion) {
            console.error('Unable to find _3Dconnexion library')
        }
    }

    // callbacks
    getCoordinateSystem(): SixteenNumbers {
      // In this sample the cs has Y to the right, Z-up and X out of the screen
      return [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
    }

    getFrontView(): SixteenNumbers {
      return [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];
    }

    getModelExtents(): BoundingBox {
      return[-1,-1,-1,1,1,1]
    }

    getPerspective(): boolean {
      return false
    }

    getViewMatrix = function () {
      return Array.prototype.slice.call(this.cameraMatrix)
    }

    getFov(): number {
      return this.fov
    }

    getViewExtents(): ViewExtents {
        return [this.left, this.bottom, -this.frustumFar, this.right, this.top, -this.frustumNear];
    }

    getFrameTime(): number {
      return performance.now()
    }

    setViewExtents(viewExtents: ViewExtents): void {
      this.left = viewExtents[0]
      this.bottom = viewExtents[1]
      this.right = viewExtents[3]
      this.top = viewExtents[4]
    }

    // 3D mouse initialization
    init3DMouse(): void {
        this.spaceMouse = new _3Dconnexion(this)
        this.spaceMouse.debug = this.debug
        if (!this.spaceMouse.connect()) {
            if (this.debug)
                console.log("Cannot connect to 3Dconnexion NL-Proxy");
        }
    }

    // init3DMouse needs onConnect
    onConnect(): void {
      const canvas = document.getElementById(this.canvasId)

      this.viewportWidth = canvas.width
      this.viewportHeight = canvas.height
      this.fov = 33 * Math.PI / 180.0
      this.frustumNear = -1000
      this.frustumFar = 1000
      this.left = -175;
      this.right = -this.left;
      this.bottom = -(this.right - this.left) * this.viewportHeight / this.viewportWidth / 2.
      this.top = -this.bottom

      this.spaceMouse.create3dmouse(canvas, this.name)
    }

    onDisconnect(reason: string): void {
      console.log("3Dconnexion NL-Proxy disconnected " + reason);
    }

    on3dmouseCreated(): void {
        // global reference from window
        const actionTree = new _3Dconnexion.ActionTree()
        const actionImages = new _3Dconnexion.ImageCache()

        // set ourselves as the timing source for the animation frames
        this.spaceMouse.update3dcontroller({
          'frame': { 'timingSource': 1 }
        })

        actionImages.onload = () => {
          this.spaceMouse.update3dcontroller({ 'images': actionImages.images });
        };

                // An actionset can also be considered to be a buttonbank, a menubar, or a set of toolbars
        // Define a unique string for the action set to be able to specify the active action set
        // Because we only have one action set use the 'Default' action set id to not display the label
        var buttonBank = actionTree.push(new _3Dconnexion.ActionSet('Default', 'Custom action set'));
        getApplicationCommands(buttonBank, actionImages);

        // Expose the commands to 3Dxware and specify the active buttonbank / action set
        this.spaceMouse.update3dcontroller({ 'commands': { 'activeSet': 'Default', 'tree': actionTree } });
    }
   
    // commands
    setActiveCommand(id: any): void {
      if (id) {
        console.log("Id of command to execute= " + id)
      }
    }


    setViewMatrix(viewMatrix: SixteenNumbers): void {
      this.cameraMatrix = viewMatrix
    }

    setFov(fov: number): void {
      this.fov = fov
    }

    setTransaction(transaction: number): void {
      if(transaction === 0) {
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
      if(this.animating) {
        this.spaceMouse.update3dcontroller({
          'frame': { 'time': time }
        });
        window.requestAnimationFrame(this.render.bind(this))
      }
    }

    onStopMotion(): void {
      console.log("stopped!")
      this.animating = false
    }

}

const the3DMouse = new _3DMouse({
  // Name needs to be registered in the python proxy server!
  name:'Image Web Viewer',
  debug: true,
  canvasId: 'webgl'
})

window.the3DMouse = the3DMouse