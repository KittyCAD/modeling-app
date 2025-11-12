import { btnName } from '@src/lib/cameraControls'
import { sceneInfra } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import {
  PerspectiveCamera,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
  Object3D,
  Mesh,
  MeshStandardMaterial,
  BufferGeometry,
  DirectionalLight,
  AmbientLight,
  Vector2,
  Matrix4,
  Quaternion,
  Vector3,
  Intersection,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'

const GIZMO_ASSETS_BASE = '/clientSideSceneAssets/gizmo_cube'

export default class GizmoRenderer {
    private readonly canvas: HTMLCanvasElement
  private readonly renderer: WebGLRenderer
  private readonly scene: Scene
  private camera: PerspectiveCamera | OrthographicCamera
  private clickableObjects: StandardMesh[] = []
  private _theme: 'light' | 'dark'

  private disabled = false
  private isDragging = false
  private dragLast: Vector2 | null = null
  private didDrag = false
  private lastMouse: Vector2 | null = null
  private raycasterIntersect: Intersection | null = null

  private readonly materials: {
    light: {
      edge: MeshStandardMaterial
      face: MeshStandardMaterial
    }
    dark: {
      edge: MeshStandardMaterial
      face: MeshStandardMaterial
    }
  }

  constructor(canvas: HTMLCanvasElement, isPerspective: boolean, theme: 'light' | 'dark') {
    this.canvas = canvas
    this.renderer = new WebGLRenderer({ canvas , antialias: true, alpha: true })
    this.renderer.setSize(120, 120)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    // TODO listen dpr change

    this.scene = new Scene()
    const ambient = new AmbientLight(0xffffff, 1.5)
    this.scene.add(ambient)

    this.camera = createCamera(isPerspective)
    this.setPerspective(isPerspective)
    this._theme =this.setTheme(theme)
    this.materials = {
      light: {
        edge: createMaterial(),
        face: createMaterial(),
      },
      dark: {
        edge: createMaterial(),
        face: createMaterial(),
      },
    }

    this.loadModel()
  }

  public setPerspective(isPerspective: boolean) {
    if (this.camera?.parent) {
      this.camera.parent.remove(this.camera)
    }
    this.camera = createCamera(isPerspective)

    // Light that follows the camera
    const light = new DirectionalLight(0xffffff, 1.9)
    light.position.set(2.5, 0.25, 1)
    this.camera.add(light)
  }

  public setTheme(theme: 'light' | 'dark') {
    if (this._theme !== theme) {
      this._theme = theme
      this.updateModel()
    }
    return theme;
  }

  public setDisabled(disabled: boolean) {
    this.disabled = disabled
  }

  private updateModel() {}

  private loadModel() {
    const loader = new GLTFLoader()
    loader.load(
      `${GIZMO_ASSETS_BASE}/gizmo_cube.glb`,
      (gltf) => {
        const root = gltf.scene
        root.position.set(0, 0, 0)
        root.scale.set(0.675, 0.675, 0.675)
        this.scene.add(root)

        root.traverse((obj) => {
          if (!obj || !obj.name) return
          if (!isStandardMesh(obj)) return
          if (isOrientationTargetName(obj.name)) this.clickableObjects.push(obj)
        })
    this.initListeners();
        // ;(async () => {
        //   await initTextures(
        //     root,
        //     resolvedTheme,
        //     renderer,
        //     texturesRef,
        //     hoverEdgeMaterialRef,
        //     hoverFaceMaterialRef
        //   )
        //   invalidate()
        // })().catch(console.error)
      },
      undefined,
      (e) => {
        console.log('err', e)
        // failed to load; leave without clickable faces
        this.clickableObjects = []
      }
    )
  }

  private initListeners() {
    this.canvas.addEventListener('mousemove', this.onCanvasMouseMove)
    this.canvas.addEventListener('mousedown', this.onMouseDown)
    this.canvas.addEventListener('contextmenu', this.onContextMenu)
    this.canvas.addEventListener('click', this.onClick)
  }

  public dispose() {
  }

  private onCanvasMouseMove = (event: MouseEvent) => {
    const { left, top, width, height } = this.canvas.getBoundingClientRect()
    const mousePos = new Vector2(
      ((event.clientX - left) / width) * 2 - 1,
      ((event.clientY - top) / height) * -2 + 1
    )
    this.lastMouse = mousePos
    if (!this.isDragging) {
      doRayCast(mousePos)
    }
  }

  private onWindowMouseMove = (event: MouseEvent) => {
    // Drag to rotate main camera
    if (this.isDragging) {
      sceneInfra.camControls.wasDragging = true
      const last = this.dragLast
      const now = new Vector2(event.clientX, event.clientY)
      this.dragLast = now
      if (last) {
        const dx = now.x - last.x
        const dy = now.y - last.y
        this.didDrag = this.didDrag || Math.hypot(dx, dy) > 1
        sceneInfra.camControls.rotateCamera(dx, dy)
        sceneInfra.camControls.safeLookAtTarget()

        sceneInfra.camControls.onCameraChange(true)
      }
    }
  }

  private onMouseDown = (event: MouseEvent) => {
    const isRightButton = btnName(event).right
    if (isRightButton || btnName(event).left) {
      this.isDragging = true
      this.didDrag = false
      this.dragLast = new Vector2(event.clientX, event.clientY)
      //clearHighlight()
      window.addEventListener('mousemove', this.onWindowMouseMove)
      window.addEventListener('mouseup', this.onMouseUp)
    }
  }

  private onMouseUp = (e: MouseEvent) => {
    this.isDragging = false
    this.dragLast = null
    sceneInfra.camControls.wasDragging = false

    window.removeEventListener('mousemove', this.onWindowMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('mouseleave', this.onMouseUp)
  }

  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  private onClick = () => {
    if (this.didDrag) {
      // suppress click if a drag occurred
      this.didDrag = false
      return
    }
    // If orbits are disabled, skip click logic
    if (!this.raycasterIntersect) {
      // If we have no current intersection (e.g., orbit disabled), do a forced raycast at the last mouse position
      if (this.lastMouse) {
        doRayCast(this.lastMouse, true)
      }
      if (!raycasterIntersect.current) {
        return
      }
    }
    let obj: Object3D | null = raycasterIntersect.current.object
    // Go up to a parent whose name matches if needed
    while (obj && !isOrientationTargetName(obj.name)) {
      obj = obj.parent
    }
    const pickedName = obj?.name || raycasterIntersect.current.object.name
    const targetQuat = orientationQuaternionForName(pickedName)
    if (targetQuat) {
      animateCameraToQuaternion(targetQuat).catch(reportRejection)
    }
  }

  private doRayCast(mouse: Vector2, force = false) {
    if (force || !this.disabled) {
        // raycaster.setFromCamera(mouse, camera)
        // const intersects = raycaster.intersectObjects(objects, true)
      
        // // Clear previous highlight if any
        // if (
        //   hoveredObjectRef.current &&
        //   (!intersects.length || hoveredObjectRef.current !== intersects[0].object)
        // ) {
        //   restoreHighlight(hoveredObjectRef.current, originalMaterialsRef.current)
        //   hoveredObjectRef.current = null
        // }
      
        // if (intersects.length) {
        //   const obj = intersects[0].object
        //   if (isStandardMesh(obj)) {
        //     if (hoveredObjectRef.current !== obj) {
        //       applyHighlight(
        //         obj,
        //         originalMaterialsRef.current,
        //         hoverMaterialRef.current,
        //         hoverFaceMaterialRef.current
        //       )
        //       hoveredObjectRef.current = obj
        //     }
        //     raycasterIntersect.current = intersects[0] // filter first object
        //   }
        // } else {
        //   raycasterIntersect.current = null
        // }

    } else {
      //this.clearHighlight()
    }
  }

}

const createCamera = (
  isPerspective: boolean
): PerspectiveCamera | OrthographicCamera => {
  const camera = isPerspective
    ? new PerspectiveCamera(35, 1, 0.1, 10)
    : new OrthographicCamera()
  if (camera instanceof OrthographicCamera) {
    camera.zoom = 1.4
    camera.updateProjectionMatrix()
  }

  return camera
}

type StandardMesh = Mesh<BufferGeometry, MeshStandardMaterial>
function isStandardMesh(object: Object3D | undefined): object is StandardMesh {
  if (!object) {
    return false
  }
  const mesh = object as Mesh
  if (mesh.material instanceof MeshStandardMaterial) {
    return true
  } else {
    if (mesh.isMesh) {
      console.warn('mesh is not StandardMesh!', object)
    }
    return false
  }
}

function isOrientationTargetName(name: string): boolean {
  return (
    name.startsWith('face_') ||
    name.startsWith('edge_') ||
    name.startsWith('corner_')
  )
}

function createMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x000000,
    roughness: 0.6,
    metalness: 0.0,
  })
}

// Compute the camera orientation quaternion for a given orientation name.
// Camera looks from +Z towards origin by default, so we rotate that view accordingly.
function orientationQuaternionForName(name: string): Quaternion | null {
    const q = new Quaternion()
    const up = new Vector3(0, 0, 1)
    const target = new Vector3(0, 0, 0)
  
    const dir = new Vector3()
    if (name.includes('front')) dir.add(new Vector3(0, -1, 0))
    if (name.includes('back')) dir.add(new Vector3(0, 1, 0))
    if (name.includes('left')) dir.add(new Vector3(-1, 0, 0))
    if (name.includes('right')) dir.add(new Vector3(1, 0, 0))
    if (name.includes('top')) dir.add(new Vector3(0, 0, 1))
    if (name.includes('bottom')) dir.add(new Vector3(0, 0, -1))
  
    if (dir.lengthSq() === 0) {
      return null
    }
    dir.normalize()
  
    // Build a lookAt quaternion placing the eye along the dir vector
    const distance = 1
    const eye = target.clone().add(dir.clone().multiplyScalar(distance))
    const m = new Matrix4().lookAt(eye, target, up)
    return q.setFromRotationMatrix(m)
  }

  async function animateCameraToQuaternion(targetQuat: Quaternion) {
    const camControls = sceneInfra.camControls
    camControls.syncDirection = 'clientToEngine'
    camControls.enableRotate = false
    try {
      sceneInfra.animate()
      await camControls.tweenCameraToQuaternion(
        targetQuat,
        camControls.target.clone(),
        500,
        false // !isPerspective: this doesn't work
      )
    } finally {
      sceneInfra.stop()
      camControls.enableRotate = true
      camControls.syncDirection = 'engineToClient'
    }
  }