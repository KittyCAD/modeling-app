import { useEffect, useMemo, useRef, useState } from 'react'
import { useSignals } from '@preact/signals-react/runtime'
import {
  Box3,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import {
  addOpenCascadeCameraControlListener,
  type CameraAxisName,
  type OpenCascadeCameraControlCommand,
} from '@src/lib/cameraControls'
import {
  darkModeMatcher,
  getOppositeTheme,
  getResolvedTheme,
  getThemeColorForThreeJs,
  Themes,
} from '@src/lib/theme'
import type { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'
import { isArray } from '@src/lib/utils'

const OPEN_CASCADE_SOLID_ROOT = 'OPEN_CASCADE_SOLID_ROOT'
const OPEN_CASCADE_PROFILE_ROOT = 'OPEN_CASCADE_PROFILE_ROOT'
const OPEN_CASCADE_LIGHT_ROOT = 'OPEN_CASCADE_LIGHT_ROOT'
const OPEN_CASCADE_EDGE_LINES_NAME = 'open-cascade-edge-lines'

type OpenCascadeCamera = PerspectiveCamera | OrthographicCamera
type ResolvedTheme = Exclude<Themes, Themes.System>

interface OpenCascadeSceneStyle {
  backgroundColor: number
  edgeColor: number
  surfaceColor: string
  profileColor: string
}

export function OpenCascadeThreeScene({ diagnostic }: { diagnostic?: string }) {
  useSignals()
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { state } = useModelingContext()
  const settingsValues = settings.useSettings()
  const appTheme = settingsValues.app.theme.current
  const cameraProjection = settingsValues.modeling.cameraProjection.current
  const highlightEdges = settingsValues.modeling.highlightEdges.current
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    getResolvedTheme(appTheme)
  )
  const sceneStyle = useMemo(
    () => getOpenCascadeSceneStyle(resolvedTheme),
    [resolvedTheme]
  )
  const sceneStyleRef = useRef(sceneStyle)
  const highlightEdgesRef = useRef(highlightEdges)
  const targetRef = useRef(new Vector3())
  const modelRadiusRef = useRef(5)
  const hasFramedModelRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [stage, setStage] = useState('waiting')
  const engineCommandManager =
    kclManager.engineCommandManager as EngineCommandManagerProxy
  const openCascadeManager = engineCommandManager.openCascadeCommandManager
  const latestShapeVersion = openCascadeManager.latestShapeVersion.value
  const latestProfileVersion = openCascadeManager.latestProfileVersion.value
  const exportError = diagnostic || openCascadeManager.latestExportError.value
  const passiveProfilesVisible =
    !state.matches('Sketch') && !state.matches('sketchSolveMode')

  sceneStyleRef.current = sceneStyle
  highlightEdgesRef.current = highlightEdges

  useEffect(() => {
    const syncResolvedTheme = () => {
      setResolvedTheme(getResolvedTheme(appTheme))
    }
    syncResolvedTheme()

    if (appTheme !== Themes.System) {
      return
    }

    darkModeMatcher?.addEventListener('change', syncResolvedTheme)
    return () => {
      darkModeMatcher?.removeEventListener('change', syncResolvedTheme)
    }
  }, [appTheme])

  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    const scene = sceneInfra.scene
    const solidRoot = new Group()
    solidRoot.name = OPEN_CASCADE_SOLID_ROOT
    const profileRoot = new Group()
    profileRoot.name = OPEN_CASCADE_PROFILE_ROOT
    const lightRoot = makeOpenCascadeLightRoot()

    scene.add(solidRoot, profileRoot, lightRoot)
    applyOpenCascadeSceneStyle(
      scene,
      solidRoot,
      profileRoot,
      sceneStyleRef.current,
      highlightEdgesRef.current
    )
    sceneInfra.renderFrame()

    return () => {
      disposeOpenCascadeModelRoot(solidRoot)
      disposeOpenCascadeModelRoot(profileRoot)
      scene.remove(solidRoot, profileRoot, lightRoot)
      sceneInfra.renderFrame()
    }
  }, [kclManager.sceneInfra])

  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    sceneInfra.camControls.engineCameraProjection = cameraProjection
    sceneInfra.renderFrame()
  }, [cameraProjection, kclManager.sceneInfra])

  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    const scene = sceneInfra.scene
    const solidRoot = scene.getObjectByName(OPEN_CASCADE_SOLID_ROOT)
    const profileRoot = scene.getObjectByName(OPEN_CASCADE_PROFILE_ROOT)
    if (solidRoot instanceof Group || profileRoot instanceof Group) {
      applyOpenCascadeSceneStyle(
        scene,
        solidRoot instanceof Group ? solidRoot : undefined,
        profileRoot instanceof Group ? profileRoot : undefined,
        sceneStyle,
        highlightEdges
      )
      sceneInfra.renderFrame()
    }
  }, [highlightEdges, kclManager.sceneInfra, sceneStyle])

  useEffect(() => {
    const profileRoot = kclManager.sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_PROFILE_ROOT
    )
    if (profileRoot) {
      profileRoot.visible = passiveProfilesVisible
      kclManager.sceneInfra.renderFrame()
    }
  }, [kclManager.sceneInfra, passiveProfilesVisible])

  useEffect(() => {
    return addOpenCascadeCameraControlListener((command) => {
      const sceneInfra = kclManager.sceneInfra
      const camera = sceneInfra.camControls.camera
      targetRef.current.copy(sceneInfra.camControls.target)
      applyOpenCascadeCameraCommand(
        command,
        camera,
        targetRef.current,
        modelRadiusRef.current
      )
      sceneInfra.camControls.target.copy(targetRef.current)
      sceneInfra.camControls.onCameraChange()
      sceneInfra.renderFrame()
    })
  }, [kclManager.sceneInfra])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined

    async function loadLatestShape() {
      const sceneInfra = kclManager.sceneInfra
      const modelRoot = sceneInfra.scene.getObjectByName(
        OPEN_CASCADE_SOLID_ROOT
      )
      if (!(modelRoot instanceof Group)) {
        return
      }

      setReady(false)
      setStage('export')
      disposeOpenCascadeModelRoot(modelRoot)
      const bytes = await engineCommandManager.exportLatestOpenCascadeGlbBytes()
      if (cancelled) {
        return
      }
      if (bytes.length === 0) {
        setStage('empty')
        sceneInfra.renderFrame()
        return
      }

      objectUrl = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: 'model/gltf-binary' })
      )
      setStage('load')
      const gltf = await new GLTFLoader().loadAsync(objectUrl)
      if (cancelled) {
        return
      }

      disposeOpenCascadeModelRoot(modelRoot)
      styleLoadedOpenCascadeMeshes(
        gltf.scene,
        sceneStyleRef.current,
        highlightEdgesRef.current
      )
      modelRoot.add(gltf.scene)
      const radius = centerObject(gltf.scene)
      modelRadiusRef.current = radius
      targetRef.current.copy(sceneInfra.camControls.target)
      if (!hasFramedModelRef.current) {
        fitCameraToRadius(
          sceneInfra.camControls.camera,
          targetRef.current,
          radius,
          true
        )
        sceneInfra.camControls.target.copy(targetRef.current)
        hasFramedModelRef.current = true
      } else {
        updateCameraClipping(
          sceneInfra.camControls.camera,
          targetRef.current,
          radius
        )
      }
      sceneInfra.camControls.onCameraChange()
      sceneInfra.renderFrame()
      setStage('ready')
      setReady(true)
    }

    loadLatestShape().catch((error) => {
      if (!cancelled) {
        setStage(
          error instanceof Error ? `error: ${error.message}` : 'error: unknown'
        )
      }
      console.warn(error)
    })

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [engineCommandManager, kclManager.sceneInfra, latestShapeVersion])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined

    async function loadLatestProfile() {
      const sceneInfra = kclManager.sceneInfra
      const profileRoot = sceneInfra.scene.getObjectByName(
        OPEN_CASCADE_PROFILE_ROOT
      )
      if (!(profileRoot instanceof Group)) {
        return
      }

      disposeOpenCascadeModelRoot(profileRoot)
      const bytes =
        await engineCommandManager.exportLatestOpenCascadeProfileGlbBytes()
      if (cancelled) {
        return
      }
      if (bytes.length === 0) {
        sceneInfra.renderFrame()
        return
      }

      objectUrl = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: 'model/gltf-binary' })
      )
      const gltf = await new GLTFLoader().loadAsync(objectUrl)
      if (cancelled) {
        return
      }

      disposeOpenCascadeModelRoot(profileRoot)
      styleLoadedOpenCascadeMeshes(
        gltf.scene,
        sceneStyleRef.current,
        false,
        true
      )
      profileRoot.add(gltf.scene)
      profileRoot.visible = passiveProfilesVisible
      sceneInfra.renderFrame()
    }

    loadLatestProfile().catch((error) => {
      console.warn(error)
    })

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [
    engineCommandManager,
    kclManager.sceneInfra,
    latestProfileVersion,
    passiveProfilesVisible,
  ])

  return (
    <div
      data-testid="open-cascade-scene"
      data-stage={stage}
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <div
        data-testid="open-cascade-scene-ready"
        data-ready={ready ? 'true' : 'false'}
        data-stage={stage}
        data-diagnostic={exportError || ''}
        className="sr-only"
      />
      {exportError && (
        <div className="pointer-events-auto absolute left-3 top-3 max-w-[32rem] rounded border border-destroy-40 bg-chalkboard-10/90 px-3 py-2 text-xs text-destroy-80 shadow-sm dark:bg-chalkboard-100/90 dark:text-destroy-30">
          {exportError}
        </div>
      )}
    </div>
  )
}

function makeOpenCascadeLightRoot() {
  const lightRoot = new Group()
  lightRoot.name = OPEN_CASCADE_LIGHT_ROOT
  const key = new DirectionalLight('#ffffff', 2.8)
  key.position.set(5, -6, 8)
  const fill = new DirectionalLight('#c8d7ff', 1.0)
  fill.position.set(-5, 4, 5)
  lightRoot.add(key, fill)
  return lightRoot
}

function getOpenCascadeSceneStyle(
  resolvedTheme: ResolvedTheme
): OpenCascadeSceneStyle {
  return {
    backgroundColor: getThemeColorForThreeJs(resolvedTheme),
    edgeColor: getThemeColorForThreeJs(getOppositeTheme(resolvedTheme)),
    surfaceColor: resolvedTheme === Themes.Dark ? '#6f87ad' : '#8ea6c9',
    profileColor: resolvedTheme === Themes.Dark ? '#96d8bd' : '#2c8065',
  }
}

function applyOpenCascadeSceneStyle(
  scene: Scene,
  modelRoot: Group | undefined,
  profileRoot: Group | undefined,
  style: OpenCascadeSceneStyle,
  highlightEdges: boolean
) {
  scene.background = new Color(style.backgroundColor)

  if (modelRoot) {
    modelRoot.traverse((object) => {
      if (object instanceof Mesh) {
        updateOpenCascadeMeshMaterial(object, style.surfaceColor, 0.58, 0.04)
        return
      }

      updateEdgeLineStyle(object, style.edgeColor, highlightEdges)
    })
  }

  if (profileRoot) {
    profileRoot.traverse((object) => {
      if (object instanceof Mesh) {
        updateOpenCascadeMeshMaterial(object, style.profileColor, 0.78, 0)
        return
      }

      updateEdgeLineStyle(object, style.edgeColor, false)
    })
  }
}

function styleLoadedOpenCascadeMeshes(
  root: Group,
  style: OpenCascadeSceneStyle,
  highlightEdges: boolean,
  isProfile = false
) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return
    }

    updateOpenCascadeMeshMaterial(
      object,
      isProfile ? style.profileColor : style.surfaceColor,
      isProfile ? 0.78 : 0.58,
      isProfile ? 0 : 0.04
    )
    object.castShadow = false
    object.receiveShadow = false

    const edgeGeometry = new EdgesGeometry(object.geometry, 30)
    const edgeMaterial = new LineBasicMaterial({ color: style.edgeColor })
    const edgeLines = new LineSegments(edgeGeometry, edgeMaterial)
    edgeLines.name = OPEN_CASCADE_EDGE_LINES_NAME
    edgeLines.userData.openCascadeEdgeLines = true
    edgeLines.visible = !isProfile && highlightEdges
    object.add(edgeLines)
  })
}

function updateEdgeLineStyle(object: unknown, color: number, visible: boolean) {
  if (
    object instanceof LineSegments &&
    object.userData.openCascadeEdgeLines === true
  ) {
    object.visible = visible
    if (object.material instanceof LineBasicMaterial) {
      object.material.color.set(color)
    }
  }
}

function updateOpenCascadeMeshMaterial(
  mesh: Mesh,
  color: string,
  roughness: number,
  metalness: number
) {
  disposeMaterial(mesh.material)
  mesh.material = new MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent: true,
    opacity: 0.96,
  })
}

function disposeOpenCascadeModelRoot(modelRoot: Group) {
  modelRoot.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose()
      disposeMaterial(object.material)
      return
    }

    if (
      object instanceof LineSegments &&
      object.userData.openCascadeEdgeLines === true
    ) {
      object.geometry.dispose()
      disposeMaterial(object.material)
    }
  })
  modelRoot.clear()
}

function disposeMaterial(material: Mesh['material']) {
  if (isArray(material)) {
    material.forEach((entry) => entry.dispose())
    return
  }

  material.dispose()
}

function centerObject(object: Group) {
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) {
    return 5
  }

  const center = new Vector3()
  const size = new Vector3()
  box.getCenter(center)
  box.getSize(size)
  object.position.sub(center)

  return Math.max(size.x, size.y, size.z, 1)
}

function fitCameraToRadius(
  camera: OpenCascadeCamera,
  target: Vector3,
  radius: number,
  useDefaultDirection = false
) {
  const direction = useDefaultDirection
    ? new Vector3(1.15, -1.65, 1.05).normalize()
    : camera.position.clone().sub(target).normalize()
  if (direction.lengthSq() === 0) {
    direction.set(1.15, -1.65, 1.05).normalize()
  }

  camera.position.copy(target).add(direction.multiplyScalar(radius * 2.4))
  updateCameraClipping(camera, target, radius)
  if (camera instanceof OrthographicCamera) {
    camera.zoom = orthographicZoomToFit(camera, radius)
  }
  if (useDefaultDirection) {
    camera.up.set(0, 0, 1)
  } else if (
    Math.abs(direction.clone().normalize().dot(camera.up.clone().normalize())) >
    0.98
  ) {
    camera.up.set(0, 1, 0)
  }
  camera.lookAt(target)
  camera.updateProjectionMatrix()
}

function updateCameraClipping(
  camera: OpenCascadeCamera,
  target: Vector3,
  radius: number
) {
  const distance = camera.position.distanceTo(target)
  camera.near = Math.max(0.01, Math.min(radius / 100, distance / 100))
  camera.far = Math.max(radius * 40, distance + radius * 4, 1000)
  camera.updateProjectionMatrix()
}

function orthographicZoomToFit(camera: OrthographicCamera, radius: number) {
  const paddedSize = Math.max(radius * 1.35, 0.01)
  const viewWidth = Math.abs(camera.right - camera.left)
  const viewHeight = Math.abs(camera.top - camera.bottom)
  return Math.max(0.01, Math.min(viewWidth, viewHeight) / paddedSize)
}

function applyOpenCascadeCameraCommand(
  command: OpenCascadeCameraControlCommand,
  camera: OpenCascadeCamera,
  target: Vector3,
  radius: number
) {
  if (command.type === 'zoom_to_fit') {
    fitCameraToRadius(camera, target, radius)
    return
  }
  if (command.type === 'view_isometric') {
    fitCameraToRadius(camera, target, radius, true)
    return
  }

  setCameraToAxis(command.axis, camera, target, radius)
}

function setCameraToAxis(
  axis: CameraAxisName,
  camera: OpenCascadeCamera,
  target: Vector3,
  radius: number
) {
  const direction = axisToDirection(axis)
  const distance = Math.max(camera.position.distanceTo(target), radius * 2.4)
  camera.position.copy(target).add(direction.multiplyScalar(distance))
  camera.up.copy(
    axis === 'z' || axis === '-z' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
  )
  camera.lookAt(target)
  camera.updateProjectionMatrix()
}

function axisToDirection(axis: CameraAxisName) {
  switch (axis) {
    case 'x':
      return new Vector3(1, 0, 0)
    case '-x':
      return new Vector3(-1, 0, 0)
    case 'y':
      return new Vector3(0, 1, 0)
    case '-y':
      return new Vector3(0, -1, 0)
    case 'z':
      return new Vector3(0, 0, 1)
    case '-z':
      return new Vector3(0, 0, -1)
  }
}
