import { Popover } from '@headlessui/react'
import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'
import { Color, OrthographicCamera, SRGBColorSpace } from 'three'
import type {
  Mesh,
  BufferGeometry,
  Camera,
  Intersection,
  Object3D,
  Texture,
} from 'three'
import {
  Clock,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  TextureLoader,
} from 'three'
import { AmbientLight, DirectionalLight, MeshStandardMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'

import { CustomIcon } from '@src/components/CustomIcon'
import {
  ViewControlContextMenu,
  useViewControlMenuItems,
} from '@src/components/ViewControlMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useResolvedTheme } from '@src/hooks/useResolvedTheme'
import { sceneInfra } from '@src/lib/singletons'
import { useSettings } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { btnName } from '@src/lib/cameraControls'
// Local asset base for gizmo files
const GIZMO_ASSETS_BASE = '/clientSideSceneAssets/gizmo_cube'

export default function Gizmo() {
  const { state: modelingState } = useModelingContext()
  const settings = useSettings()
  const resolvedTheme = useResolvedTheme()
  const menuItems = useViewControlMenuItems()
  const wrapperRef = useRef<HTMLDivElement>(null!)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const raycasterIntersect = useRef<Intersection | null>(null)
  const cameraPassiveUpdateTimer = useRef(0)
  const disableOrbitRef = useRef(false)
  const clickableObjects = useRef<StandardMesh[]>([])
  const hoveredObjectRef = useRef<StandardMesh | null>(null)
  const originalMaterialsRef = useRef<Map<string, MeshStandardMaterial>>(
    new Map()
  )
  const hoverMaterialRef = useRef<MeshStandardMaterial | null>(null)
  const hoverFaceMaterialRef = useRef<MeshStandardMaterial | null>(null)
  const gizmoRootRef = useRef<Object3D | null>(null)
  const textureLoaderRef = useRef<TextureLoader | null>(null)
  const texturesRef = useRef<{
    light?: Texture
    dark?: Texture
    lightHover?: Texture
    darkHover?: Texture
  }>({})

  const isPerspective =
    settings.modeling.cameraProjection.current === 'perspective'
  const cameraRef = useRef<Camera>(createCamera(isPerspective))
  const sceneRef = useRef(new Scene())
  const lastMouse = useRef<Vector2 | null>(null)
  const isDraggingRef = useRef(false)
  const dragLastRef = useRef<Vector2 | null>(null)
  const didDragRef = useRef(false)

  // Helpers scoped to component for textures and materials
  const ensureThemeTexturesLoaded = async (theme: 'light' | 'dark') => {
    if (!textureLoaderRef.current) return
    const loader = textureLoaderRef.current
    const load = (key: keyof typeof texturesRef.current, url: string) =>
      new Promise<void>((resolve, reject) => {
        if (texturesRef.current[key]) return resolve()
        loader.load(
          url,
          (t) => {
            t.flipY = false
            t.colorSpace = SRGBColorSpace
            t.needsUpdate = true
            texturesRef.current[key] = t
            resolve()
          },
          undefined,
          reject
        )
      })
    if (theme === 'dark') {
      await load('dark', `${GIZMO_ASSETS_BASE}/labels_dark.png`)
      await load('darkHover', `${GIZMO_ASSETS_BASE}/labels_dark_hover.png`)
    } else {
      await load('light', `${GIZMO_ASSETS_BASE}/labels_light.png`)
      await load('lightHover', `${GIZMO_ASSETS_BASE}/labels_light_hover.png`)
    }
  }

  const applyThemeTexturesToFaces = (theme: 'light' | 'dark') => {
    const root = gizmoRootRef.current
    if (!root) return
    const base =
      theme === 'dark' ? texturesRef.current.dark : texturesRef.current.light
    if (!base) return
    root.traverse((node) => {
      if (isStandardMesh(node) && node.name?.startsWith('face_')) {
        node.material.map = base
        // Ensure white base color behind label textures
        node.material.color.set(0xffffff)
        node.material.roughness = 0.6
        node.material.metalness = 0.0
        node.material.needsUpdate = true
      }
    })
  }

  const setupHoverFaceMaterial = () => {
    const root = gizmoRootRef.current
    if (!root) return
    const hoverTex =
      resolvedTheme === 'dark'
        ? texturesRef.current.darkHover
        : texturesRef.current.lightHover
    if (!hoverTex) return
    let faceMat: MeshStandardMaterial | null = null
    root.traverse((node) => {
      if (!faceMat && isStandardMesh(node) && node.name?.startsWith('face_')) {
        faceMat = node.material
      }
    })
    if (faceMat) {
      const cloned = (faceMat as MeshStandardMaterial).clone() as MeshStandardMaterial
      cloned.map = hoverTex
      //cloned.emissive = new Color(0x3c73ff)
      hoverFaceMaterialRef.current = cloned
    }
  }

  const edgeCornerPalette = {
    light: {
      base: new Color('#363837'),
      hover: new Color('#e2e3de'),
    },
    dark: {
      base: new Color('#e2e3de'),
      hover: new Color('#363837'),
    },
  } as const

  const applyEdgeCornerBaseColors = (theme: 'light' | 'dark') => {
    const root = gizmoRootRef.current
    if (!root) return
    const baseColor = edgeCornerPalette[theme].base
    root.traverse((node) => {
      if (
        isStandardMesh(node) &&
        (node.name?.startsWith('edge_') || node.name?.startsWith('corner_'))
      ) {
        node.material.color.copy(baseColor)
        node.material.roughness = 0.6
        node.material.metalness = 0.0
        node.material.needsUpdate = true
      }
    })
  }

  const setupHoverEdgeCornerMaterial = (theme: 'light' | 'dark') => {
    const hoverColor = edgeCornerPalette[theme].hover
    if (!hoverMaterialRef.current) {
      hoverMaterialRef.current = new MeshStandardMaterial({
        color: hoverColor,
        emissive: 0x000000,
        roughness: 0.6,
        metalness: 0.0,
      })
    } else {
      hoverMaterialRef.current.color.copy(hoverColor)
      hoverMaterialRef.current.emissive = new Color(0x000000)
      hoverMaterialRef.current.needsUpdate = true
    }
  }

  useEffect(() => {
    const previousCamera = cameraRef.current
    const camera = createCamera(isPerspective)
    cameraRef.current = camera

    // Light that follows the camera
    const light = new DirectionalLight(0xffffff, 1.9)
    light.position.set(2.5, 0.25, 1)
    camera.add(light)

    // Add camera to scene so child light is evaluated
    sceneRef.current.add(camera)

    if (rendererRef.current) {
      camera.updateMatrix()
      camera.updateProjectionMatrix()
      camera.updateWorldMatrix(true, true)
      rendererRef.current.render(sceneRef.current, camera)
    }

    return () => {
      if (previousCamera?.parent) {
        previousCamera.parent.remove(previousCamera)
      }
    }
  }, [isPerspective])

  // Temporary fix for #4040:
  // Disable gizmo orbiting in sketch mode
  // This effect updates disableOrbitRef whenever the user
  // toggles between Sketch mode and 3D mode
  useEffect(() => {
    disableOrbitRef.current =
      modelingState.matches('Sketch') &&
      !settings.app.allowOrbitInSketchMode.current
    if (wrapperRef.current) {
      // wrapperRef.current.style.filter = disableOrbitRef.current
      //   ? 'grayscale(100%)'
      //   : 'none'
      wrapperRef.current.style.cursor = disableOrbitRef.current
        ? 'not-allowed'
        : 'auto'
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [modelingState, settings.app.allowOrbitInSketchMode.current])

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setSize(120, 120)
    renderer.setPixelRatio(window.devicePixelRatio)
    rendererRef.current = renderer

    textureLoaderRef.current = new TextureLoader()

    const ambient = new AmbientLight(0xffffff, 1.5)
    sceneRef.current.add(ambient)

    hoverMaterialRef.current = new MeshStandardMaterial({
      color: 0x3c73ff,
      emissive: 0x000000,
      roughness: 0.6,
      metalness: 0.0,
    })

    const loader = new GLTFLoader()
    loader.load(
      `${GIZMO_ASSETS_BASE}/gizmo_cube.glb`,
      (gltf) => {
        const root = gltf.scene
        gizmoRootRef.current = root
        root.position.set(0, 0, 0)
        root.scale.set(0.675, 0.675, 0.675)
        sceneRef.current.add(root)

        const clickable: StandardMesh[] = []
        root.traverse((obj) => {
          if (!obj || !obj.name) return
          if (!isStandardMesh(obj)) return
          if (isOrientationTargetName(obj.name)) clickable.push(obj)
        })
        clickableObjects.current = clickable

        ;(async () => {
          const themeKey = resolvedTheme === 'dark' ? 'dark' : 'light'
          await ensureThemeTexturesLoaded(themeKey)
          applyThemeTexturesToFaces(themeKey)
          applyEdgeCornerBaseColors(themeKey)
          setupHoverEdgeCornerMaterial(themeKey)
          setupHoverFaceMaterial()
          applyMaxAnisotropyToObject(root, renderer)
          renderer.render(sceneRef.current, cameraRef.current)
        })().catch(console.error)
      },
      undefined,
      (e) => {
        console.log('err', e)
        // failed to load; leave without clickable faces
        clickableObjects.current = []
      }
    )

    const clearHighlight = () => {
      if (hoveredObjectRef.current) {
        restoreHighlight(hoveredObjectRef.current, originalMaterialsRef.current)
        hoveredObjectRef.current = null
      }
      raycasterIntersect.current = null // Clear intersection
    }

    const raycaster = new Raycaster()
    const doRayCast = (mouse: Vector2, force = false) => {
      if (force || !disableOrbitRef.current) {
        updateRayCaster(
          clickableObjects.current,
          raycaster,
          mouse,
          cameraRef.current,
          raycasterIntersect,
          hoveredObjectRef,
          originalMaterialsRef,
          hoverMaterialRef,
          hoverFaceMaterialRef
        )
        renderer.render(sceneRef.current, cameraRef.current)
      } else {
        clearHighlight()
      }
    }

    const onCanvasMouseMove = (event: MouseEvent) => {
      const { left, top, width, height } = canvas.getBoundingClientRect()
      const mousePos = new Vector2(
        ((event.clientX - left) / width) * 2 - 1,
        ((event.clientY - top) / height) * -2 + 1
      )
      lastMouse.current = mousePos
      if (!isDraggingRef.current) {
        doRayCast(mousePos)
      }
    }

    const onWindowMouseMove = (event: MouseEvent) => {
      // Drag to rotate main camera
      if (isDraggingRef.current) {
        sceneInfra.camControls.wasDragging = true
        const last = dragLastRef.current
        const now = new Vector2(event.clientX, event.clientY)
        dragLastRef.current = now
        if (last) {
          const dx = now.x - last.x
          const dy = now.y - last.y
          didDragRef.current = didDragRef.current || Math.hypot(dx, dy) > 1
          sceneInfra.camControls.rotateCamera(dx, dy)
          sceneInfra.camControls.safeLookAtTarget()

          sceneInfra.camControls.onCameraChange(true)
        }
      }
    }

    const onMouseDown = (event: MouseEvent) => {
      const isRightButton = btnName(event).right
      if (isRightButton || btnName(event).left) {
        isDraggingRef.current = true
        didDragRef.current = false
        dragLastRef.current = new Vector2(event.clientX, event.clientY)
        clearHighlight()
        window.addEventListener('mousemove', onWindowMouseMove)
        window.addEventListener('mouseup', onMouseUp)
      }
    }

    const onMouseUp = (e: MouseEvent) => {
      isDraggingRef.current = false
      dragLastRef.current = null
      sceneInfra.camControls.wasDragging = false

      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mouseleave', onMouseUp)
    }

    const onClick = () => {
      if (didDragRef.current) {
        // suppress click if a drag occurred
        didDragRef.current = false
        return
      }
      // If orbits are disabled, skip click logic
      if (!raycasterIntersect.current) {
        // If we have no current intersection (e.g., orbit disabled), do a forced raycast at the last mouse position
        if (lastMouse.current) {
          doRayCast(lastMouse.current, true)
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

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const canvasParent = wrapperRef.current
    canvasParent.addEventListener('mousemove', onCanvasMouseMove)
    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('contextmenu', onContextMenu)
    canvasParent.addEventListener('click', onClick)

    const clock = new Clock()
    const clientCamera = sceneInfra.camControls.camera
    const currentQuaternion = new Quaternion().copy(clientCamera.quaternion)

    const onCameraChange = () => {
      const delta = clock.getDelta()
      updateCameraOrientation(
        cameraRef.current,
        currentQuaternion,
        sceneInfra.camControls.camera.quaternion,
        delta,
        cameraPassiveUpdateTimer
      )
      renderer.render(sceneRef.current, cameraRef.current)
      if (!isDraggingRef.current && lastMouse.current) {
        doRayCast(lastMouse.current)
      }
    }
    sceneInfra.camControls.cameraChange.add(onCameraChange)

    return () => {
      renderer.dispose()

      canvasParent.removeEventListener('mousemove', onCanvasMouseMove)
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvasParent.removeEventListener('click', onClick)

      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onMouseUp)

      sceneInfra.camControls.cameraChange.remove(onCameraChange)
    }
  }, [])

  // Update face textures when theme changes
  useEffect(() => {
    if (!gizmoRootRef.current || !rendererRef.current) return
    ;(async () => {
      const themeKey = resolvedTheme === 'dark' ? 'dark' : 'light'
      await ensureThemeTexturesLoaded(themeKey)
      applyThemeTexturesToFaces(themeKey)
      applyEdgeCornerBaseColors(themeKey)
      setupHoverEdgeCornerMaterial(themeKey)
      setupHoverFaceMaterial()
      applyMaxAnisotropyToObject(gizmoRootRef.current!, rendererRef.current!)
      rendererRef.current!.render(sceneRef.current, cameraRef.current)
    })().catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme])

  return (
    <div className="relative">
      <div
        ref={wrapperRef}
        aria-label="View orientation gizmo"
        data-testid={`gizmo${disableOrbitRef.current ? '-disabled' : ''}`}
        className="grid place-content-center rounded-full overflow-hidden border border-solid border-primary/50 pointer-events-auto bg-chalkboard-10/70 dark:bg-chalkboard-100/80 backdrop-blur-sm"
      >
        <canvas ref={canvasRef} />
        <ViewControlContextMenu menuTargetElement={wrapperRef} />
      </div>
      <GizmoDropdown items={menuItems} />
    </div>
  )
}

function GizmoDropdown({ items }: { items: React.ReactNode[] }) {
  return (
    <Popover className="absolute top-0 right-0 pointer-events-auto">
      {({ close }) => (
        <>
          <Popover.Button className="border-none p-0 m-0 -translate-y-1/4 translate-x-1/4">
            <CustomIcon
              name="caretDown"
              className="w-4 h-4 ui-open:rotate-180"
            />
            <span className="sr-only">View settings</span>
          </Popover.Button>
          <Popover.Panel
            className={`absolute bottom-full right-0 mb-2 w-48 bg-chalkboard-10 dark:bg-chalkboard-90
      border border-solid border-chalkboard-10 dark:border-chalkboard-90 rounded
      shadow-lg`}
          >
            <ul className="relative flex flex-col items-stretch content-stretch p-0.5">
              {items.map((item, index) => (
                <li key={index} className="contents" onClick={() => close()}>
                  {item}
                </li>
              ))}
            </ul>
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
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

const updateCameraOrientation = (
  camera: Camera,
  currentQuaternion: Quaternion,
  targetQuaternion: Quaternion,
  deltaTime: number,
  cameraPassiveUpdateTimer: MutableRefObject<number>
) => {
  cameraPassiveUpdateTimer.current += deltaTime
  if (
    !quaternionsEqual(currentQuaternion, targetQuaternion) ||
    cameraPassiveUpdateTimer.current >= 5
  ) {
    const slerpFactor = 1 - Math.exp(-30 * deltaTime)
    currentQuaternion.slerp(targetQuaternion, slerpFactor).normalize()
    camera.position.set(0, 0, 2.2).applyQuaternion(currentQuaternion)
    camera.quaternion.copy(currentQuaternion)
    cameraPassiveUpdateTimer.current = 0
  }
}

const quaternionsEqual = (
  q1: Quaternion,
  q2: Quaternion,
  tolerance: number = 0.001
): boolean => {
  return (
    Math.abs(q1.x - q2.x) < tolerance &&
    Math.abs(q1.y - q2.y) < tolerance &&
    Math.abs(q1.z - q2.z) < tolerance &&
    Math.abs(q1.w - q2.w) < tolerance
  )
}

const updateRayCaster = (
  objects: Object3D[],
  raycaster: Raycaster,
  mouse: Vector2,
  camera: Camera,
  raycasterIntersect: MutableRefObject<Intersection | null>,
  hoveredObjectRef: MutableRefObject<StandardMesh | null>,
  originalMaterialsRef: MutableRefObject<Map<string, MeshStandardMaterial>>,
  hoverMaterialRef: MutableRefObject<MeshStandardMaterial | null>,
  hoverFaceMaterialRef: MutableRefObject<MeshStandardMaterial | null>
) => {
  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(objects, true)

  // Clear previous highlight if any
  if (
    hoveredObjectRef.current &&
    (!intersects.length || hoveredObjectRef.current !== intersects[0].object)
  ) {
    restoreHighlight(hoveredObjectRef.current, originalMaterialsRef.current)
    hoveredObjectRef.current = null
  }

  if (intersects.length) {
    const obj = intersects[0].object
    if (isStandardMesh(obj)) {
      if (hoveredObjectRef.current !== obj) {
        applyHighlight(
          obj,
          originalMaterialsRef.current,
          hoverMaterialRef.current,
          hoverFaceMaterialRef.current
        )
        hoveredObjectRef.current = obj
      }
      raycasterIntersect.current = intersects[0] // filter first object
    }
  } else {
    raycasterIntersect.current = null
  }
}

function applyHighlight(
  target: Object3D,
  originalMaterials: Map<string, MeshStandardMaterial>,
  hoverMaterial: MeshStandardMaterial | null,
  hoverFaceMaterial: MeshStandardMaterial | null
) {
  if (!isStandardMesh(target)) {
    console.warn('target should be a standard mesh')
    return
  }
  if (!originalMaterials.has(target.uuid)) {
    // Save original material(s)
    originalMaterials.set(target.uuid, target.material)
    // Apply face-specific hover texture when over faces, otherwise generic hover
    if (target.name?.startsWith('face_') && hoverFaceMaterial) {
      target.material = hoverFaceMaterial
    } else if (hoverMaterial) {
      target.material = hoverMaterial
    }
  }
}

function restoreHighlight(
  target: StandardMesh,
  originalMaterials: Map<string, MeshStandardMaterial>
) {
  const record = originalMaterials.get(target.uuid)
  if (!record) {
    return
  }
  target.material = record
  originalMaterials.delete(target.uuid)
}

// Without this text on the cube sides becomes blurry on side view angles.
function applyMaxAnisotropyToObject(obj: Object3D, renderer: WebGLRenderer) {
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  obj.traverse((node: Object3D) => {
    if (isStandardMesh(node)) {
      const mat = node.material
      const textures = [
        mat.map,
        mat.normalMap,
        mat.roughnessMap,
        mat.metalnessMap,
        mat.aoMap,
        mat.emissiveMap,
        mat.bumpMap,
        mat.displacementMap,
        mat.alphaMap,
      ]
      textures.forEach((texture) => {
        if (texture && texture.anisotropy !== maxAnisotropy) {
          texture.anisotropy = maxAnisotropy
        }
      })
    }
  })
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

// Orientation targets supported by the GLB
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
  const up = new Vector3(0, 0, 1)
  const target = new Vector3(0, 0, 0)

  // derive an eye direction from the name
  // faces: axis aligned; edges: 45° between two axes; corners: towards the vertex (1,1,1) combos
  const dir = new Vector3()
  if (name.startsWith('face_')) {
    if (name.endsWith('front')) dir.set(0, -1, 0)
    else if (name.includes('back')) dir.set(0, 1, 0)
    else if (name.includes('right')) dir.set(1, 0, 0)
    else if (name.includes('left')) dir.set(-1, 0, 0)
    else if (name.includes('top')) dir.set(0, 0, 1)
    else if (name.includes('bottom')) dir.set(0, 0, -1)
  } else if (name.startsWith('edge_')) {
    // edges are equal mixes of two axes (unit, then normalized)
    if (name.includes('front')) dir.add(new Vector3(0, -1, 0))
    if (name.includes('back')) dir.add(new Vector3(0, 1, 0))
    if (name.includes('left')) dir.add(new Vector3(-1, 0, 0))
    if (name.includes('right')) dir.add(new Vector3(1, 0, 0))
    if (name.includes('top')) dir.add(new Vector3(0, 0, 1))
    if (name.includes('bottom')) dir.add(new Vector3(0, 0, -1))
  } else if (name.startsWith('corner')) {
    // corners mix three axes
    if (name.includes('front')) dir.add(new Vector3(0, -1, 0))
    if (name.includes('back')) dir.add(new Vector3(0, 1, 0))
    if (name.includes('left')) dir.add(new Vector3(-1, 0, 0))
    if (name.includes('right')) dir.add(new Vector3(1, 0, 0))
    if (name.includes('top')) dir.add(new Vector3(0, 0, 1))
    if (name.includes('bottom')) dir.add(new Vector3(0, 0, -1))
  } else {
    return null
  }

  if (dir.lengthSq() === 0) return null
  dir.normalize()

  // Build a lookAt quaternion placing the eye along the dir vector
  const distance = 1
  const eye = target.clone().add(dir.clone().multiplyScalar(distance))
  const m = new Matrix4().lookAt(eye, target, up)
  return q.setFromRotationMatrix(m)
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
