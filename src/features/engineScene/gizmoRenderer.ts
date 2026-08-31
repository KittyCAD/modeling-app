import { effect } from '@preact/signals'
import {
  AmbientLight,
  BufferGeometry,
  type ColorRepresentation,
  DirectionalLight,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Scene,
  type Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import type { CameraDriver, ScenePoint } from '@src/contracts/scene'
import type { EngineCamera } from '@src/features/engineScene/createEngineCamera'
import { DprDetector } from '@src/lib/dprDetector'
import { orientationForName } from '@src/lib/scene/gizmoOrientation'

import gizmoModelUrl from '/clientSideSceneAssets/gizmo_cube/gizmo_cube.glb?url'
import labelsDarkUrl from '/clientSideSceneAssets/gizmo_cube/labels_dark.png?url'
import labelsDarkHoverUrl from '/clientSideSceneAssets/gizmo_cube/labels_dark_hover.png?url'
import labelsLightUrl from '/clientSideSceneAssets/gizmo_cube/labels_light.png?url'
import labelsLightHoverUrl from '/clientSideSceneAssets/gizmo_cube/labels_light_hover.png?url'

/**
 * The cube gizmo, ported from the existing app's `GizmoRenderer`.
 *
 * This one really is THREE.js, and it has to be: it is a lit model loaded from a
 * `.glb` with baked label textures, and there is no honest way to draw it as
 * SVG. So it comes over nearly unchanged — the model loading, the theme
 * materials, the boundary-edge extraction, the raycasting, the name-to-direction
 * mapping and the numbers are all the original's.
 *
 * Two couplings had to be replaced, and they are the only interesting part of
 * the port:
 *
 * The original reads the client camera's quaternion directly, because it has one.
 * We have no client camera — the scene is rendered elsewhere — so the orientation
 * is derived from the camera the engine *reports*, through the same `Matrix4`
 * look-at the original uses to build its target orientations. The cube therefore
 * turns with the model without anything owning the camera.
 *
 * The original tweens its own camera on a click. We ask the camera driver to look
 * from a direction, which is the same request expressed once instead of twice —
 * so the cube, the axis gizmo and the `v` keys all go through one path, and the
 * animation and the reduced-motion preference come for free.
 */

/** The canvas is square, and this is the original's size plus its border. */
const CANVAS_SIZE = 82

/** How far the gizmo camera sits from the cube. The original's number. */
const CAMERA_DISTANCE = 2.2

type StandardMesh = Mesh<BufferGeometry, MeshStandardMaterial>

function isStandardMesh(object: Object3D | undefined): object is StandardMesh {
  if (!object) return false
  const mesh = object as Mesh
  return mesh.material instanceof MeshStandardMaterial
}

/** The meshes in the model that mean "look from here". */
function isOrientationTargetName(name: string): boolean {
  return (
    name.startsWith('face_') ||
    name.startsWith('edge_') ||
    name.startsWith('corner_')
  )
}

const createCamera = (isPerspective: boolean) => {
  const camera = isPerspective
    ? new PerspectiveCamera(35, 1, 0.1, 10)
    : new OrthographicCamera()

  if (camera instanceof OrthographicCamera) {
    camera.zoom = 1.4
    camera.updateProjectionMatrix()
  }

  return camera
}

export interface GizmoRendererDependencies {
  camera: EngineCamera
  driver: () => CameraDriver | undefined
  /** The scene surface's size, for turning a gizmo drag into a camera drag. */
  viewport: () => { width: number; height: number }
}

export class GizmoRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: WebGLRenderer
  private readonly scene: Scene
  private readonly dprDetector: DprDetector
  private readonly dependencies: GizmoRendererDependencies
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
  private stopFollowing: (() => void) | null = null

  private readonly materials: Record<
    'light' | 'dark',
    Record<'edge' | 'edge_hover' | 'face' | 'face_hover', MeshStandardMaterial>
  >

  constructor(
    canvas: HTMLCanvasElement,
    theme: 'light' | 'dark',
    dependencies: GizmoRendererDependencies
  ) {
    this.canvas = canvas
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    })
    this.renderer.setSize(CANVAS_SIZE, CANVAS_SIZE)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.dprDetector = new DprDetector(this.onDprChange)
    this.dependencies = dependencies

    this.scene = new Scene()
    this.scene.add(new AmbientLight(0xffffff, 1.8))

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

    /*
     * Orthographic, always.
     *
     * The original's note, kept because it is a judgement rather than a
     * limitation: "Hardcoded to orthographic, the model doesn't look good in
     * perspective."
     */
    this.camera = createCamera(false)
    this.setPerspective(false)
    this.theme = theme

    this.loadModel()
  }

  private onDprChange = () => {
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.invalidate()
  }

  public setPerspective(isPerspective: boolean) {
    if (this.camera?.parent) this.camera.parent.remove(this.camera)
    this.camera = createCamera(isPerspective)

    // A light that follows the camera, so the cube is lit from the viewer's
    // shoulder however it is turned.
    const light = new DirectionalLight(0xffffff, 1.9)
    light.position.set(2.5, 0.25, 1)
    this.camera.add(light)

    // The camera goes in the scene so its child light is evaluated.
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
    const themeMaterials = this.materials[this.theme]

    for (const object of this.clickableObjects) {
      const hovering = object === this.hoveringMesh
      const face = object.name.includes('face')
      object.material = face
        ? hovering
          ? themeMaterials.face_hover
          : themeMaterials.face
        : hovering
          ? themeMaterials.edge_hover
          : themeMaterials.edge
    }

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
          if (!obj?.name) return
          if (!isStandardMesh(obj)) return
          if (isOrientationTargetName(obj.name)) this.clickableObjects.push(obj)
        })

        this.initListeners()
        // Position the camera before the first frame, or the cube arrives
        // facing the wrong way and only corrects on the next camera move.
        this.onCameraChange()
        this.createEdges(root)
        this.updateModel()
      },
      undefined,
      (error) => {
        console.error('gizmo: could not load the cube model', error)
        // Nothing to click, and nothing to draw. The widget stays blank rather
        // than throwing, which is what an asset that failed to load deserves.
        this.clickableObjects = []
      }
    )
  }

  /**
   * One line mesh for every boundary edge of the rounded parts.
   *
   * The original's trick, and worth keeping the comment for: take each edge of a
   * triangle that only one triangle uses. Those are the silhouette; the rest are
   * internal and would draw a wireframe over the whole cube.
   */
  private createEdges(root: Object3D) {
    const combinedLinePositions: number[] = []
    const worldPos = new Vector3()
    const rootLocalPos = new Vector3()
    root.updateWorldMatrix(true, false)
    const rootInverse = new Matrix4().copy(root.matrixWorld).invert()

    root.traverse((obj) => {
      if (!isStandardMesh(obj)) return
      const name = obj.name || ''
      if (!(name.startsWith('edge_') || name.startsWith('corner_'))) return

      const geometry = obj.geometry
      const positionAttr = geometry.getAttribute('position')
      if (!positionAttr) return
      obj.updateWorldMatrix(true, false)

      const indices: number[] = geometry.index
        ? Array.from(geometry.index.array as ArrayLike<number>)
        : Array.from({ length: positionAttr.count }, (_value, i) => i)

      const edgeCount = new Map<string, [number, number, number]>()
      const addEdge = (a: number, b: number) => {
        const low = Math.min(a, b)
        const high = Math.max(a, b)
        const key = `${low}-${high}`
        const entry = edgeCount.get(key)
        if (entry) entry[2] += 1
        else edgeCount.set(key, [low, high, 1])
      }

      for (let i = 0; i + 2 < indices.length; i += 3) {
        const i0 = indices[i] ?? 0
        const i1 = indices[i + 1] ?? 0
        const i2 = indices[i + 2] ?? 0
        addEdge(i0, i1)
        addEdge(i1, i2)
        addEdge(i2, i0)
      }

      const posArr = positionAttr.array as ArrayLike<number>
      const pushWorldVertex = (idx: number) => {
        const base = idx * 3
        worldPos.set(
          Number(posArr[base]),
          Number(posArr[base + 1]),
          Number(posArr[base + 2])
        )
        worldPos.applyMatrix4(obj.matrixWorld)
        rootLocalPos.copy(worldPos).applyMatrix4(rootInverse)
        combinedLinePositions.push(
          rootLocalPos.x,
          rootLocalPos.y,
          rootLocalPos.z
        )
      }

      for (const [a, b, count] of edgeCount.values()) {
        if (count === 1) {
          pushWorldVertex(a)
          pushWorldVertex(b)
        }
      }
    })

    if (combinedLinePositions.length === 0) return

    const combinedGeom = new BufferGeometry()
    combinedGeom.setAttribute(
      'position',
      new Float32BufferAttribute(combinedLinePositions, 3)
    )
    const combinedLines = new LineSegments(
      combinedGeom,
      new LineBasicMaterial({ color: 0x999999 })
    )
    combinedLines.name = 'gizmo_boundary_lines'
    root.add(combinedLines)
  }

  private invalidate() {
    this.needsToRender = true
    if (!(this.raf > -1)) this.raf = requestAnimationFrame(this.onFrame)
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

    // The original subscribes to its own camera's change event; ours is a signal
    // fed by what the engine reports.
    this.stopFollowing = effect(() => {
      void this.dependencies.camera.epoch.value
      this.onCameraChange()
    })
  }

  public dispose() {
    this.canvas.removeEventListener('mousemove', this.onMouseMove)
    this.canvas.removeEventListener('mouseleave', this.onMouseLeaveCanvas)
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.canvas.removeEventListener('click', this.onClick)
    this.stopFollowing?.()

    window.removeEventListener('mousemove', this.onWindowMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)

    if (this.raf > -1) cancelAnimationFrame(this.raf)
    this.dprDetector.dispose()
    this.renderer.forceContextLoss()
    this.renderer.dispose()
  }

  /**
   * Turn the cube to match the scene camera.
   *
   * The original copies its client camera's quaternion. We have no client
   * camera, so the same orientation is built from the vantage, the centre and
   * the up that the engine reports — through `Matrix4.lookAt`, which is the
   * function the original already uses to construct orientations, so the two
   * agree by construction rather than by convention.
   */
  private onCameraChange = () => {
    const frame = this.dependencies.camera.frame.peek()
    if (!frame) return

    const orientation = new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(
        new Vector3(frame.position.x, frame.position.y, frame.position.z),
        new Vector3(frame.target.x, frame.target.y, frame.target.z),
        new Vector3(frame.up.x, frame.up.y, frame.up.z)
      )
    )

    this.camera.position.set(0, 0, CAMERA_DISTANCE).applyQuaternion(orientation)
    this.camera.quaternion.copy(orientation)

    if (this.lastMouse && !this.isDragging) this.doRayCast(this.lastMouse)
    this.invalidate()
  }

  private onMouseMove = (event: MouseEvent) => {
    const { left, top, width, height } = this.canvas.getBoundingClientRect()
    const mousePos = new Vector2(
      ((event.clientX - left) / width) * 2 - 1,
      ((event.clientY - top) / height) * -2 + 1
    )
    this.lastMouse = mousePos
    if (!this.isDragging) this.doRayCast(mousePos)
  }

  private onMouseLeaveCanvas = () => {
    this.lastMouse = null
    this.updateHoveringMesh(null)
  }

  /**
   * Drag the cube to orbit the model.
   *
   * The original calls `rotateCamera(dx, dy)` on a camera it owns. We do not own
   * one, so the drag is forwarded as an ordinary rotate gesture — which the
   * engine interprets as a virtual trackball over its render target, so the
   * deltas are applied from the middle of the viewport. Dragging the gizmo
   * therefore feels like dragging the scene from its centre, which is as close
   * as this can get without a local camera to turn.
   */
  private onWindowMouseMove = (event: MouseEvent) => {
    if (!this.isDragging) return

    const last = this.dragLast
    const now = new Vector2(event.clientX, event.clientY)
    this.dragLast = now
    if (!last) return

    const dx = now.x - last.x
    const dy = now.y - last.y
    this.didDrag = this.didDrag || Math.hypot(dx, dy) > 1
    if (!this.didDrag) return

    this.updateHoveringMesh(null)
    this.dragOffset.x += dx
    this.dragOffset.y += dy
    this.dependencies.driver()?.gesture({
      kind: 'rotate',
      phase: 'move',
      at: this.dragPoint(this.dragOffset.x, this.dragOffset.y),
    })
  }

  /** Accumulated drag, so the gesture reports a position rather than a delta. */
  private dragOffset = { x: 0, y: 0 }

  private dragPoint(offsetX: number, offsetY: number): ScenePoint {
    const viewport = this.dependencies.viewport()
    return {
      x: viewport.width / 2 + offsetX,
      y: viewport.height / 2 + offsetY,
      viewport,
    }
  }

  private onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 && event.button !== 2) return

    this.isDragging = true
    this.didDrag = false
    this.dragLast = new Vector2(event.clientX, event.clientY)
    this.dragOffset = { x: 0, y: 0 }
    this.dependencies.driver()?.gesture({
      kind: 'rotate',
      phase: 'start',
      at: this.dragPoint(0, 0),
    })

    window.addEventListener('mousemove', this.onWindowMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
  }

  private onMouseUp = () => {
    if (this.isDragging && this.didDrag) {
      this.dependencies.driver()?.gesture({
        kind: 'rotate',
        phase: 'end',
        at: this.dragPoint(this.dragOffset.x, this.dragOffset.y),
      })
    }

    this.isDragging = false
    this.dragLast = null

    window.removeEventListener('mousemove', this.onWindowMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
  }

  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private onClick = () => {
    if (this.didDrag) {
      // A drag that ended over the cube is not a click on it.
      this.didDrag = false
      return
    }

    if (!this.hoveringMesh) {
      // No current intersection — orbiting may have been disabled while the
      // pointer moved — so ask again where it last was.
      if (this.lastMouse) this.doRayCast(this.lastMouse)
      if (!this.hoveringMesh) return
    }

    let obj: Object3D | null = this.hoveringMesh
    while (obj && !isOrientationTargetName(obj.name)) obj = obj.parent

    const pickedName = obj?.name || this.hoveringMesh.name
    const orientation = orientationForName(pickedName)
    if (!orientation) return

    this.dependencies.driver()?.lookFrom(orientation.direction, orientation.up)
  }

  private doRayCast(mouse: Vector2) {
    let hoveringMesh: StandardMesh | null = null

    if (!this.disabled) {
      const raycaster = new Raycaster()
      raycaster.setFromCamera(mouse, this.camera)
      const intersects = raycaster.intersectObjects(this.clickableObjects, true)
      const obj = intersects[0]?.object
      if (isStandardMesh(obj)) hoveringMesh = obj
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
    const texture = baseMapUrl ? this._textures.get(baseMapUrl) : undefined

    const material = new MeshStandardMaterial({
      ...(texture ? { map: texture } : {}),
      color: texture ? 0xffffff : baseColor,
      emissive: 0x000000,
      roughness: 0.6,
      metalness: 0.0,
    })

    // Faces are pushed slightly back so the boundary lines read clearly on top.
    material.polygonOffset = true
    material.polygonOffsetFactor = 1
    material.polygonOffsetUnits = 1

    if (baseMapUrl && !this._textures.has(baseMapUrl)) {
      this.loadTexture(baseMapUrl)
        .then((loaded) => {
          material.map = loaded
          material.color.setHex(0xffffff)
          material.needsUpdate = true
          this.invalidate()
        })
        .catch((error) => {
          console.error('gizmo: could not load a label texture', error)
        })
    }

    return material
  }

  private async loadTexture(url: string): Promise<Texture> {
    const texture = this._textures.get(url)
    if (texture) return texture

    const pending = this._texturePromises.get(url)
    if (pending) return pending

    const loader = new TextureLoader()
    const promise = new Promise<Texture>((resolve, reject) => {
      loader.load(
        url,
        (loaded) => {
          loaded.flipY = false
          loaded.colorSpace = SRGBColorSpace
          loaded.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
          loaded.needsUpdate = true
          this._textures.set(url, loaded)
          this._texturePromises.delete(url)
          resolve(loaded)
        },
        undefined,
        reject
      )
    })

    this._texturePromises.set(url, promise)
    return promise
  }
}
