import { btnName } from '@src/lib/cameraControls'
import { DprDetector } from '@src/lib/DprDetector'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { reportRejection } from '@src/lib/trap'
import type { Object3D, Mesh, ColorRepresentation, Texture } from 'three'
import {
  PerspectiveCamera,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
  MeshStandardMaterial,
  DirectionalLight,
  AmbientLight,
  BufferGeometry,
  Vector2,
  Matrix4,
  Quaternion,
  Vector3,
  Raycaster,
  LineSegments,
  LineBasicMaterial,
  Float32BufferAttribute,
  TextureLoader,
  SRGBColorSpace,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'

// Resolve assets via Vite so they work in browser and Electron (dev and packaged)
// Using ?url ensures bundler emits the asset and gives us a valid runtime URL.
import gizmoModelUrl from '/clientSideSceneAssets/gizmo_cube/gizmo_cube.glb?url'
import labelsDarkUrl from '/clientSideSceneAssets/gizmo_cube/labels_dark.png?url'
import labelsDarkHoverUrl from '/clientSideSceneAssets/gizmo_cube/labels_dark_hover.png?url'
import labelsLightUrl from '/clientSideSceneAssets/gizmo_cube/labels_light.png?url'
import labelsLightHoverUrl from '/clientSideSceneAssets/gizmo_cube/labels_light_hover.png?url'

export default class GizmoRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: WebGLRenderer
  private readonly scene: Scene
  private readonly dprDetector: DprDetector
  private readonly sceneInfra: SceneInfra
  private camera: PerspectiveCamera | OrthographicCamera
  private clickableObjects: StandardMesh[] = []
  private theme: 'light' | 'dark'

  private _texturePromises = new Map<string, Promise<Texture>>()
  private _textures = new Map<string, Texture>()

  private needsToRender = true
  private raf = -1

  private disabled = false
  private isDragging = false
  private dragLast: Vector2 | null = null
  private didDrag = false
  private lastMouse: Vector2 | null = null
  private hoveringMesh: StandardMesh | null = null

  private readonly materials: {
    light: {
      edge: MeshStandardMaterial
      edge_hover: MeshStandardMaterial
      face: MeshStandardMaterial
      face_hover: MeshStandardMaterial
    }
    dark: {
      edge: MeshStandardMaterial
      edge_hover: MeshStandardMaterial
      face: MeshStandardMaterial
      face_hover: MeshStandardMaterial
    }
  }

  constructor(
    canvas: HTMLCanvasElement,
    isPerspective: boolean,
    theme: 'light' | 'dark',
    sceneInfra: SceneInfra
  ) {
    this.canvas = canvas
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setSize(82, 82) // CANVAS_SIZE + border
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.dprDetector = new DprDetector(this.onDprChange)
    this.sceneInfra = sceneInfra

    this.scene = new Scene()
    const ambient = new AmbientLight(0xffffff, 1.8)
    this.scene.add(ambient)

    this.materials = {
      dark: {
        edge: this.createMaterial(0x363837),
        edge_hover: this.createMaterial(0xe2e3de),
        face: this.createMaterial(0x363837, labelsDarkUrl),
        face_hover: this.createMaterial(0xe2e3de, labelsDarkHoverUrl),
      },
      light: {
        edge: this.createMaterial(0xe2e3de),
        edge_hover: this.createMaterial(0x999999),
        face: this.createMaterial(0xe2e3de, labelsLightUrl),
        face_hover: this.createMaterial(0x363837, labelsLightHoverUrl),
      },
    }

    this.camera = createCamera(isPerspective)
    this.setPerspective(isPerspective)
    this.theme = this.setTheme(theme)

    this.loadModel()
  }

  private onDprChange = () => {
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.invalidate()
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

    // Add camera to scene so child light is evaluated
    this.scene.add(this.camera)

    this.invalidate()
  }

  public setTheme(theme: 'light' | 'dark') {
    if (this.theme !== theme) {
      this.theme = theme
      this.updateModel()
    }
    return theme
  }

  public setDisabled(disabled: boolean) {
    this.disabled = disabled
  }

  private updateModel() {
    const themeMaterials =
      this.theme === 'light' ? this.materials.light : this.materials.dark
    this.clickableObjects.forEach((object) => {
      const hovering = object === this.hoveringMesh
      const face = object.name.includes('face')
      const material = face
        ? hovering
          ? themeMaterials.face_hover
          : themeMaterials.face
        : hovering
          ? themeMaterials.edge_hover
          : themeMaterials.edge
      object.material = material
    })

    this.invalidate()
  }

  private loadModel() {
    const loader = new GLTFLoader()
    loader.load(
      gizmoModelUrl,
      (gltf) => {
        const root = gltf.scene
        root.position.set(0, 0, 0)
        root.scale.set(1.05, 1.05, 1.05)
        this.scene.add(root)

        root.traverse((obj) => {
          if (!obj || !obj.name) return
          if (!isStandardMesh(obj)) return
          if (isOrientationTargetName(obj.name)) this.clickableObjects.push(obj)
        })
        this.initListeners()
        // Ensure camera is positioned (without this when switching from axis the camera is incorrect)
        this.onCameraChange()
        // Build edge line visuals for edge_*/corner_* meshes
        this.createEdges(root)
        this.updateModel()
      },
      undefined,
      (e) => {
        console.log('err', e)
        // failed to load; leave without clickable faces
        this.clickableObjects = []
      }
    )
  }

  // Create a single line mesh for boundary edges across all edge_*/corner_* meshes
  // Idea: take each line of a triangle which is only shared by one triangle, those are the boundary edges,
  // otherwise they are internal edges that we don't want to render.
  private createEdges(root: Object3D) {
    const combinedLinePositions: number[] = []
    const worldPos = new Vector3()
    const rootLocalPos = new Vector3()
    // Ensure root matrix is up to date and get inverse for transforming world -> root space
    root.updateWorldMatrix(true, false)
    const rootInverse = new Matrix4().copy(root.matrixWorld).invert()

    root.traverse((obj) => {
      if (!isStandardMesh(obj)) return
      const name = obj.name || ''
      if (!(name.startsWith('edge_') || name.startsWith('corner_'))) return
      const geometry = obj.geometry
      const positionAttr = geometry.getAttribute('position')
      if (!positionAttr) return
      // Ensure world matrix is up-to-date
      obj.updateWorldMatrix(true, false)

      // Build triangle index array (per-mesh)
      let indices: number[] = []
      if (geometry.index) {
        const idxArr = geometry.index.array as ArrayLike<number>
        indices = Array.from(idxArr as number[])
      } else {
        const vertCount = positionAttr.count
        indices = Array.from({ length: vertCount }, (_v, i) => i)
      }

      // Count occurrences of undirected edges (per-mesh)
      type EdgeKey = string
      const edgeCount = new Map<EdgeKey, [number, number, number]>() // key -> [a,b,count]
      const addEdge = (a: number, b: number) => {
        const a1 = Math.min(a, b)
        const b1 = Math.max(a, b)
        const key = `${a1}-${b1}`
        const entry = edgeCount.get(key)
        if (entry) {
          entry[2] += 1
        } else {
          edgeCount.set(key, [a1, b1, 1])
        }
      }

      for (let i = 0; i + 2 < indices.length; i += 3) {
        const i0 = indices[i]
        const i1 = indices[i + 1]
        const i2 = indices[i + 2]
        addEdge(i0, i1)
        addEdge(i1, i2)
        addEdge(i2, i0)
      }

      // Add boundary edges transformed to world space to combined array
      const posArr = positionAttr.array as ArrayLike<number>
      const pushWorldVertex = (idx: number) => {
        const base = idx * 3
        worldPos.set(
          Number(posArr[base]),
          Number(posArr[base + 1]),
          Number(posArr[base + 2])
        )
        // Transform vertex into world space then into root-local space
        worldPos.applyMatrix4(obj.matrixWorld)
        rootLocalPos.copy(worldPos).applyMatrix4(rootInverse)
        combinedLinePositions.push(
          rootLocalPos.x,
          rootLocalPos.y,
          rootLocalPos.z
        )
      }
      edgeCount.forEach(([a, b, count]) => {
        if (count === 1) {
          pushWorldVertex(a)
          pushWorldVertex(b)
        }
      })
    })

    if (combinedLinePositions.length === 0) return

    const combinedGeom = new BufferGeometry()
    combinedGeom.setAttribute(
      'position',
      new Float32BufferAttribute(combinedLinePositions, 3)
    )
    const combinedMat = new LineBasicMaterial({ color: 0x999999 }) // chalkboard-60: oklch(68.19% 0 264.48)

    const combinedLines = new LineSegments(combinedGeom, combinedMat)
    combinedLines.name = 'gizmo_boundary_lines'
    root.add(combinedLines)
  }

  private invalidate() {
    this.needsToRender = true
    if (!(this.raf > -1)) {
      this.raf = requestAnimationFrame(this.onFrame)
    }
  }
  private onFrame = () => {
    this.raf = -1
    if (this.needsToRender) {
      this.needsToRender = false
      this.renderer.render(this.scene, this.camera)
    }
  }

  private initListeners() {
    this.canvas.addEventListener('mousemove', this.onMouseMove)
    this.canvas.addEventListener('mouseleave', this.onMouseLeaveCanvas)
    this.canvas.addEventListener('mousedown', this.onMouseDown)
    this.canvas.addEventListener('contextmenu', this.onContextMenu)
    this.canvas.addEventListener('click', this.onClick)
    this.sceneInfra.camControls.cameraChange.add(this.onCameraChange)
  }

  public dispose() {
    this.canvas.removeEventListener('mousemove', this.onMouseMove)
    this.canvas.removeEventListener('mouseleave', this.onMouseLeaveCanvas)
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.canvas.removeEventListener('click', this.onClick)
    this.sceneInfra.camControls.cameraChange.remove(this.onCameraChange)

    window.removeEventListener('mousemove', this.onWindowMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)

    if (this.raf > -1) {
      cancelAnimationFrame(this.raf)
    }
    this.dprDetector.dispose()
    this.renderer.forceContextLoss()
    this.renderer.dispose()
  }

  private onCameraChange = () => {
    const currentQuaternion = this.sceneInfra.camControls.camera.quaternion
    this.camera.position.set(0, 0, 2.2).applyQuaternion(currentQuaternion)
    this.camera.quaternion.copy(currentQuaternion)

    if (this.lastMouse && !this.isDragging) {
      this.doRayCast(this.lastMouse)
    }
    this.invalidate()
  }

  private onMouseMove = (event: MouseEvent) => {
    const { left, top, width, height } = this.canvas.getBoundingClientRect()
    const mousePos = new Vector2(
      ((event.clientX - left) / width) * 2 - 1,
      ((event.clientY - top) / height) * -2 + 1
    )
    this.lastMouse = mousePos
    if (!this.isDragging) {
      this.doRayCast(mousePos)
    }
  }

  private onMouseLeaveCanvas = () => {
    this.lastMouse = null
    this.updateHoveringMesh(null)
  }

  private onWindowMouseMove = (event: MouseEvent) => {
    // Drag to rotate main camera
    if (this.isDragging) {
      this.sceneInfra.camControls.wasDragging = true
      const last = this.dragLast
      const now = new Vector2(event.clientX, event.clientY)
      this.dragLast = now
      if (last) {
        const dx = now.x - last.x
        const dy = now.y - last.y
        this.didDrag = this.didDrag || Math.hypot(dx, dy) > 1

        if (this.didDrag) {
          this.updateHoveringMesh(null)
        }

        this.sceneInfra.camControls.rotateCamera(dx, dy)
        this.sceneInfra.camControls.safeLookAtTarget()

        this.sceneInfra.camControls.onCameraChange(true)
      }
    }
  }

  private onMouseDown = (event: MouseEvent) => {
    const btnNames = btnName(event)
    if (btnNames.right || btnNames.left) {
      this.isDragging = true
      this.didDrag = false
      this.dragLast = new Vector2(event.clientX, event.clientY)
      window.addEventListener('mousemove', this.onWindowMouseMove)
      window.addEventListener('mouseup', this.onMouseUp)
    }
  }

  private onMouseUp = (_e: MouseEvent) => {
    this.isDragging = false
    this.dragLast = null
    this.sceneInfra.camControls.wasDragging = false

    window.removeEventListener('mousemove', this.onWindowMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
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
    if (!this.hoveringMesh) {
      // If we have no current intersection (e.g., orbit disabled), do a forced raycast at the last mouse position
      if (this.lastMouse) {
        this.doRayCast(this.lastMouse)
      }
      if (!this.hoveringMesh) {
        return
      }
    }
    let obj: Object3D | null = this.hoveringMesh
    // Go up to a parent whose name matches if needed
    while (obj && !isOrientationTargetName(obj.name)) {
      obj = obj.parent
    }
    const pickedName = obj?.name || this.hoveringMesh.name
    const targetQuat = orientationQuaternionForName(pickedName)
    if (targetQuat) {
      animateCameraToQuaternion(targetQuat, this.sceneInfra).catch(
        reportRejection
      )
    }
  }

  private doRayCast(mouse: Vector2) {
    let hoveringMesh: StandardMesh | null = null
    if (!this.disabled) {
      const raycaster = new Raycaster()
      raycaster.setFromCamera(mouse, this.camera)
      const intersects = raycaster.intersectObjects(this.clickableObjects, true)

      if (intersects.length) {
        const obj = intersects[0]?.object
        if (isStandardMesh(obj)) {
          hoveringMesh = obj
        }
      }
    }

    this.updateHoveringMesh(hoveringMesh)
  }

  private updateHoveringMesh(hoveringMesh: StandardMesh | null) {
    if (this.hoveringMesh !== hoveringMesh) {
      this.hoveringMesh = hoveringMesh
      this.updateModel()
    }
  }

  private createMaterial(
    baseColor: ColorRepresentation,
    baseMapUrl?: string
  ): MeshStandardMaterial {
    const texture: Texture | undefined = baseMapUrl
      ? this._textures.get(baseMapUrl)
      : undefined

    const material = new MeshStandardMaterial({
      ...(texture ? { map: texture } : {}),
      color: texture ? 0xffffff : baseColor,
      emissive: 0x000000,
      roughness: 0.6,
      metalness: 0.0,
    })

    // Push faces slightly back so boundary line segments are clearer on top
    material.polygonOffset = true
    material.polygonOffsetFactor = 1
    material.polygonOffsetUnits = 1

    if (baseMapUrl && !this._textures.has(baseMapUrl)) {
      // baseMap is defined but not loaded yet
      this.loadTexture(baseMapUrl)
        .then((texture) => {
          material.map = texture
          material.color.setHex(0xffffff)
          material.needsUpdate = true
          this.invalidate()
        })
        .catch((e) => {
          console.error(e)
        })
    }

    return material
  }

  private async loadTexture(url: string): Promise<Texture> {
    const texture = this._textures.get(url)
    const texturePromise = this._texturePromises.get(url)

    if (texture) {
      return texture
    } else if (texturePromise) {
      return texturePromise
    } else {
      const loader = new TextureLoader()
      const promise = new Promise<Texture>((resolve, reject) => {
        loader.load(
          url,
          (texture) => {
            texture.flipY = false
            texture.colorSpace = SRGBColorSpace
            texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
            texture.needsUpdate = true
            this._texturePromises.delete(url)
            resolve(texture)
          },
          undefined,
          reject
        )
      })
      this._texturePromises.set(url, promise)
      return promise
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

// Compute the camera orientation quaternion for a given orientation name.
// Camera looks from +Z towards origin by default, so we rotate that view accordingly.
function orientationQuaternionForName(name: string): Quaternion | null {
  const q = new Quaternion()
  const defaultUp = new Vector3(0, 0, 1)
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

  const distance = 1
  const eye = target.clone().add(dir.clone().multiplyScalar(distance))
  const up =
    name === 'face_top'
      ? new Vector3(0, 1, 0)
      : name === 'face_bottom'
        ? new Vector3(0, -1, 0)
        : defaultUp
  const m = new Matrix4().lookAt(eye, target, up)
  return q.setFromRotationMatrix(m)
}

async function animateCameraToQuaternion(
  targetQuat: Quaternion,
  sceneInfra: SceneInfra
) {
  const camControls = sceneInfra.camControls
  camControls.syncDirection = 'clientToEngine'
  camControls.enableRotate = false
  try {
    sceneInfra.animate()
    await camControls.tweenCameraToQuaternion(
      targetQuat,
      camControls.target.clone(),
      500
    )
  } catch (e) {
    console.warn(e)
  } finally {
    sceneInfra.stop()
    camControls.enableRotate = true
    camControls.syncDirection = 'engineToClient'
  }
}
