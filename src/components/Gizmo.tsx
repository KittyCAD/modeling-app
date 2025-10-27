import { Popover } from '@headlessui/react'
import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'
import { OrthographicCamera } from 'three'
import type {
  Mesh,
  Material,
  BufferGeometry,
  Camera,
  Intersection,
  Object3D,
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
} from 'three'
import { AmbientLight, DirectionalLight, MeshStandardMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { CustomIcon } from '@src/components/CustomIcon'
import {
  ViewControlContextMenu,
  useViewControlMenuItems,
} from '@src/components/ViewControlMenu'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { sceneInfra } from '@src/lib/singletons'
import { useSettings } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'

export default function Gizmo() {
  const { state: modelingState } = useModelingContext()
  const settings = useSettings()
  const menuItems = useViewControlMenuItems()
  const wrapperRef = useRef<HTMLDivElement>(null!)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const raycasterIntersect = useRef<Intersection | null>(null)
  const cameraPassiveUpdateTimer = useRef(0)
  const disableOrbitRef = useRef(false)
  const raycasterObjectsRef = useRef<StandardMesh[]>([])
  const hoveredObjectRef = useRef<StandardMesh | null>(null)
  const originalMaterialsRef = useRef<Map<string, MeshStandardMaterial>>(
    new Map()
  )
  const hoverMaterialRef = useRef<MeshStandardMaterial | null>(null)

  const isPerspective =
    settings.modeling.cameraProjection.current === 'perspective'
  const cameraRef = useRef<Camera>(createCamera(isPerspective))
  const sceneRef = useRef(new Scene())
  const lastMouse = useRef<Vector2 | null>(null)

  useEffect(() => {
    const previousCamera = cameraRef.current
    const camera = createCamera(isPerspective)
    cameraRef.current = camera

    // Light that follows the camera
    const light = new DirectionalLight(0xffffff, 1.6)
    light.position.set(2.5, 0.25, 1)
    camera.add(light)

    // Add camera to scene so child light is evaluated
    sceneRef.current.add(camera)

    if (rendererRef.current) {
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

    const ambient = new AmbientLight(0xffffff, 1.3)
    sceneRef.current.add(ambient)

    hoverMaterialRef.current = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.2,
      roughness: 0.6,
      metalness: 0.0,
    })

    const loader = new GLTFLoader()
    loader.load(
      '/clientSideSceneAssets/gizmo_cube.glb',
      (gltf) => {
        const root = gltf.scene
        root.position.set(0, 0, 0)
        root.scale.set(0.675, 0.675, 0.675)
        sceneRef.current.add(root)

        const clickable: StandardMesh[] = []
        root.traverse((obj) => {
          if (!obj || !obj.name) return
          if (!isStandardMesh(obj)) return
          if (isOrientationTargetName(obj.name)) clickable.push(obj)
        })
        raycasterObjectsRef.current = clickable

        const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
        applyMaxAnisotropyToObject(root, maxAnisotropy)
      },
      undefined,
      (e) => {
        console.log('err', e)
        // failed to load; leave without clickable faces
        raycasterObjectsRef.current = []
      }
    )

    const raycaster = new Raycaster()
    const doRayCast = (mouse: Vector2, force = false) => {
      if (force || !disableOrbitRef.current) {
        updateRayCaster(
          raycasterObjectsRef.current,
          raycaster,
          mouse,
          cameraRef.current,
          raycasterIntersect,
          hoveredObjectRef,
          originalMaterialsRef,
          hoverMaterialRef
        )
        renderer.render(sceneRef.current, cameraRef.current)
      } else {
        // Reset hovered highlight
        if (hoveredObjectRef.current) {
          restoreHighlight(
            hoveredObjectRef.current,
            originalMaterialsRef.current
          )
          hoveredObjectRef.current = null
        }
        raycasterIntersect.current = null // Clear intersection
      }
    }

    const onMouseMove = (event: MouseEvent) => {
      const { left, top, width, height } = canvas.getBoundingClientRect()
      const mousePos = new Vector2(
        ((event.clientX - left) / width) * 2 - 1,
        ((event.clientY - top) / height) * -2 + 1
      )
      lastMouse.current = mousePos
      doRayCast(mousePos)
    }

    const onClick = () => {
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
        animateCameraToQuaternion(sceneInfra, targetQuat).catch(reportRejection)
      }
    }

    // Add the event listener to the div wrapper around the canvas
    const canvasParent = wrapperRef.current
    canvasParent.addEventListener('mousemove', onMouseMove)
    canvasParent.addEventListener('click', onClick)

    const clock = new Clock()
    const clientCamera = sceneInfra.camControls.camera
    const currentQuaternion = new Quaternion().copy(clientCamera.quaternion)

    const animate = () => {
      const delta = clock.getDelta()
      updateCameraOrientation(
        cameraRef.current,
        currentQuaternion,
        sceneInfra.camControls.camera.quaternion,
        delta,
        cameraPassiveUpdateTimer
      )
      renderer.render(sceneRef.current, cameraRef.current)
      if (lastMouse.current) {
        doRayCast(lastMouse.current)
      }
    }
    sceneInfra.camControls.cameraChange.add(animate)

    return () => {
      renderer.dispose()

      canvasParent.removeEventListener('mousemove', onMouseMove)
      canvasParent.removeEventListener('click', onClick)
      sceneInfra.camControls.cameraChange.remove(animate)
    }
  }, [])

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
    camera.zoom = 1.3
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
  hoverMaterialRef: MutableRefObject<MeshStandardMaterial | null>
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
          hoverMaterialRef.current
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
  hoverMaterial: MeshStandardMaterial | null
) {
  if (!isStandardMesh(target)) {
    console.warn('target should be a standard mesh')
    return
  }
  if (!hoverMaterial) return
  if (!originalMaterials.has(target.uuid)) {
    // Save original material(s)
    originalMaterials.set(target.uuid, target.material)
    // Apply hover material
    target.material = hoverMaterial
  }
}

function restoreHighlight(
  target: Object3D,
  originalMaterials: Map<string, Material | Material[]>
) {
  const mesh = target as Mesh

  const record = originalMaterials.get(mesh.uuid)
  if (!record) return
  mesh.material = record
  if (isArray(mesh.material))
    mesh.material.forEach((m) => (m.needsUpdate = true))
  else mesh.material.needsUpdate = true
  originalMaterials.delete(mesh.uuid)
}

// Without this text on the cube sides becomes blurry on side view angles.
function applyMaxAnisotropyToObject(obj: Object3D, maxAnisotropy: number) {
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

async function animateCameraToQuaternion(
  sceneInfra: SceneInfra,
  targetQuat: Quaternion
) {
  const camControls = sceneInfra.camControls
  camControls.syncDirection = 'clientToEngine'
  try {
    sceneInfra.animate()
    await camControls.tweenCameraToQuaternion(
      targetQuat,
      camControls.target.clone(),
      500,
      false
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
