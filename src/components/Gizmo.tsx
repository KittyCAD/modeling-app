import { Popover } from '@headlessui/react'
import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'
import type { Camera, Intersection, Object3D } from 'three'
import type { Mesh, Material, BufferGeometry } from 'three'
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
import { AxisNames } from '@src/lib/constants'
import { sceneInfra } from '@src/lib/singletons'
import { useSettings } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'

const CANVAS_SIZE = 120
const FOV = 35
const CAMERA_DISTANCE = 2.2
const GIZMO_CUBE_URL = '/clientSideSceneAssets/gizmo_cube.glb'
const FACE_TO_AXIS: Record<string, AxisNames> = {
  face_front: AxisNames.NEG_Y,
  face_back: AxisNames.Y,
  face_right: AxisNames.X,
  face_left: AxisNames.NEG_X,
  face_top: AxisNames.Z,
  face_bottom: AxisNames.NEG_Z,
}

export default function Gizmo() {
  const { state: modelingState } = useModelingContext()
  const settings = useSettings()
  const menuItems = useViewControlMenuItems()
  const wrapperRef = useRef<HTMLDivElement>(null!)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const raycasterIntersect = useRef<Intersection<Object3D> | null>(null)
  const cameraPassiveUpdateTimer = useRef(0)
  const disableOrbitRef = useRef(false)
  const raycasterObjectsRef = useRef<Object3D[]>([])
  const hoveredObjectRef = useRef<Object3D | null>(null)
  const originalMaterialsRef = useRef<Map<string, Material | Material[]>>(
    new Map()
  )
  const hoverMaterialRef = useRef<Material | null>(null)

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
    renderer.setSize(CANVAS_SIZE, CANVAS_SIZE)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    const scene = new Scene()
    const camera = createCamera()

    // Minimal lighting for GLTF PBR materials
    const ambient = new AmbientLight(0xffffff, 1.3)
    scene.add(ambient)
    // Add camera to scene so child light is evaluated
    scene.add(camera)
    // Light that follows the camera
    const camLight = new DirectionalLight(0xffffff, 1.6)
    camLight.position.set(2.5, 0.25, 1)
    camera.add(camLight)

    // A subtle lighter-white hover material
    hoverMaterialRef.current = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.2,
      roughness: 0.6,
      metalness: 0.0,
    })

    const loader = new GLTFLoader()
    loader.load(
      GIZMO_CUBE_URL,
      (gltf) => {
        const root = gltf.scene
        root.position.set(0, 0, 0)
        root.scale.set(0.675, 0.675, 0.675)
        scene.add(root)

        const clickableFaces: Object3D[] = []
        Object.keys(FACE_TO_AXIS).forEach((name) => {
          const obj = root.getObjectByName(name)
          if (isStandardMesh(obj)) {
            clickableFaces.push(obj)
          }
        })
        raycasterObjectsRef.current = clickableFaces

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
      // Allow forced raycasts on click even if orbiting is disabled
      if (force || !disableOrbitRef.current) {
        updateRayCaster(
          raycasterObjectsRef.current,
          raycaster,
          mouse,
          camera,
          raycasterIntersect,
          hoveredObjectRef,
          originalMaterialsRef,
          hoverMaterialRef
        )
        renderer.render(scene, camera)
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

    if (wrapperRef.current) {
    }

    const { disposeMouseEvents } = initializeMouseEvents(
      canvas,
      raycasterIntersect,
      sceneInfra,
      disableOrbitRef,
      doRayCast,
      wrapperRef
    )

    const clock = new Clock()
    const clientCamera = sceneInfra.camControls.camera
    let currentQuaternion = new Quaternion().copy(clientCamera.quaternion)

    const animate = () => {
      const delta = clock.getDelta()
      updateCameraOrientation(
        camera,
        currentQuaternion,
        sceneInfra.camControls.camera.quaternion,
        delta,
        cameraPassiveUpdateTimer
      )
      renderer.render(scene, camera)
    }
    sceneInfra.camControls.cameraChange.add(animate)

    return () => {
      renderer.dispose()
      disposeMouseEvents()
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

const createCamera = (): PerspectiveCamera => {
  const cam = new PerspectiveCamera(FOV, 1, 0.1, 10)
  cam.position.set(0, 0, CAMERA_DISTANCE)
  cam.lookAt(0, 0, 0)
  return cam
}

// Removed procedural gizmo; faces are provided by GLB nodes

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
    camera.position
      .set(0, 0, CAMERA_DISTANCE)
      .applyQuaternion(currentQuaternion)
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

const initializeMouseEvents = (
  canvas: HTMLCanvasElement,
  raycasterIntersect: MutableRefObject<Intersection<Object3D> | null>,
  sceneInfra: SceneInfra,
  disableOrbitRef: MutableRefObject<boolean>,
  doRayCast: (mouse: Vector2, force?: boolean) => void,
  wrapperRef: React.MutableRefObject<HTMLDivElement>
): { mouse: Vector2; disposeMouseEvents: () => void } => {
  const mouse = new Vector2()
  mouse.x = 1 // fix initial mouse position issue

  const handleMouseMove = (event: MouseEvent) => {
    const { left, top, width, height } = canvas.getBoundingClientRect()
    mouse.x = ((event.clientX - left) / width) * 2 - 1
    mouse.y = ((event.clientY - top) / height) * -2 + 1
    doRayCast(mouse)
  }

  const handleClick = () => {
    // If orbits are disabled, skip click logic
    if (!raycasterIntersect.current) {
      // If we have no current intersection (e.g., orbit disabled), do a forced raycast at the last mouse position
      doRayCast(mouse, true)
      if (!raycasterIntersect.current) {
        return
      }
    }
    let obj: Object3D | null = raycasterIntersect.current.object
    // Go up to a parent whose name matches if needed
    while (obj && !FACE_TO_AXIS[obj.name]) {
      obj = obj.parent
    }
    const pickedName = obj?.name || raycasterIntersect.current.object.name
    const axisName = FACE_TO_AXIS[pickedName] ?? pickedName
    animateCamToAxis(sceneInfra, axisName).catch(reportRejection)
  }

  // Add the event listener to the div wrapper around the canvas
  wrapperRef.current.addEventListener('mousemove', handleMouseMove)
  wrapperRef.current.addEventListener('click', handleClick)
  const wrapperRefClosure = wrapperRef.current

  const disposeMouseEvents = () => {
    wrapperRefClosure.removeEventListener('mousemove', handleMouseMove)
    wrapperRefClosure.removeEventListener('click', handleClick)
  }

  return { mouse, disposeMouseEvents }
}

const updateRayCaster = (
  objects: Object3D[],
  raycaster: Raycaster,
  mouse: Vector2,
  camera: Camera,
  raycasterIntersect: MutableRefObject<Intersection<Object3D> | null>,
  hoveredObjectRef: MutableRefObject<Object3D | null>,
  originalMaterialsRef: MutableRefObject<Map<string, Material | Material[]>>,
  hoverMaterialRef: MutableRefObject<Material | null>
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
    if (hoveredObjectRef.current !== obj) {
      applyHighlight(
        obj,
        originalMaterialsRef.current,
        hoverMaterialRef.current
      )
      hoveredObjectRef.current = obj
    }
    raycasterIntersect.current = intersects[0] // filter first object
  } else {
    raycasterIntersect.current = null
  }
}

function applyHighlight(
  target: Object3D,
  originalMaterials: Map<string, Material | Material[]>,
  hoverMaterial: Material | null
) {
  const mesh = target as Mesh
  if (!hoverMaterial) return
  if (!originalMaterials.has(mesh.uuid)) {
    // Save original material(s)
    originalMaterials.set(mesh.uuid, mesh.material)
    // Apply hover material (for multi-material meshes, apply to all slots)
    if (isArray(mesh.material)) {
      mesh.material = mesh.material.map(() => hoverMaterial)
    } else {
      mesh.material = hoverMaterial
    }
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

async function animateCamToAxis(sceneInfra: SceneInfra, axis: AxisNames) {
  // Temporarily switch to clientToEngine to allow tweening
  const camControls = sceneInfra.camControls
  const prevSync = camControls.syncDirection
  camControls.syncDirection = 'clientToEngine'

  try {
    const cam = camControls.camera
    const target = camControls.target.clone()
    const distance = cam.position.distanceTo(target)
    const up = new Vector3(0, 0, 1)

    const eye = target.clone()
    if (axis === AxisNames.X) eye.x += distance
    else if (axis === AxisNames.NEG_X) eye.x -= distance
    else if (axis === AxisNames.Y) eye.y += distance
    else if (axis === AxisNames.NEG_Y) eye.y -= distance
    else if (axis === AxisNames.Z) eye.z += distance
    else if (axis === AxisNames.NEG_Z) eye.z -= distance

    const lookMat = new Matrix4().lookAt(eye, target, up)
    const targetQuat = new Quaternion().setFromRotationMatrix(lookMat)

    await camControls._tweenCameraToQuaternion(targetQuat, target, 500, false)

    // After tween, send engine look_at to reconcile and keep in sync
    await camControls.updateCameraToAxis(axis)
  } finally {
    camControls.syncDirection = prevSync
  }
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
