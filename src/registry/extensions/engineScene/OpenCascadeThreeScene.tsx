import { useSignals } from '@preact/signals-react/runtime'
import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import { useApp, useSingletons } from '@src/lib/boot'
import {
  type CameraAxisName,
  type OpenCascadeCameraControlCommand,
  addOpenCascadeCameraControlListener,
} from '@src/lib/cameraControls'
import {
  Themes,
  darkModeMatcher,
  getOppositeTheme,
  getResolvedTheme,
  getThemeColorForThreeJs,
} from '@src/lib/theme'
import { isArray } from '@src/lib/utils'
import { getSegmentColor } from '@src/machines/sketchSolve/segmentsUtils'
import type { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'
import type {
  OpenCascadeTopologyFaceGroup,
  OpenCascadeTopologyMeshes,
  OpenCascadeTopologySolidMesh,
} from '@src/network/openCascadeCommandManager'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BackSide,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  type Intersection,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  OrthographicCamera,
  type PerspectiveCamera,
  Quaternion,
  type Scene,
  SphereGeometry,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'

const OPEN_CASCADE_SOLID_ROOT = 'OPEN_CASCADE_SOLID_ROOT'
const OPEN_CASCADE_PROFILE_ROOT = 'OPEN_CASCADE_PROFILE_ROOT'
const OPEN_CASCADE_LIGHT_ROOT = 'OPEN_CASCADE_LIGHT_ROOT'
const OPEN_CASCADE_PICK_ROOT = 'OPEN_CASCADE_PICK_ROOT'
const OPEN_CASCADE_HIGHLIGHT_ROOT = 'OPEN_CASCADE_HIGHLIGHT_ROOT'
const OPEN_CASCADE_GUIDE_ROOT = 'OPEN_CASCADE_GUIDE_ROOT'
const OPEN_CASCADE_EDGE_LINES_NAME = 'open-cascade-edge-lines'
const OPEN_CASCADE_ORIGIN_ID = 'open-cascade-origin'
const OPEN_CASCADE_DEFAULT_PLANE_IDS = {
  xy: 'open-cascade-default-plane-xy',
  xz: 'open-cascade-default-plane-xz',
  yz: 'open-cascade-default-plane-yz',
} as const
export const OPEN_CASCADE_GUIDE_OBJECT_IDS = {
  origin: OPEN_CASCADE_ORIGIN_ID,
  ...OPEN_CASCADE_DEFAULT_PLANE_IDS,
} as const
const OPEN_CASCADE_GUIDE_PLANE_OFFSET_PX = 40
const OPEN_CASCADE_GUIDE_PLANE_SIZE_PX = 200
const OPEN_CASCADE_ORIGIN_RADIUS_PX = 6
const OPEN_CASCADE_ORIGIN_OUTLINE_RADIUS_PX = 8
const OPEN_CASCADE_HIGHLIGHT_POLYGON_OFFSET = -4

type OpenCascadeCamera = PerspectiveCamera | OrthographicCamera
type ResolvedTheme = Exclude<Themes, Themes.System>
type OpenCascadeGuideVisibilityKey = 'origin' | 'xy' | 'xz' | 'yz'

interface OpenCascadeSceneStyle {
  backgroundColor: number
  edgeColor: number
  surfaceColor: string
  profileColor: string
  selectionColor: number
  hoverColor: number
}

type OpenCascadeResolvedHit = OpenCascadeTopologyFaceGroup & {
  solidId: string
}

export function OpenCascadeThreeScene({ diagnostic }: { diagnostic?: string }) {
  useSignals()
  const { settings } = useApp()
  const { kclManager } = useSingletons()
  const { state, send } = useModelingContext()
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
  const modelCenterRef = useRef(new Vector3())
  const modelRadiusRef = useRef(5)
  const hasFramedModelRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [stage, setStage] = useState('waiting')
  const engineCommandManager =
    kclManager.engineCommandManager as EngineCommandManagerProxy
  const openCascadeManager = engineCommandManager.openCascadeCommandManager
  const latestShapeVersion = openCascadeManager.latestShapeVersion.value
  const latestProfileVersion = openCascadeManager.latestProfileVersion.value
  const latestTopologyVersion = openCascadeManager.latestTopologyVersion.value
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
    const pickRoot = new Group()
    pickRoot.name = OPEN_CASCADE_PICK_ROOT
    pickRoot.visible = true
    const highlightRoot = new Group()
    highlightRoot.name = OPEN_CASCADE_HIGHLIGHT_ROOT
    const guideRoot = makeOpenCascadeGuideRoot()
    const lightRoot = makeOpenCascadeLightRoot()

    scene.add(
      solidRoot,
      profileRoot,
      pickRoot,
      highlightRoot,
      guideRoot,
      lightRoot
    )
    updateOpenCascadeGuideScale(guideRoot, sceneInfra)
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
      disposeOpenCascadeModelRoot(pickRoot)
      disposeOpenCascadeModelRoot(highlightRoot)
      disposeOpenCascadeModelRoot(guideRoot)
      scene.remove(
        solidRoot,
        profileRoot,
        pickRoot,
        highlightRoot,
        guideRoot,
        lightRoot
      )
      sceneInfra.renderFrame()
    }
  }, [kclManager.sceneInfra])

  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    const guideRoot = sceneInfra.scene.getObjectByName(OPEN_CASCADE_GUIDE_ROOT)
    if (!(guideRoot instanceof Group)) {
      return
    }

    const updateGuides = () => {
      updateOpenCascadeGuideScale(guideRoot, sceneInfra)
      sceneInfra.renderFrame()
    }
    const unsubscribers = [
      sceneInfra.camControls.cameraChange.add(updateGuides),
      sceneInfra.baseUnitChange.add(updateGuides),
    ]
    updateGuides()
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }, [kclManager.sceneInfra])

  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    const guideRoot = sceneInfra.scene.getObjectByName(OPEN_CASCADE_GUIDE_ROOT)
    if (!(guideRoot instanceof Group)) {
      return
    }

    applyOpenCascadeGuideVisibility(
      guideRoot,
      state.context.defaultPlaneVisibility
    )
    sceneInfra.renderFrame()
  }, [kclManager.sceneInfra, state.context.defaultPlaneVisibility])

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
    const guideRoot = scene.getObjectByName(OPEN_CASCADE_GUIDE_ROOT)
    if (
      solidRoot instanceof Group ||
      profileRoot instanceof Group ||
      guideRoot instanceof Group
    ) {
      applyOpenCascadeSceneStyle(
        scene,
        solidRoot instanceof Group ? solidRoot : undefined,
        profileRoot instanceof Group ? profileRoot : undefined,
        sceneStyle,
        highlightEdges
      )
      if (guideRoot instanceof Group) {
        applyOpenCascadeGuideTheme(guideRoot, resolvedTheme)
      }
      sceneInfra.renderFrame()
    }
  }, [highlightEdges, kclManager.sceneInfra, resolvedTheme, sceneStyle])

  useEffect(() => {
    const profileRoot = kclManager.sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_PROFILE_ROOT
    )
    const pickRoot = kclManager.sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_PICK_ROOT
    )
    if (profileRoot) {
      profileRoot.visible = passiveProfilesVisible
    }
    if (pickRoot) {
      pickRoot.visible = passiveProfilesVisible
    }
    kclManager.sceneInfra.renderFrame()
  }, [kclManager.sceneInfra, passiveProfilesVisible])

  useEffect(() => {
    return addOpenCascadeCameraControlListener((command) => {
      const sceneInfra = kclManager.sceneInfra
      const camera = sceneInfra.camControls.camera
      targetRef.current.copy(sceneInfra.camControls.target)
      if (command.type === 'zoom_to_fit' || command.type === 'view_isometric') {
        targetRef.current.copy(modelCenterRef.current)
      }
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: latestShapeVersion is a signal value that intentionally reloads GLB content.
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
      const bounds = getOpenCascadeObjectBounds(gltf.scene)
      modelCenterRef.current.copy(bounds.center)
      const radius = bounds.radius
      modelRadiusRef.current = radius
      if (!hasFramedModelRef.current) {
        targetRef.current.copy(bounds.center)
        fitCameraToRadius(
          sceneInfra.camControls.camera,
          targetRef.current,
          radius,
          true
        )
        sceneInfra.camControls.target.copy(targetRef.current)
        hasFramedModelRef.current = true
      } else {
        targetRef.current.copy(sceneInfra.camControls.target)
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: latestTopologyVersion is a signal value that intentionally rebuilds pick buffers.
  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    const pickRoot = sceneInfra.scene.getObjectByName(OPEN_CASCADE_PICK_ROOT)
    const highlightRoot = sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_HIGHLIGHT_ROOT
    )
    if (!(pickRoot instanceof Group) || !(highlightRoot instanceof Group)) {
      return
    }

    const topologyMeshes =
      engineCommandManager.exportLatestOpenCascadeTopologyMeshes()
    rebuildOpenCascadePickRoot(pickRoot, topologyMeshes)
    sceneInfra.renderFrame()
  }, [engineCommandManager, kclManager.sceneInfra, latestTopologyVersion])

  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    const highlightRoot = sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_HIGHLIGHT_ROOT
    )
    if (!(highlightRoot instanceof Group)) {
      return
    }

    rebuildOpenCascadeHighlightRoot(
      highlightRoot,
      engineCommandManager.exportLatestOpenCascadeTopologyMeshes(),
      selectedOpenCascadeTopologyIds(state.context.selectionRanges),
      undefined,
      sceneStyle
    )
    sceneInfra.renderFrame()
  }, [
    engineCommandManager,
    kclManager.sceneInfra,
    sceneStyle,
    state.context.selectionRanges,
  ])

  useEffect(() => {
    if (!passiveProfilesVisible) {
      return
    }

    const sceneInfra = kclManager.sceneInfra
    const scene = sceneInfra.scene
    let hoveredTopologyId: string | undefined

    const updateHighlight = (hoveredId?: string) => {
      const highlightRoot = scene.getObjectByName(OPEN_CASCADE_HIGHLIGHT_ROOT)
      if (!(highlightRoot instanceof Group)) {
        return
      }
      rebuildOpenCascadeHighlightRoot(
        highlightRoot,
        engineCommandManager.exportLatestOpenCascadeTopologyMeshes(),
        selectedOpenCascadeTopologyIds(state.context.selectionRanges),
        hoveredId,
        sceneStyleRef.current
      )
      sceneInfra.renderFrame()
    }

    sceneInfra.setCallbacks({
      onMouseDownSelection: () => {
        const hit = resolveOpenCascadeTopologyHit(sceneInfra.raycastRing(0, 1))
        return Boolean(hit)
      },
      onMove: ({ intersects }) => {
        const hit = resolveOpenCascadeTopologyHit(intersects)
        if (hoveredTopologyId === hit?.topologyId) {
          return
        }
        hoveredTopologyId = hit?.topologyId
        updateHighlight(hoveredTopologyId)
      },
      onClick: ({ intersects }) => {
        if (sceneInfra.camControls.wasDragging) {
          return
        }
        const hit = resolveOpenCascadeTopologyHit(intersects)
        if (!hit) {
          hoveredTopologyId = undefined
          updateHighlight(undefined)
          send({
            type: 'Set selection',
            data: { selectionType: 'singleCodeCursor' },
          })
          return
        }
        const artifact = kclManager.artifactGraph.get(hit.artifactId)
        const codeRef = artifact
          ? getCodeRefsByArtifactId(
              hit.artifactId,
              kclManager.artifactGraph
            )?.[0]
          : undefined
        if (artifact && codeRef) {
          send({
            type: 'Set selection',
            data: {
              selectionType: 'singleCodeCursor',
              selection: {
                artifact,
                codeRef,
                engineEntityId: hit.topologyId,
              },
            },
          })
          return
        }

        send({
          type: 'Set selection',
          data: {
            selectionType: 'enginePrimitiveSelection',
            selection: {
              type: 'enginePrimitive',
              entityId: hit.topologyId,
              parentEntityId: hit.solidId,
              primitiveIndex: 0,
              primitiveType: hit.kind,
            },
          },
        })
      },
    })

    return () => {
      sceneInfra.resetMouseListeners()
    }
  }, [
    engineCommandManager,
    kclManager.artifactGraph,
    kclManager.sceneInfra,
    passiveProfilesVisible,
    send,
    state.context.selectionRanges,
  ])

  // biome-ignore lint/correctness/useExhaustiveDependencies: latestProfileVersion is a signal value that intentionally reloads profile content.
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

export function makeOpenCascadeGuideRoot() {
  const guideRoot = new Group()
  guideRoot.name = OPEN_CASCADE_GUIDE_ROOT
  guideRoot.add(
    makeOpenCascadeOriginGuide(),
    makeOpenCascadePlaneGuide({
      key: 'xy',
      label: 'XY',
      color: '#d74a54',
      xAxis: new Vector3(1, 0, 0),
      yAxis: new Vector3(0, 1, 0),
    }),
    makeOpenCascadePlaneGuide({
      key: 'xz',
      label: 'XZ',
      color: '#4778d6',
      xAxis: new Vector3(1, 0, 0),
      yAxis: new Vector3(0, 0, 1),
    }),
    makeOpenCascadePlaneGuide({
      key: 'yz',
      label: 'YZ',
      color: '#38a169',
      xAxis: new Vector3(0, 1, 0),
      yAxis: new Vector3(0, 0, 1),
    })
  )
  return guideRoot
}

function makeOpenCascadeOriginGuide() {
  const group = new Group()
  group.name = OPEN_CASCADE_ORIGIN_ID
  group.userData.openCascadeGuideId = OPEN_CASCADE_ORIGIN_ID
  group.userData.openCascadeGuideVisibilityKey = 'origin'
  group.userData.openCascadeFixedScreenScale = true

  const outline = new Mesh(
    new SphereGeometry(OPEN_CASCADE_ORIGIN_OUTLINE_RADIUS_PX, 24, 12),
    new MeshBasicMaterial({
      color: '#141414',
      depthTest: false,
      depthWrite: false,
      side: BackSide,
    })
  )
  outline.name = `${OPEN_CASCADE_ORIGIN_ID}-outline`
  outline.userData.openCascadeOriginMaterial = 'outline'
  outline.renderOrder = 49
  group.add(outline)

  const sphere = new Mesh(
    new SphereGeometry(OPEN_CASCADE_ORIGIN_RADIUS_PX, 24, 12),
    new MeshBasicMaterial({
      color: '#f5f0e8',
      depthTest: false,
      depthWrite: false,
    })
  )
  sphere.name = `${OPEN_CASCADE_ORIGIN_ID}-fill`
  sphere.userData.openCascadeOriginMaterial = 'fill'
  sphere.renderOrder = 50
  group.add(sphere)

  return group
}

export function applyOpenCascadeGuideTheme(
  guideRoot: Group,
  resolvedTheme: ResolvedTheme
) {
  const outlineColor = resolvedTheme === Themes.Dark ? '#f5f0e8' : '#141414'
  const fillColor = resolvedTheme === Themes.Dark ? '#141414' : '#f5f0e8'
  guideRoot.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return
    }
    if (!(object.material instanceof MeshBasicMaterial)) {
      return
    }
    if (object.userData.openCascadeOriginMaterial === 'outline') {
      object.material.color.set(outlineColor)
      return
    }
    if (object.userData.openCascadeOriginMaterial === 'fill') {
      object.material.color.set(fillColor)
    }
  })
}

function makeOpenCascadePlaneGuide({
  key,
  label,
  color,
  xAxis,
  yAxis,
}: {
  key: keyof typeof OPEN_CASCADE_DEFAULT_PLANE_IDS
  label: string
  color: string
  xAxis: Vector3
  yAxis: Vector3
}) {
  const group = new Group()
  const id = OPEN_CASCADE_DEFAULT_PLANE_IDS[key]
  group.name = id
  group.userData.openCascadeGuideId = id
  group.userData.openCascadeGuideVisibilityKey = key
  group.userData.openCascadeFixedScreenScale = true
  group.quaternion.copy(quaternionFromPlaneAxes(xAxis, yAxis))

  const offset = OPEN_CASCADE_GUIDE_PLANE_OFFSET_PX
  const end = offset + OPEN_CASCADE_GUIDE_PLANE_SIZE_PX
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [offset, offset, 0, end, offset, 0, end, end, 0, offset, end, 0],
      3
    )
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.setAttribute(
    'uv',
    new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)
  )
  geometry.computeVertexNormals()

  const material = new MeshBasicMaterial({
    map: makeOpenCascadePlaneGuideTexture(label, color),
    transparent: true,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  })
  const plane = new Mesh(geometry, material)
  plane.renderOrder = 40
  group.add(plane)

  return group
}

function makeOpenCascadePlaneGuideTexture(label: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = withAlpha(color, 0.18)
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = withAlpha(color, 0.72)
    ctx.lineWidth = 8
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8)

    ctx.font = '700 112px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.lineWidth = 12
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.strokeText(label, canvas.width - 36, 30)
    ctx.fillStyle = color
    ctx.fillText(label, canvas.width - 36, 30)
  }

  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function withAlpha(hexColor: string, alpha: number) {
  const color = new Color(hexColor)
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(
    color.g * 255
  )}, ${Math.round(color.b * 255)}, ${alpha})`
}

function quaternionFromPlaneAxes(xAxis: Vector3, yAxis: Vector3) {
  const normalizedX = xAxis.clone().normalize()
  const normalizedY = yAxis.clone().normalize()
  const normalizedZ = normalizedX.clone().cross(normalizedY).normalize()
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(normalizedX, normalizedY, normalizedZ)
  )
}

export function updateOpenCascadeGuideScale(
  guideRoot: Group,
  sceneInfra: {
    getClientSceneScaleFactor(target?: Mesh | Group | null): number
  }
) {
  guideRoot.traverse((object) => {
    if (
      !(object instanceof Group) ||
      object.userData.openCascadeFixedScreenScale !== true
    ) {
      return
    }
    const scale = sceneInfra.getClientSceneScaleFactor(object)
    object.scale.setScalar(scale)
  })
}

export function applyOpenCascadeGuideVisibility(
  guideRoot: Group,
  visibility: Partial<Record<OpenCascadeGuideVisibilityKey, boolean>>
) {
  guideRoot.traverse((object) => {
    const key = object.userData
      .openCascadeGuideVisibilityKey as OpenCascadeGuideVisibilityKey
    if (!key) {
      return
    }
    object.visible = visibility[key] ?? true
  })
}

function rebuildOpenCascadePickRoot(
  pickRoot: Group,
  topologyMeshes: OpenCascadeTopologyMeshes
) {
  disposeOpenCascadeModelRoot(pickRoot)
  for (const solid of topologyMeshes.solids) {
    if (solid.positions.length === 0 || solid.indices.length === 0) {
      continue
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(solid.positions, 3)
    )
    geometry.setIndex(solid.indices)
    for (const group of solid.groups) {
      geometry.addGroup(group.start, group.count, 0)
    }
    geometry.computeBoundingSphere()
    geometry.computeVertexNormals()

    const material = new MeshBasicMaterial({
      side: DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    material.colorWrite = false

    const mesh = new Mesh(geometry, material)
    mesh.name = `${OPEN_CASCADE_PICK_ROOT}:${solid.solidId}`
    mesh.userData.openCascadePickMesh = true
    mesh.userData.openCascadeTopologySolid = solid
    mesh.layers.set(SKETCH_LAYER)
    pickRoot.add(mesh)
  }
}

function rebuildOpenCascadeHighlightRoot(
  highlightRoot: Group,
  topologyMeshes: OpenCascadeTopologyMeshes,
  selectedTopologyIds: Set<string>,
  hoveredTopologyId: string | undefined,
  style: OpenCascadeSceneStyle
) {
  disposeOpenCascadeModelRoot(highlightRoot)
  for (const solid of topologyMeshes.solids) {
    const highlightedGroups = solid.groups.filter(
      (group) =>
        group.topologyId === hoveredTopologyId ||
        selectedTopologyIds.has(group.topologyId) ||
        selectedTopologyIds.has(group.artifactId)
    )
    for (const group of highlightedGroups) {
      const geometry = geometryForTopologyGroup(solid, group)
      if (!geometry) {
        continue
      }
      const isSelected =
        selectedTopologyIds.has(group.topologyId) ||
        selectedTopologyIds.has(group.artifactId)
      const material = new MeshBasicMaterial({
        color: isSelected ? style.selectionColor : style.hoverColor,
        transparent: true,
        opacity: isSelected ? 0.42 : 0.28,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: OPEN_CASCADE_HIGHLIGHT_POLYGON_OFFSET,
        polygonOffsetUnits: OPEN_CASCADE_HIGHLIGHT_POLYGON_OFFSET,
        side: DoubleSide,
      })
      const mesh = new Mesh(geometry, material)
      mesh.name = `${OPEN_CASCADE_HIGHLIGHT_ROOT}:${group.topologyId}`
      mesh.renderOrder = 20
      highlightRoot.add(mesh)
    }
  }
}

function geometryForTopologyGroup(
  solid: OpenCascadeTopologySolidMesh,
  group: OpenCascadeTopologyFaceGroup
) {
  if (group.count <= 0) {
    return undefined
  }

  const positions: number[] = []
  for (let index = group.start; index < group.start + group.count; index += 1) {
    const vertexIndex = solid.indices[index] * 3
    positions.push(
      solid.positions[vertexIndex],
      solid.positions[vertexIndex + 1],
      solid.positions[vertexIndex + 2]
    )
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function resolveOpenCascadeTopologyHit(
  intersects: Intersection[]
): OpenCascadeResolvedHit | undefined {
  for (const intersection of intersects) {
    const mesh = findOpenCascadePickMesh(intersection.object)
    if (!mesh || intersection.faceIndex == null) {
      continue
    }
    const solid = mesh.userData.openCascadeTopologySolid as
      | OpenCascadeTopologySolidMesh
      | undefined
    if (!solid) {
      continue
    }
    const indexStart = intersection.faceIndex * 3
    const group = solid.groups.find(
      (candidate) =>
        indexStart >= candidate.start &&
        indexStart < candidate.start + candidate.count
    )
    if (group) {
      return { ...group, solidId: solid.solidId }
    }
  }
  return undefined
}

function findOpenCascadePickMesh(object: unknown): Mesh | undefined {
  let current = object instanceof Mesh ? object : undefined
  while (current) {
    if (current.userData.openCascadePickMesh === true) {
      return current
    }
    current = current.parent instanceof Mesh ? current.parent : undefined
  }
  return undefined
}

function selectedOpenCascadeTopologyIds(selectionRanges: {
  graphSelections: {
    artifact?: { id: string }
    engineEntityId?: string
  }[]
  otherSelections: unknown[]
}) {
  const ids = new Set<string>()
  for (const selection of selectionRanges.graphSelections) {
    if (selection.engineEntityId) {
      ids.add(selection.engineEntityId)
    }
    if (selection.artifact?.id) {
      ids.add(selection.artifact.id)
    }
  }
  for (const selection of selectionRanges.otherSelections) {
    if (
      selection &&
      typeof selection === 'object' &&
      'type' in selection &&
      selection.type === 'enginePrimitive' &&
      'entityId' in selection &&
      typeof selection.entityId === 'string'
    ) {
      ids.add(selection.entityId)
    }
  }
  return ids
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
    selectionColor: getSegmentColor({
      isSelected: true,
      theme: resolvedTheme,
    }),
    hoverColor: getSegmentColor({
      isHovered: true,
      theme: resolvedTheme,
    }),
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
    for (const entry of material) {
      disposeMaterial(entry)
    }
    return
  }

  const texturedMaterial = material as MeshBasicMaterial | MeshStandardMaterial
  texturedMaterial.map?.dispose()
  material.dispose()
}

export function getOpenCascadeObjectBounds(object: Object3D) {
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) {
    return { center: new Vector3(), radius: 5 }
  }

  const center = new Vector3()
  const size = new Vector3()
  box.getCenter(center)
  box.getSize(size)

  return { center, radius: Math.max(size.x, size.y, size.z, 1) }
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
