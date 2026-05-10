import { useSignals } from '@preact/signals-react/runtime'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import {
  getCodeRefsByArtifactId,
  getSketchBlockForArtifact,
  getSketchBlockForPathArtifact,
} from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import {
  type CameraAxisName,
  type OpenCascadeCameraControlCommand,
  addOpenCascadeCameraControlListener,
  btnName,
} from '@src/lib/cameraControls'
import type { DefaultPlaneStr } from '@src/lib/planes'
import {
  openCascadeTopologyFaceToSketchPlane,
  selectDefaultSketchPlane,
  selectOffsetSketchPlane,
  selectionBodyFace,
} from '@src/lib/selections'
import {
  Themes,
  darkModeMatcher,
  getOppositeTheme,
  getResolvedTheme,
  getThemeColorForThreeJs,
} from '@src/lib/theme'
import { isArray } from '@src/lib/utils'
import { getSegmentColor } from '@src/machines/sketchSolve/segmentsUtils'
import type {
  NonCodeSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'
import {
  type SelectionBoxVisualState,
  removeSelectionBox,
  updateSelectionBox,
} from '@src/machines/sketchSolve/tools/moveTool/areaSelectUtils'
import type { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'
import type {
  OpenCascadeSketchLineMeshes,
  OpenCascadeSketchLineSegment,
  OpenCascadePlaneMesh,
  OpenCascadePlaneMeshes,
  OpenCascadeTopologyEdgeLine,
  OpenCascadeRegionFaceGroup,
  OpenCascadeRegionMeshes,
  OpenCascadeRegionMesh,
  OpenCascadeTopologyFaceGroup,
  OpenCascadeTopologyMeshes,
  OpenCascadeTopologySolidMesh,
  OpenCascadeEntityProvenance,
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
  Object3D,
  OrthographicCamera,
  type PerspectiveCamera,
  Quaternion,
  type Scene,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  type OpenCascadeAreaSelectionGeometry,
  isOpenCascadeAreaSelectionMatch,
  openCascadeAreaSelectionBox,
} from './openCascadeAreaSelect'

const OPEN_CASCADE_SOLID_ROOT = 'OPEN_CASCADE_SOLID_ROOT'
const OPEN_CASCADE_PREVIEW_ROOT = 'OPEN_CASCADE_PREVIEW_ROOT'
const OPEN_CASCADE_PROFILE_ROOT = 'OPEN_CASCADE_PROFILE_ROOT'
const OPEN_CASCADE_LIGHT_ROOT = 'OPEN_CASCADE_LIGHT_ROOT'
const OPEN_CASCADE_PICK_ROOT = 'OPEN_CASCADE_PICK_ROOT'
const OPEN_CASCADE_REGION_PICK_ROOT = 'OPEN_CASCADE_REGION_PICK_ROOT'
const OPEN_CASCADE_HIGHLIGHT_ROOT = 'OPEN_CASCADE_HIGHLIGHT_ROOT'
const OPEN_CASCADE_SKETCH_LINE_ROOT = 'OPEN_CASCADE_SKETCH_LINE_ROOT'
const OPEN_CASCADE_EDGE_CANDIDATE_ROOT = 'OPEN_CASCADE_EDGE_CANDIDATE_ROOT'
const OPEN_CASCADE_SELECTED_EDGE_ROOT = 'OPEN_CASCADE_SELECTED_EDGE_ROOT'
const OPEN_CASCADE_GUIDE_ROOT = 'OPEN_CASCADE_GUIDE_ROOT'
const OPEN_CASCADE_OFFSET_PLANE_ROOT = 'OPEN_CASCADE_OFFSET_PLANE_ROOT'
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
const OPEN_CASCADE_OFFSET_PLANE_SIZE_PX = 200
const OPEN_CASCADE_HIGHLIGHT_POLYGON_OFFSET = -4
const OPEN_CASCADE_SKETCH_LINE_PICK_RADIUS_PX = 8
const OPEN_CASCADE_SELECTED_EDGE_WIDTH_PX = 5
const OPEN_CASCADE_EMPTY_SCENE_RADIUS_BASE_UNITS = 10
const OPEN_CASCADE_MIN_CAMERA_NEAR_BASE_UNITS = 0.001

type OpenCascadeCamera = PerspectiveCamera | OrthographicCamera
type ResolvedTheme = Exclude<Themes, Themes.System>
type OpenCascadeGuideVisibilityKey = 'origin' | 'xy' | 'xz' | 'yz'

interface OpenCascadeSceneStyle {
  backgroundColor: number
  edgeColor: number
  surfaceColor: string
  profileColor: string
  sketchLineColor: number
  selectionColor: number
  hoverColor: number
}

export type OpenCascadeResolvedTopologyHit = OpenCascadeTopologyFaceGroup & {
  hitType: 'topology'
  solidId: string
  faceIndex: number
}

export type OpenCascadeResolvedEdgeHit = OpenCascadeTopologyEdgeLine & {
  hitType: 'edge'
  solidId: string
  parentFaceId?: string
}

export type OpenCascadeResolvedSketchLineHit = OpenCascadeSketchLineSegment & {
  hitType: 'sketchLine'
}

export type OpenCascadeResolvedRegionHit = OpenCascadeRegionFaceGroup & {
  hitType: 'region'
}

export type OpenCascadeResolvedDefaultPlaneHit = {
  hitType: 'defaultPlane'
  planeKey: 'xy' | 'xz' | 'yz'
  plane: DefaultPlaneStr
}

export type OpenCascadeResolvedOffsetPlaneHit = {
  hitType: 'offsetPlane'
  planeId: string
}

export type OpenCascadeResolvedBodyHit = {
  hitType: 'body'
  solidId: string
  artifactId: string
  artifactIds: string[]
}

export type OpenCascadeResolvedHit =
  | OpenCascadeResolvedTopologyHit
  | OpenCascadeResolvedEdgeHit
  | OpenCascadeResolvedSketchLineHit
  | OpenCascadeResolvedRegionHit
  | OpenCascadeResolvedDefaultPlaneHit
  | OpenCascadeResolvedOffsetPlaneHit
  | OpenCascadeResolvedBodyHit

type OpenCascadeAreaSelectionCandidate = {
  id: string
  hit: OpenCascadeResolvedHit
  geometry: OpenCascadeAreaSelectionGeometry
}

type OpenCascadeSelectionPayload = {
  id: string
  graphSelection?: Selection
  otherSelection?: NonCodeSelection
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
  const hasFramedEmptySceneRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [stage, setStage] = useState('waiting')
  const engineCommandManager =
    kclManager.engineCommandManager as EngineCommandManagerProxy
  const openCascadeManager = engineCommandManager.openCascadeCommandManager
  const latestShapeVersion = openCascadeManager.latestShapeVersion.value
  const latestProfileVersion = openCascadeManager.latestProfileVersion.value
  const latestTopologyVersion = openCascadeManager.latestTopologyVersion.value
  const latestSketchVersion = openCascadeManager.latestSketchVersion.value
  const latestRegionVersion = openCascadeManager.latestRegionVersion.value
  const latestPlaneVersion = openCascadeManager.latestPlaneVersion.value
  const latestVisibilityVersion =
    openCascadeManager.latestVisibilityVersion.value
  const latestPreviewVersion =
    engineCommandManager.latestOpenCascadePreviewVersion.value
  const activeSelectionFilter = openCascadeManager.latestSelectionFilter.value
  const objectSelectionOnly =
    activeSelectionFilter.includes('object') &&
    activeSelectionFilter.every((filter) => filter === 'object')
  const edgeSelectionOnly =
    activeSelectionFilter.includes('edge') &&
    activeSelectionFilter.every(
      (filter) => filter === 'edge' || filter === 'face'
    )
  const exportError = diagnostic || openCascadeManager.latestExportError.value
  const passiveProfilesVisible =
    !state.matches('Sketch') && !state.matches('sketchSolveMode')
  const useSketchSolveMode =
    state.context.store.useSketchSolveMode?.current === true
  const isExecuting = kclManager.isExecuting

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
    const previewRoot = new Group()
    previewRoot.name = OPEN_CASCADE_PREVIEW_ROOT
    const profileRoot = new Group()
    profileRoot.name = OPEN_CASCADE_PROFILE_ROOT
    const pickRoot = new Group()
    pickRoot.name = OPEN_CASCADE_PICK_ROOT
    pickRoot.visible = true
    const regionPickRoot = new Group()
    regionPickRoot.name = OPEN_CASCADE_REGION_PICK_ROOT
    regionPickRoot.visible = true
    const highlightRoot = new Group()
    highlightRoot.name = OPEN_CASCADE_HIGHLIGHT_ROOT
    const sketchLineRoot = new Group()
    sketchLineRoot.name = OPEN_CASCADE_SKETCH_LINE_ROOT
    const edgeCandidateRoot = new Group()
    edgeCandidateRoot.name = OPEN_CASCADE_EDGE_CANDIDATE_ROOT
    const selectedEdgeRoot = new Group()
    selectedEdgeRoot.name = OPEN_CASCADE_SELECTED_EDGE_ROOT
    const guideRoot = makeOpenCascadeGuideRoot()
    const offsetPlaneRoot = new Group()
    offsetPlaneRoot.name = OPEN_CASCADE_OFFSET_PLANE_ROOT
    const lightRoot = makeOpenCascadeLightRoot()

    scene.add(
      solidRoot,
      previewRoot,
      profileRoot,
      pickRoot,
      regionPickRoot,
      highlightRoot,
      sketchLineRoot,
      edgeCandidateRoot,
      selectedEdgeRoot,
      guideRoot,
      offsetPlaneRoot,
      lightRoot
    )
    updateOpenCascadeGuideScale(guideRoot, sceneInfra)
    updateOpenCascadeGuideScale(offsetPlaneRoot, sceneInfra)
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
      disposeOpenCascadeModelRoot(previewRoot)
      disposeOpenCascadeModelRoot(profileRoot)
      disposeOpenCascadeModelRoot(pickRoot)
      disposeOpenCascadeModelRoot(regionPickRoot)
      disposeOpenCascadeModelRoot(highlightRoot)
      disposeOpenCascadeModelRoot(sketchLineRoot)
      disposeOpenCascadeModelRoot(edgeCandidateRoot)
      disposeOpenCascadeModelRoot(selectedEdgeRoot)
      disposeOpenCascadeModelRoot(guideRoot)
      disposeOpenCascadeModelRoot(offsetPlaneRoot)
      scene.remove(
        solidRoot,
        previewRoot,
        profileRoot,
        pickRoot,
        regionPickRoot,
        highlightRoot,
        sketchLineRoot,
        edgeCandidateRoot,
        selectedEdgeRoot,
        guideRoot,
        offsetPlaneRoot,
        lightRoot
      )
      sceneInfra.renderFrame()
    }
  }, [kclManager.sceneInfra])

  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    const guideRoot = sceneInfra.scene.getObjectByName(OPEN_CASCADE_GUIDE_ROOT)
    const offsetPlaneRoot = sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_OFFSET_PLANE_ROOT
    )
    if (!(guideRoot instanceof Group) && !(offsetPlaneRoot instanceof Group)) {
      return
    }

    const updateGuides = () => {
      if (guideRoot instanceof Group) {
        updateOpenCascadeGuideScale(guideRoot, sceneInfra)
      }
      if (offsetPlaneRoot instanceof Group) {
        updateOpenCascadeGuideScale(offsetPlaneRoot, sceneInfra)
      }
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
    const updateClipping = () => {
      updateCameraClipping(
        sceneInfra.camControls.camera,
        sceneInfra.camControls.target,
        modelRadiusRef.current,
        sceneInfra.baseUnitMultiplier
      )
    }
    const unsubscribers = [
      sceneInfra.camControls.cameraChange.add(updateClipping),
      sceneInfra.baseUnitChange.add(updateClipping),
    ]
    updateClipping()
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
      resolveOpenCascadeGuideVisibility({
        visibility: state.context.defaultPlaneVisibility,
        defaultPlanes: kclManager.rustContext.defaultPlanes,
        isObjectHidden: (id) => openCascadeManager.isObjectHidden(id),
      })
    )
    sceneInfra.renderFrame()
  }, [
    kclManager.sceneInfra,
    kclManager.rustContext.defaultPlanes,
    latestVisibilityVersion,
    openCascadeManager,
    state.context.defaultPlaneVisibility,
  ])

  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    const guideRoot = sceneInfra.scene.getObjectByName(OPEN_CASCADE_GUIDE_ROOT)
    if (!(guideRoot instanceof Group)) {
      return
    }

    applyOpenCascadeGuideSelection(
      guideRoot,
      selectedOpenCascadeDefaultPlaneKeys(
        state.context.selectionRanges,
        kclManager.rustContext.defaultPlanes
      ),
      sceneStyle.selectionColor
    )
    sceneInfra.renderFrame()
  }, [
    kclManager.sceneInfra,
    kclManager.rustContext.defaultPlanes,
    sceneStyle.selectionColor,
    state.context.selectionRanges,
  ])

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
    const sketchLineRoot = scene.getObjectByName(OPEN_CASCADE_SKETCH_LINE_ROOT)
    const guideRoot = scene.getObjectByName(OPEN_CASCADE_GUIDE_ROOT)
    const offsetPlaneRoot = scene.getObjectByName(
      OPEN_CASCADE_OFFSET_PLANE_ROOT
    )
    if (
      solidRoot instanceof Group ||
      profileRoot instanceof Group ||
      sketchLineRoot instanceof Group ||
      guideRoot instanceof Group ||
      offsetPlaneRoot instanceof Group
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
      if (sketchLineRoot instanceof Group) {
        updateOpenCascadeSketchLineStyle(sketchLineRoot, sceneStyle)
      }
      if (offsetPlaneRoot instanceof Group) {
        updateOpenCascadeOffsetPlaneStyle(
          offsetPlaneRoot,
          selectedOpenCascadeEntityIds(state.context.selectionRanges),
          undefined,
          sceneStyle,
          resolvedTheme
        )
      }
      sceneInfra.renderFrame()
    }
  }, [
    highlightEdges,
    kclManager.sceneInfra,
    resolvedTheme,
    sceneStyle,
    state.context.selectionRanges,
  ])

  useEffect(() => {
    const profileRoot = kclManager.sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_PROFILE_ROOT
    )
    const pickRoot = kclManager.sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_PICK_ROOT
    )
    const regionPickRoot = kclManager.sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_REGION_PICK_ROOT
    )
    const sketchLineRoot = kclManager.sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_SKETCH_LINE_ROOT
    )
    const edgeCandidateRoot = kclManager.sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_EDGE_CANDIDATE_ROOT
    )
    const selectedEdgeRoot = kclManager.sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_SELECTED_EDGE_ROOT
    )
    const offsetPlaneRoot = kclManager.sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_OFFSET_PLANE_ROOT
    )
    if (profileRoot) {
      profileRoot.visible = passiveProfilesVisible
    }
    if (pickRoot) {
      pickRoot.visible = passiveProfilesVisible
    }
    if (regionPickRoot) {
      regionPickRoot.visible = passiveProfilesVisible
    }
    if (sketchLineRoot) {
      sketchLineRoot.visible = passiveProfilesVisible
    }
    if (edgeCandidateRoot) {
      edgeCandidateRoot.visible = passiveProfilesVisible
    }
    if (selectedEdgeRoot) {
      selectedEdgeRoot.visible = passiveProfilesVisible
    }
    if (offsetPlaneRoot) {
      offsetPlaneRoot.visible = passiveProfilesVisible
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
        modelRadiusRef.current,
        sceneInfra.baseUnitMultiplier
      )
      sceneInfra.camControls.target.copy(targetRef.current)
      sceneInfra.camControls.onCameraChange()
      sceneInfra.renderFrame()
    })
  }, [kclManager.sceneInfra])

  // biome-ignore lint/correctness/useExhaustiveDependencies: latestShapeVersion is a signal value that intentionally reloads GLB content.
  useEffect(() => {
    let cancelled = false
    let objectUrls: string[] = []

    async function loadLatestShape() {
      const sceneInfra = kclManager.sceneInfra
      if (isExecuting) {
        setStage('executing')
        return
      }
      const modelRoot = sceneInfra.scene.getObjectByName(
        OPEN_CASCADE_SOLID_ROOT
      )
      if (!(modelRoot instanceof Group)) {
        return
      }

      setReady(false)
      setStage('export')
      disposeOpenCascadeModelRoot(modelRoot)
      const visibleSolids =
        await engineCommandManager.exportVisibleOpenCascadeGlbBytes()
      if (cancelled) {
        return
      }
      if (visibleSolids.length === 0) {
        const sketchBounds = getOpenCascadeSketchLineBounds(
          engineCommandManager.exportLatestOpenCascadeSketchLineMeshes()
        )
        if (sketchBounds) {
          setStage('empty')
          sceneInfra.renderFrame()
          return
        }
        const bounds = getOpenCascadeEmptySceneBounds(
          sceneInfra.baseUnitMultiplier
        )
        modelCenterRef.current.copy(bounds.center)
        modelRadiusRef.current = bounds.radius
        updateCameraClipping(
          sceneInfra.camControls.camera,
          sceneInfra.camControls.target,
          bounds.radius,
          sceneInfra.baseUnitMultiplier
        )
        sceneInfra.camControls.onCameraChange()
        setStage('empty')
        sceneInfra.renderFrame()
        return
      }

      setStage('load')
      const loader = new GLTFLoader()
      const loadedSolids = await Promise.all(
        visibleSolids.map(async (solid) => {
          const objectUrl = URL.createObjectURL(
            new Blob([solid.bytes as BlobPart], { type: 'model/gltf-binary' })
          )
          objectUrls.push(objectUrl)
          const gltf = await loader.loadAsync(objectUrl)
          return {
            solidId: solid.solidId,
            artifactIds: solid.artifactIds,
            provenance: solid.provenance,
            scene: gltf.scene,
          }
        })
      )
      if (cancelled) return

      disposeOpenCascadeModelRoot(modelRoot)
      for (const solid of loadedSolids) {
        solid.scene.name = `${OPEN_CASCADE_SOLID_ROOT}:${solid.solidId}`
        tagOpenCascadeBodyVisuals(
          solid.scene,
          solid.solidId,
          solid.artifactIds,
          solid.provenance
        )
        styleLoadedOpenCascadeMeshes(
          solid.scene,
          sceneStyleRef.current,
          highlightEdgesRef.current
        )
        modelRoot.add(solid.scene)
      }
      const bounds =
        getOpenCascadeSceneContentBounds(sceneInfra.scene) ??
        getOpenCascadeObjectBounds(modelRoot)
      modelCenterRef.current.copy(bounds.center)
      const radius = bounds.radius
      modelRadiusRef.current = radius
      if (!hasFramedModelRef.current) {
        targetRef.current.copy(bounds.center)
        fitCameraToRadius(
          sceneInfra.camControls.camera,
          targetRef.current,
          radius,
          true,
          sceneInfra.baseUnitMultiplier
        )
        sceneInfra.camControls.target.copy(targetRef.current)
        hasFramedModelRef.current = true
        hasFramedEmptySceneRef.current = false
      } else {
        targetRef.current.copy(sceneInfra.camControls.target)
        updateCameraClipping(
          sceneInfra.camControls.camera,
          targetRef.current,
          radius,
          sceneInfra.baseUnitMultiplier
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
      for (const objectUrl of objectUrls) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [
    engineCommandManager,
    isExecuting,
    kclManager.sceneInfra,
    latestShapeVersion,
  ])

  // biome-ignore lint/correctness/useExhaustiveDependencies: latestPreviewVersion is a signal value that intentionally reloads preview GLB content.
  useEffect(() => {
    let cancelled = false
    let objectUrls: string[] = []

    async function loadLatestPreview() {
      const sceneInfra = kclManager.sceneInfra
      const previewRoot = sceneInfra.scene.getObjectByName(
        OPEN_CASCADE_PREVIEW_ROOT
      )
      if (!(previewRoot instanceof Group)) {
        return
      }

      const visibleSolids =
        await engineCommandManager.exportVisibleOpenCascadePreviewGlbBytes()
      if (cancelled) {
        return
      }

      disposeOpenCascadeModelRoot(previewRoot)
      if (visibleSolids.length === 0) {
        sceneInfra.renderFrame()
        return
      }

      const loader = new GLTFLoader()
      const loadedSolids = await Promise.all(
        visibleSolids.map(async (solid) => {
          const objectUrl = URL.createObjectURL(
            new Blob([solid.bytes as BlobPart], { type: 'model/gltf-binary' })
          )
          objectUrls.push(objectUrl)
          const gltf = await loader.loadAsync(objectUrl)
          return gltf.scene
        })
      )
      if (cancelled) {
        return
      }

      disposeOpenCascadeModelRoot(previewRoot)
      for (const scene of loadedSolids) {
        scene.name = `${OPEN_CASCADE_PREVIEW_ROOT}:body`
        styleLoadedOpenCascadePreviewMeshes(scene, sceneStyleRef.current)
        previewRoot.add(scene)
      }
      sceneInfra.renderFrame()
    }

    loadLatestPreview().catch((error) => console.warn(error))

    return () => {
      cancelled = true
      for (const objectUrl of objectUrls) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [engineCommandManager, kclManager.sceneInfra, latestPreviewVersion])

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: latestRegionVersion is a signal value that intentionally rebuilds region pick buffers.
  useEffect(() => {
    let cancelled = false
    const sceneInfra = kclManager.sceneInfra
    const regionPickRoot = sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_REGION_PICK_ROOT
    )
    if (!(regionPickRoot instanceof Group)) {
      return
    }

    engineCommandManager
      .exportLatestOpenCascadeRegionMeshes()
      .then((regionMeshes) => {
        if (cancelled) {
          return
        }
        rebuildOpenCascadeRegionPickRoot(regionPickRoot, regionMeshes)
        regionPickRoot.visible = passiveProfilesVisible
        if (
          !isExecuting &&
          !hasFramedModelRef.current &&
          openCascadeManager.getSolidCount() === 0
        ) {
          const bounds = getOpenCascadeSceneContentBounds(sceneInfra.scene)
          if (bounds) {
            frameOpenCascadeInitialBounds({
              bounds,
              sceneInfra,
              modelCenterRef,
              modelRadiusRef,
              targetRef,
              hasFramedModelRef,
              hasFramedEmptySceneRef,
            })
          }
        }
        sceneInfra.renderFrame()
      })
      .catch((error) => console.warn(error))

    return () => {
      cancelled = true
    }
  }, [
    engineCommandManager,
    isExecuting,
    kclManager.sceneInfra,
    latestRegionVersion,
    openCascadeManager,
    passiveProfilesVisible,
  ])

  useEffect(() => {
    let cancelled = false
    const sceneInfra = kclManager.sceneInfra
    const highlightRoot = sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_HIGHLIGHT_ROOT
    )
    const sketchLineRoot = sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_SKETCH_LINE_ROOT
    )
    const selectedEdgeRoot = sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_SELECTED_EDGE_ROOT
    )
    if (!(highlightRoot instanceof Group)) {
      return
    }

    const selectedIds = selectedOpenCascadeEntityIds(
      state.context.selectionRanges
    )
    engineCommandManager
      .exportLatestOpenCascadeRegionMeshes()
      .then((regionMeshes) => {
        if (cancelled) {
          return
        }
        rebuildOpenCascadeHighlightRoot(
          highlightRoot,
          engineCommandManager.exportLatestOpenCascadeTopologyMeshes(),
          selectedIds,
          undefined,
          sceneStyle,
          regionMeshes,
          undefined,
          undefined,
          sceneInfra.scene.getObjectByName(OPEN_CASCADE_SOLID_ROOT)
        )
        sceneInfra.renderFrame()
      })
      .catch((error) => console.warn(error))
    if (sketchLineRoot instanceof Group) {
      rebuildOpenCascadeSketchLineRoot(
        sketchLineRoot,
        engineCommandManager.exportLatestOpenCascadeSketchLineMeshes(),
        selectedIds,
        undefined,
        sceneStyle
      )
    }
    if (selectedEdgeRoot instanceof Group) {
      rebuildOpenCascadeSelectedEdgeRoot(
        selectedEdgeRoot,
        engineCommandManager.exportLatestOpenCascadeTopologyMeshes(),
        selectedIds,
        sceneStyle
      )
    }
    sceneInfra.renderFrame()
    return () => {
      cancelled = true
    }
  }, [
    engineCommandManager,
    kclManager.sceneInfra,
    latestTopologyVersion,
    sceneStyle,
    state.context.selectionRanges,
  ])

  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    if (isExecuting) {
      return
    }
    const sketchLineRoot = sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_SKETCH_LINE_ROOT
    )
    if (!(sketchLineRoot instanceof Group)) {
      return
    }

    const sketchLines =
      engineCommandManager.exportLatestOpenCascadeSketchLineMeshes()
    rebuildOpenCascadeSketchLineRoot(
      sketchLineRoot,
      sketchLines,
      selectedOpenCascadeEntityIds(state.context.selectionRanges),
      undefined,
      sceneStyle
    )
    sketchLineRoot.visible = passiveProfilesVisible
    const bounds = getOpenCascadeSketchLineBounds(sketchLines)
    if (
      bounds &&
      !hasFramedModelRef.current &&
      openCascadeManager.getSolidCount() === 0
    ) {
      frameOpenCascadeInitialBounds({
        bounds: getOpenCascadeSceneContentBounds(sceneInfra.scene) ?? bounds,
        sceneInfra,
        modelCenterRef,
        modelRadiusRef,
        targetRef,
        hasFramedModelRef,
        hasFramedEmptySceneRef,
      })
    } else if (
      !bounds &&
      !hasFramedModelRef.current &&
      !hasFramedEmptySceneRef.current
    ) {
      const emptyBounds = getOpenCascadeEmptySceneBounds(
        sceneInfra.baseUnitMultiplier
      )
      modelCenterRef.current.copy(emptyBounds.center)
      modelRadiusRef.current = emptyBounds.radius
      targetRef.current.copy(emptyBounds.center)
      fitCameraToRadius(
        sceneInfra.camControls.camera,
        targetRef.current,
        emptyBounds.radius,
        true,
        sceneInfra.baseUnitMultiplier
      )
      sceneInfra.camControls.target.copy(targetRef.current)
      sceneInfra.camControls.onCameraChange()
      hasFramedEmptySceneRef.current = true
    }
    sceneInfra.renderFrame()
  }, [
    engineCommandManager,
    isExecuting,
    kclManager.sceneInfra,
    latestSketchVersion,
    openCascadeManager,
    passiveProfilesVisible,
    sceneStyle,
    state.context.selectionRanges,
  ])

  useEffect(() => {
    const sceneInfra = kclManager.sceneInfra
    if (isExecuting) {
      return
    }
    const offsetPlaneRoot = sceneInfra.scene.getObjectByName(
      OPEN_CASCADE_OFFSET_PLANE_ROOT
    )
    if (!(offsetPlaneRoot instanceof Group)) {
      return
    }

    rebuildOpenCascadeOffsetPlaneRoot(
      offsetPlaneRoot,
      engineCommandManager.exportLatestOpenCascadePlaneMeshes(),
      selectedOpenCascadeEntityIds(state.context.selectionRanges),
      undefined,
      sceneStyle,
      resolvedTheme
    )
    offsetPlaneRoot.visible = passiveProfilesVisible
    updateOpenCascadeGuideScale(offsetPlaneRoot, sceneInfra)
    if (
      !hasFramedModelRef.current &&
      openCascadeManager.getSolidCount() === 0
    ) {
      const bounds = getOpenCascadeSceneContentBounds(sceneInfra.scene)
      if (bounds) {
        frameOpenCascadeInitialBounds({
          bounds,
          sceneInfra,
          modelCenterRef,
          modelRadiusRef,
          targetRef,
          hasFramedModelRef,
          hasFramedEmptySceneRef,
        })
      }
    }
    sceneInfra.renderFrame()
  }, [
    engineCommandManager,
    isExecuting,
    kclManager.sceneInfra,
    latestPlaneVersion,
    latestVisibilityVersion,
    openCascadeManager,
    passiveProfilesVisible,
    resolvedTheme,
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
    let hoveredEdgeId: string | undefined
    let hoveredEdgeCandidateFaceId: string | undefined
    let hoveredSketchSegmentId: string | undefined
    let hoveredRegionId: string | undefined
    let hoveredBodyId: string | undefined
    let hoveredOffsetPlaneId: string | undefined
    const areaSelectionPreviewIds = new Set<string>()
    const selectionBoxState = makeSelectionBoxVisualState()
    const isSelectingSketchPlane = state.matches('Sketch no face')
    const resolveHit = (intersects: Intersection[]) =>
      resolveOpenCascadeHit(intersects, {
        includeDefaultPlanes: true,
        preferDefaultPlanes: isSelectingSketchPlane,
        objectSelectionOnly,
      })

    const updateMouseVectorForEvent = (event: MouseEvent) => {
      const rect = sceneInfra.renderer.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        return
      }
      sceneInfra.currentMouseVector.x =
        ((event.clientX - rect.left) / rect.width) * 2 - 1
      sceneInfra.currentMouseVector.y =
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    }

    const sketchIdForSketchEditHit = (
      hit: OpenCascadeResolvedHit | undefined
    ) => {
      if (!hit) {
        return undefined
      }
      if (hit.hitType === 'sketchLine') {
        const artifact = kclManager.artifactGraph.get(hit.artifactId)
        return getSketchBlockForArtifact(artifact, kclManager.artifactGraph)?.id
      }
      if (hit.hitType === 'region') {
        const pathArtifact = hit.parentPathId
          ? kclManager.artifactGraph.get(hit.parentPathId)
          : undefined
        if (pathArtifact?.type === 'path') {
          return getSketchBlockForPathArtifact(
            pathArtifact,
            kclManager.artifactGraph
          )?.id
        }
        const artifact = kclManager.artifactGraph.get(hit.artifactId)
        return getSketchBlockForArtifact(artifact, kclManager.artifactGraph)?.id
      }
      return undefined
    }

    const onDoubleClick = (event: MouseEvent) => {
      if (
        sceneInfra.camControls.wasDragging ||
        !btnName(event).left ||
        state.matches('Sketch') ||
        state.matches('sketchSolveMode')
      ) {
        return
      }
      updateMouseVectorForEvent(event)
      const hit = resolveHit(sceneInfra.raycastRing(0, 1))
      const sketchId = sketchIdForSketchEditHit(hit)
      if (!sketchId) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      send({
        type: 'Edit sketch solve',
        data: { artifactId: sketchId },
      })
    }

    const updateHighlight = (hoveredHit?: OpenCascadeResolvedHit) => {
      const highlightRoot = scene.getObjectByName(OPEN_CASCADE_HIGHLIGHT_ROOT)
      if (!(highlightRoot instanceof Group)) {
        return
      }
      const sketchLineRoot = scene.getObjectByName(
        OPEN_CASCADE_SKETCH_LINE_ROOT
      )
      const selectedEdgeRoot = scene.getObjectByName(
        OPEN_CASCADE_SELECTED_EDGE_ROOT
      )
      const offsetPlaneRoot = scene.getObjectByName(
        OPEN_CASCADE_OFFSET_PLANE_ROOT
      )
      const selectedIds = selectedOpenCascadeEntityIds(
        state.context.selectionRanges
      )
      for (const id of areaSelectionPreviewIds) {
        selectedIds.add(id)
      }
      engineCommandManager
        .exportLatestOpenCascadeRegionMeshes()
        .then((regionMeshes) => {
          rebuildOpenCascadeHighlightRoot(
            highlightRoot,
            engineCommandManager.exportLatestOpenCascadeTopologyMeshes(),
            selectedIds,
            hoveredHit?.hitType === 'topology'
              ? hoveredHit.topologyId
              : undefined,
            sceneStyleRef.current,
            regionMeshes,
            hoveredHit?.hitType === 'region' ? hoveredHit.regionId : undefined,
            hoveredHit?.hitType === 'body' ? hoveredHit.solidId : undefined,
            scene.getObjectByName(OPEN_CASCADE_SOLID_ROOT)
          )
          sceneInfra.renderFrame()
        })
        .catch((error) => console.warn(error))
      if (sketchLineRoot instanceof Group) {
        rebuildOpenCascadeSketchLineRoot(
          sketchLineRoot,
          engineCommandManager.exportLatestOpenCascadeSketchLineMeshes(),
          selectedIds,
          hoveredHit?.hitType === 'sketchLine'
            ? hoveredHit.segmentId
            : undefined,
          sceneStyleRef.current
        )
      }
      if (selectedEdgeRoot instanceof Group) {
        rebuildOpenCascadeSelectedEdgeRoot(
          selectedEdgeRoot,
          engineCommandManager.exportLatestOpenCascadeTopologyMeshes(),
          selectedIds,
          sceneStyleRef.current
        )
      }
      if (offsetPlaneRoot instanceof Group) {
        updateOpenCascadeOffsetPlaneStyle(
          offsetPlaneRoot,
          selectedIds,
          hoveredHit?.hitType === 'offsetPlane'
            ? hoveredHit.planeId
            : undefined,
          sceneStyleRef.current,
          resolvedTheme
        )
      }
      sceneInfra.renderFrame()
    }

    const getAreaSelectionHits = async (
      startPoint: Vector3,
      currentPoint: Vector3
    ) => {
      const viewportSize = new Vector2(
        sceneInfra.renderer.domElement.clientWidth,
        sceneInfra.renderer.domElement.clientHeight
      )
      const box = openCascadeAreaSelectionBox({
        startPoint,
        currentPoint,
        camera: sceneInfra.camControls.camera,
        viewportSize,
      })
      const candidates = await buildOpenCascadeAreaSelectionCandidates({
        scene,
        topologyMeshes:
          engineCommandManager.exportLatestOpenCascadeTopologyMeshes(),
        regionMeshes:
          await engineCommandManager.exportLatestOpenCascadeRegionMeshes(),
        sketchLineMeshes:
          engineCommandManager.exportLatestOpenCascadeSketchLineMeshes(),
        objectSelectionOnly,
        edgeSelectionOnly,
      })
      return candidates.filter((candidate) =>
        isOpenCascadeAreaSelectionMatch({
          geometry: candidate.geometry,
          camera: sceneInfra.camControls.camera,
          viewportSize,
          boxMin: box.min,
          boxMax: box.max,
          mode: box.mode,
        })
      )
    }

    const updateAreaSelectionPreview = async (
      startPoint: Vector3,
      currentPoint: Vector3
    ) => {
      const hits = await getAreaSelectionHits(startPoint, currentPoint)
      areaSelectionPreviewIds.clear()
      for (const candidate of hits) {
        areaSelectionPreviewIds.add(candidate.id)
      }
      updateHighlight()
    }

    const completeAreaSelection = async (
      startPoint: Vector3,
      currentPoint: Vector3,
      event: MouseEvent
    ) => {
      const hits = await getAreaSelectionHits(startPoint, currentPoint)
      areaSelectionPreviewIds.clear()
      updateHighlight()

      if (hits.length === 0 && (event.shiftKey || kclManager.isShiftDown)) {
        return
      }

      const nextSelection = openCascadeSelectionsFromHits(
        hits.map((candidate) => candidate.hit),
        {
          artifactGraph: kclManager.artifactGraph,
          defaultPlanes: kclManager.rustContext.defaultPlanes,
          currentSelection: state.context.selectionRanges,
          append: event.shiftKey || kclManager.isShiftDown,
        }
      )
      send({
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: nextSelection,
        },
      })
    }

    const updateEdgeCandidates = (
      hoveredHit: OpenCascadeResolvedHit | undefined
    ) => {
      const edgeCandidateRoot = scene.getObjectByName(
        OPEN_CASCADE_EDGE_CANDIDATE_ROOT
      )
      if (!(edgeCandidateRoot instanceof Group)) {
        return
      }
      const faceId =
        hoveredHit?.hitType === 'topology'
          ? hoveredHit.topologyId
          : hoveredHit?.hitType === 'edge'
            ? hoveredHit.parentFaceId
            : undefined
      if (faceId === hoveredEdgeCandidateFaceId) {
        return
      }
      hoveredEdgeCandidateFaceId = faceId
      rebuildOpenCascadeEdgeCandidateRoot(
        edgeCandidateRoot,
        engineCommandManager.exportLatestOpenCascadeTopologyMeshes(),
        faceId,
        sceneStyleRef.current
      )
      sceneInfra.renderFrame()
    }

    const updateLinePickThreshold = () => {
      sceneInfra.raycaster.params.Line = {
        ...sceneInfra.raycaster.params.Line,
        threshold:
          sceneInfra.getClientSceneScaleFactor() *
          OPEN_CASCADE_SKETCH_LINE_PICK_RADIUS_PX,
      }
    }
    const previousLineThreshold = sceneInfra.raycaster.params.Line?.threshold
    updateLinePickThreshold()
    const unsubscribeLinePickThreshold = [
      sceneInfra.camControls.cameraChange.add(updateLinePickThreshold),
      sceneInfra.baseUnitChange.add(updateLinePickThreshold),
    ]

    sceneInfra.setCallbacks({
      onMouseDownSelection: () => {
        const hit = resolveHit(sceneInfra.raycastRing(0, 1))
        return Boolean(hit)
      },
      onMove: ({ intersects }) => {
        const hit = resolveHit(intersects)
        const nextTopologyId =
          hit?.hitType === 'topology' ? hit.topologyId : undefined
        const nextEdgeId = hit?.hitType === 'edge' ? hit.topologyId : undefined
        const nextSketchSegmentId =
          hit?.hitType === 'sketchLine' ? hit.segmentId : undefined
        const nextRegionId =
          hit?.hitType === 'region' ? hit.regionId : undefined
        const nextBodyId = hit?.hitType === 'body' ? hit.solidId : undefined
        const nextOffsetPlaneId =
          hit?.hitType === 'offsetPlane' ? hit.planeId : undefined
        if (
          hoveredTopologyId === nextTopologyId &&
          hoveredEdgeId === nextEdgeId &&
          hoveredSketchSegmentId === nextSketchSegmentId &&
          hoveredRegionId === nextRegionId &&
          hoveredBodyId === nextBodyId &&
          hoveredOffsetPlaneId === nextOffsetPlaneId
        ) {
          return
        }
        hoveredTopologyId = nextTopologyId
        hoveredEdgeId = nextEdgeId
        hoveredSketchSegmentId = nextSketchSegmentId
        hoveredRegionId = nextRegionId
        hoveredBodyId = nextBodyId
        hoveredOffsetPlaneId = nextOffsetPlaneId
        updateEdgeCandidates(hit)
        updateHighlight(hit)
      },
      onClick: ({ intersects }) => {
        if (sceneInfra.camControls.wasDragging) {
          return
        }
        const hit = resolveHit(intersects)
        if (!hit) {
          hoveredTopologyId = undefined
          hoveredEdgeId = undefined
          hoveredEdgeCandidateFaceId = undefined
          hoveredSketchSegmentId = undefined
          hoveredRegionId = undefined
          hoveredBodyId = undefined
          hoveredOffsetPlaneId = undefined
          const edgeCandidateRoot = scene.getObjectByName(
            OPEN_CASCADE_EDGE_CANDIDATE_ROOT
          )
          if (edgeCandidateRoot instanceof Group) {
            disposeOpenCascadeModelRoot(edgeCandidateRoot)
          }
          updateHighlight()
          send({
            type: 'Set selection',
            data: { selectionType: 'singleCodeCursor' },
          })
          return
        }
        if (isSelectingSketchPlane) {
          if (hit.hitType === 'defaultPlane') {
            const selection = openCascadeDefaultPlaneSelection(
              hit,
              kclManager.rustContext.defaultPlanes
            )
            if (!selection) {
              return
            }
            if (useSketchSolveMode) {
              send({
                type: 'Select sketch solve plane',
                data: selection.id,
              })
              return
            }
            selectDefaultSketchPlane(selection.id, {
              sceneInfra,
              rustContext: kclManager.rustContext,
            })
            return
          }
          if (hit.hitType === 'topology') {
            if (useSketchSolveMode) {
              send({
                type: 'Select sketch solve plane',
                data: hit.topologyId,
              })
              return
            }
            kclManager.wasmInstancePromise
              .then((wasmInstance) =>
                selectionBodyFace(
                  hit.topologyId,
                  kclManager.artifactGraph,
                  kclManager.ast,
                  kclManager.execState,
                  {
                    sceneInfra,
                    rustContext: kclManager.rustContext,
                    sceneEntitiesManager: kclManager.sceneEntitiesManager,
                    wasmInstance,
                  }
                )
              )
              .then((plane) => {
                if (plane) {
                  return plane
                }
                return openCascadeTopologyFaceToSketchPlane(
                  hit.topologyId,
                  engineCommandManager.exportLatestOpenCascadeTopologyMeshes(),
                  kclManager.artifactGraph,
                  {
                    sceneInfra,
                    sceneEntitiesManager: kclManager.sceneEntitiesManager,
                  }
                )
              })
              .then((plane) => {
                if (plane) send({ type: 'Select sketch plane', data: plane })
              })
              .catch((error) => console.warn(error))
            return
          }
          if (hit.hitType === 'offsetPlane') {
            if (useSketchSolveMode) {
              send({
                type: 'Select sketch solve plane',
                data: hit.planeId,
              })
              return
            }
            const artifact = kclManager.artifactGraph.get(hit.planeId)
            selectOffsetSketchPlane(artifact, {
              sceneInfra,
              sceneEntitiesManager: kclManager.sceneEntitiesManager,
            }).catch((error) => console.warn(error))
            return
          }
        }
        if (hit.hitType === 'region') {
          const pathArtifact = hit.parentPathId
            ? kclManager.artifactGraph.get(hit.parentPathId)
            : undefined
          const sketch =
            pathArtifact?.type === 'path'
              ? getSketchBlockForPathArtifact(
                  pathArtifact,
                  kclManager.artifactGraph
                )
              : undefined
          if (sketch) {
            send({
              type: 'Set selection',
              data: {
                selectionType: 'engineRegionSelection',
                selection: {
                  type: 'engineRegion',
                  id: hit.regionId,
                  point: hit.queryPoint,
                  sketchId: sketch.id,
                },
              },
            })
            return
          }
        }
        if (hit.hitType === 'defaultPlane') {
          const selection = openCascadeDefaultPlaneSelection(
            hit,
            kclManager.rustContext.defaultPlanes
          )
          if (selection) {
            send({
              type: 'Set selection',
              data: {
                selectionType: 'defaultPlaneSelection',
                selection,
              },
            })
          }
          return
        }
        const artifact = artifactForOpenCascadeHit(
          hit,
          kclManager.artifactGraph
        )
        const codeRef = artifact
          ? getCodeRefsByArtifactId(artifact.id, kclManager.artifactGraph)?.[0]
          : undefined
        const engineEntityId =
          hit.hitType === 'topology'
            ? hit.topologyId
            : hit.hitType === 'edge'
              ? hit.topologyId
              : hit.hitType === 'region'
                ? hit.regionId
                : hit.hitType === 'body'
                  ? hit.solidId
                  : hit.hitType === 'offsetPlane'
                    ? hit.planeId
                    : hit.segmentId
        if (artifact && codeRef) {
          send({
            type: 'Set selection',
            data: {
              selectionType: 'singleCodeCursor',
              selection: {
                artifact,
                codeRef,
                engineEntityId,
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
              entityId: engineEntityId,
              parentEntityId:
                hit.hitType === 'topology'
                  ? hit.solidId
                  : hit.hitType === 'edge'
                    ? hit.solidId
                    : hit.hitType === 'region'
                      ? hit.parentPathId
                      : hit.hitType === 'body'
                        ? hit.solidId
                        : hit.hitType === 'offsetPlane'
                          ? hit.planeId
                          : hit.pathId,
              primitiveIndex:
                hit.hitType === 'edge'
                  ? hit.edgeIndex
                  : hit.hitType === 'topology'
                    ? hit.faceIndex
                    : 0,
              primitiveType:
                hit.hitType === 'topology'
                  ? hit.kind
                  : hit.hitType === 'edge'
                    ? 'edge'
                    : hit.hitType === 'region'
                      ? 'face'
                      : hit.hitType === 'body'
                        ? 'object'
                        : hit.hitType === 'offsetPlane'
                          ? 'face'
                          : 'edge',
            },
          },
        })
      },
      onAreaSelectStart: ({ startPoint, currentPoint }) => {
        updateSelectionBox({
          startPoint3D: startPoint.threeD,
          currentPoint3D: currentPoint.threeD,
          sceneInfra,
          selectionBoxState,
        })
      },
      onAreaSelect: ({ startPoint, currentPoint }) => {
        updateSelectionBox({
          startPoint3D: startPoint.threeD,
          currentPoint3D: currentPoint.threeD,
          sceneInfra,
          selectionBoxState,
        })
        updateAreaSelectionPreview(
          startPoint.threeD,
          currentPoint.threeD
        ).catch((error) => console.warn(error))
      },
      onAreaSelectEnd: ({ startPoint, currentPoint, mouseEvent }) => {
        removeSelectionBox(selectionBoxState)
        completeAreaSelection(
          startPoint.threeD,
          currentPoint.threeD,
          mouseEvent
        ).catch((error) => console.warn(error))
      },
    })
    sceneInfra.renderer.domElement.addEventListener('dblclick', onDoubleClick)

    return () => {
      sceneInfra.renderer.domElement.removeEventListener(
        'dblclick',
        onDoubleClick
      )
      for (const unsubscribe of unsubscribeLinePickThreshold) {
        unsubscribe()
      }
      sceneInfra.raycaster.params.Line = {
        ...sceneInfra.raycaster.params.Line,
        threshold: previousLineThreshold,
      }
      removeSelectionBox(selectionBoxState)
      sceneInfra.resetMouseListeners()
    }
  }, [
    engineCommandManager,
    kclManager.artifactGraph,
    kclManager.sceneInfra,
    passiveProfilesVisible,
    resolvedTheme,
    send,
    state.value,
    state.context.selectionRanges,
    objectSelectionOnly,
    edgeSelectionOnly,
    useSketchSolveMode,
  ])

  // biome-ignore lint/correctness/useExhaustiveDependencies: latestProfileVersion is a signal value that intentionally reloads profile content.
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined

    async function loadLatestProfile() {
      const sceneInfra = kclManager.sceneInfra
      if (isExecuting) {
        return
      }
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
      if (
        !hasFramedModelRef.current &&
        openCascadeManager.getSolidCount() === 0
      ) {
        const bounds = getOpenCascadeSceneContentBounds(sceneInfra.scene)
        if (bounds) {
          frameOpenCascadeInitialBounds({
            bounds,
            sceneInfra,
            modelCenterRef,
            modelRadiusRef,
            targetRef,
            hasFramedModelRef,
            hasFramedEmptySceneRef,
          })
        }
      }
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
    isExecuting,
    kclManager.sceneInfra,
    latestProfileVersion,
    openCascadeManager,
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
  group.userData.openCascadeDefaultPlaneKey = key
  group.userData.openCascadeFixedScreenScale = true
  group.quaternion.copy(quaternionFromPlaneAxes(xAxis, yAxis))
  group.layers.set(SKETCH_LAYER)

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
  plane.userData.openCascadeDefaultPlaneKey = key
  plane.layers.set(SKETCH_LAYER)
  group.add(plane)

  const selection = new Mesh(
    geometry.clone(),
    new MeshBasicMaterial({
      color: 0,
      transparent: true,
      opacity: 0.38,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
  )
  selection.name = `${id}-selection`
  selection.renderOrder = 39
  selection.visible = false
  selection.userData.openCascadeDefaultPlaneKey = key
  selection.userData.openCascadeDefaultPlaneSelectionKey = key
  selection.layers.set(SKETCH_LAYER)
  group.add(selection)

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

function point3ToVector(point: { x: number; y: number; z: number }) {
  return new Vector3(point.x, point.y, point.z)
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

export function applyOpenCascadeGuideSelection(
  guideRoot: Group,
  selectedPlaneKeys: Set<'xy' | 'xz' | 'yz'>,
  selectionColor: number
) {
  guideRoot.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return
    }
    const key = object.userData.openCascadeDefaultPlaneSelectionKey as
      | 'xy'
      | 'xz'
      | 'yz'
      | undefined
    if (!key) {
      return
    }
    object.visible = selectedPlaneKeys.has(key)
    if (object.material instanceof MeshBasicMaterial) {
      object.material.color.set(selectionColor)
    }
  })
}

export function rebuildOpenCascadeOffsetPlaneRoot(
  offsetPlaneRoot: Group,
  planeMeshes: OpenCascadePlaneMeshes,
  selectedEntityIds: Set<string>,
  hoveredPlaneId: string | undefined,
  style: OpenCascadeSceneStyle,
  resolvedTheme: ResolvedTheme
) {
  disposeOpenCascadeModelRoot(offsetPlaneRoot)
  for (const plane of planeMeshes.planes) {
    offsetPlaneRoot.add(
      makeOpenCascadeOffsetPlane(plane, selectedEntityIds, hoveredPlaneId, {
        style,
        resolvedTheme,
      })
    )
  }
}

function makeOpenCascadeOffsetPlane(
  plane: OpenCascadePlaneMesh,
  selectedEntityIds: Set<string>,
  hoveredPlaneId: string | undefined,
  {
    style,
    resolvedTheme,
  }: { style: OpenCascadeSceneStyle; resolvedTheme: ResolvedTheme }
) {
  const group = new Group()
  group.name = `${OPEN_CASCADE_OFFSET_PLANE_ROOT}:${plane.planeId}`
  group.userData.openCascadeOffsetPlaneId = plane.planeId
  group.userData.openCascadeFixedScreenScale = true
  group.position.copy(point3ToVector(plane.origin))
  group.quaternion.copy(
    quaternionFromPlaneAxes(
      point3ToVector(plane.xAxis),
      point3ToVector(plane.yAxis)
    )
  )
  group.layers.set(SKETCH_LAYER)

  const halfSize = OPEN_CASCADE_OFFSET_PLANE_SIZE_PX / 2
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        -halfSize,
        -halfSize,
        0,
        halfSize,
        -halfSize,
        0,
        halfSize,
        halfSize,
        0,
        -halfSize,
        halfSize,
        0,
      ],
      3
    )
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()

  const isSelected = selectedEntityIds.has(plane.planeId)
  const isHovered = hoveredPlaneId === plane.planeId
  const material = new MeshBasicMaterial({
    color: isSelected
      ? style.selectionColor
      : isHovered
        ? style.hoverColor
        : offsetPlaneColorForTheme(resolvedTheme),
    transparent: true,
    opacity: isSelected ? 0.42 : isHovered ? 0.32 : 0.22,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = `${OPEN_CASCADE_OFFSET_PLANE_ROOT}:${plane.planeId}:face`
  mesh.renderOrder = isSelected || isHovered ? 31 : 11
  mesh.userData.openCascadeOffsetPlaneId = plane.planeId
  mesh.layers.set(SKETCH_LAYER)
  group.add(mesh)

  const edgeGeometry = new EdgesGeometry(geometry)
  const edgeMaterial = new LineBasicMaterial({
    color: offsetPlaneEdgeColorForTheme(resolvedTheme),
    transparent: true,
    opacity: isSelected || isHovered ? 0.82 : 0.46,
    depthTest: false,
    depthWrite: false,
  })
  const edges = new LineSegments(edgeGeometry, edgeMaterial)
  edges.name = `${OPEN_CASCADE_OFFSET_PLANE_ROOT}:${plane.planeId}:edge`
  edges.renderOrder = mesh.renderOrder + 1
  edges.userData.openCascadeOffsetPlaneId = plane.planeId
  edges.layers.set(SKETCH_LAYER)
  group.add(edges)

  return group
}

function updateOpenCascadeOffsetPlaneStyle(
  offsetPlaneRoot: Group,
  selectedEntityIds: Set<string>,
  hoveredPlaneId: string | undefined,
  style: OpenCascadeSceneStyle,
  resolvedTheme: ResolvedTheme
) {
  offsetPlaneRoot.traverse((object) => {
    const planeId = object.userData.openCascadeOffsetPlaneId as
      | string
      | undefined
    if (!planeId) {
      return
    }
    const isSelected = selectedEntityIds.has(planeId)
    const isHovered = hoveredPlaneId === planeId
    if (
      object instanceof Mesh &&
      object.material instanceof MeshBasicMaterial
    ) {
      object.material.color.set(
        isSelected
          ? style.selectionColor
          : isHovered
            ? style.hoverColor
            : offsetPlaneColorForTheme(resolvedTheme)
      )
      object.material.opacity = isSelected ? 0.42 : isHovered ? 0.32 : 0.22
      object.renderOrder = isSelected || isHovered ? 31 : 11
    }
    if (
      object instanceof LineSegments &&
      object.material instanceof LineBasicMaterial
    ) {
      object.material.color.set(offsetPlaneEdgeColorForTheme(resolvedTheme))
      object.material.opacity = isSelected || isHovered ? 0.82 : 0.46
      object.renderOrder = isSelected || isHovered ? 32 : 12
    }
  })
}

function offsetPlaneColorForTheme(resolvedTheme: ResolvedTheme) {
  return resolvedTheme === Themes.Dark ? 0xd1d5db : 0x777d86
}

function offsetPlaneEdgeColorForTheme(resolvedTheme: ResolvedTheme) {
  return resolvedTheme === Themes.Dark ? 0xf2f4f7 : 0x4b5563
}

export function resolveOpenCascadeGuideVisibility({
  visibility,
  defaultPlanes,
  isObjectHidden,
}: {
  visibility: Partial<Record<OpenCascadeGuideVisibilityKey, boolean>>
  defaultPlanes: DefaultPlanes | null
  isObjectHidden: (id: string) => boolean
}): Partial<Record<OpenCascadeGuideVisibilityKey, boolean>> {
  return {
    ...visibility,
    xy:
      (visibility.xy ?? true) &&
      (defaultPlanes ? !isObjectHidden(defaultPlanes.xy) : true),
    xz:
      (visibility.xz ?? true) &&
      (defaultPlanes ? !isObjectHidden(defaultPlanes.xz) : true),
    yz:
      (visibility.yz ?? true) &&
      (defaultPlanes ? !isObjectHidden(defaultPlanes.yz) : true),
  }
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

export function rebuildOpenCascadeRegionPickRoot(
  regionPickRoot: Group,
  regionMeshes: OpenCascadeRegionMeshes
) {
  disposeOpenCascadeModelRoot(regionPickRoot)
  for (const region of regionMeshes.regions) {
    if (region.positions.length === 0 || region.indices.length === 0) {
      continue
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(region.positions, 3)
    )
    geometry.setIndex(region.indices)
    for (const group of region.groups) {
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
    mesh.name = `${OPEN_CASCADE_REGION_PICK_ROOT}:${region.regionId}`
    mesh.userData.openCascadeRegionPickMesh = true
    mesh.userData.openCascadeRegionMesh = region
    mesh.layers.set(SKETCH_LAYER)
    regionPickRoot.add(mesh)
  }
}

export function rebuildOpenCascadeHighlightRoot(
  highlightRoot: Group,
  topologyMeshes: OpenCascadeTopologyMeshes,
  selectedTopologyIds: Set<string>,
  hoveredTopologyId: string | undefined,
  style: OpenCascadeSceneStyle,
  regionMeshes?: OpenCascadeRegionMeshes,
  hoveredRegionId?: string,
  hoveredBodyId?: string,
  modelRoot?: Object3D | null
) {
  disposeOpenCascadeModelRoot(highlightRoot)
  for (const solid of topologyMeshes.solids) {
    const highlightedGroups = solid.groups.filter(
      (group) =>
        solid.solidId === hoveredBodyId ||
        selectedTopologyIds.has(solid.solidId) ||
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
  if (modelRoot) {
    appendOpenCascadeBodyVisualHighlights(
      highlightRoot,
      modelRoot,
      selectedTopologyIds,
      hoveredBodyId,
      style
    )
  }
  if (!regionMeshes) {
    return
  }
  for (const region of regionMeshes.regions) {
    const highlightedGroups = region.groups.filter(
      (group) =>
        group.regionId === hoveredRegionId ||
        selectedTopologyIds.has(group.regionId) ||
        selectedTopologyIds.has(group.artifactId)
    )
    for (const group of highlightedGroups) {
      const geometry = geometryForRegionGroup(region, group)
      if (!geometry) {
        continue
      }
      const isSelected =
        selectedTopologyIds.has(group.regionId) ||
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
      mesh.name = `${OPEN_CASCADE_HIGHLIGHT_ROOT}:${group.regionId}`
      mesh.renderOrder = 21
      highlightRoot.add(mesh)
    }
  }
}

function appendOpenCascadeBodyVisualHighlights(
  highlightRoot: Group,
  modelRoot: Object3D,
  selectedIds: Set<string>,
  hoveredBodyId: string | undefined,
  style: OpenCascadeSceneStyle
) {
  modelRoot.updateWorldMatrix(true, true)
  modelRoot.traverse((object) => {
    if (
      !(object instanceof Mesh) ||
      object.userData.openCascadeBodyVisual !== true
    ) {
      return
    }
    const solidId = object.userData.openCascadeSolidId as string | undefined
    if (!solidId || (solidId !== hoveredBodyId && !selectedIds.has(solidId))) {
      return
    }

    const geometry = object.geometry.clone()
    geometry.applyMatrix4(object.matrixWorld)
    const isSelected = selectedIds.has(solidId)
    const material = new MeshBasicMaterial({
      color: isSelected ? style.selectionColor : style.hoverColor,
      transparent: true,
      opacity: isSelected ? 0.24 : 0.14,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: OPEN_CASCADE_HIGHLIGHT_POLYGON_OFFSET,
      polygonOffsetUnits: OPEN_CASCADE_HIGHLIGHT_POLYGON_OFFSET,
      side: DoubleSide,
    })
    const mesh = new Mesh(geometry, material)
    mesh.name = `${OPEN_CASCADE_HIGHLIGHT_ROOT}:body:${solidId}`
    mesh.renderOrder = 22
    highlightRoot.add(mesh)
  })
}

function rebuildOpenCascadeSketchLineRoot(
  sketchLineRoot: Group,
  sketchLines: OpenCascadeSketchLineMeshes,
  selectedEntityIds: Set<string>,
  hoveredSegmentId: string | undefined,
  style: OpenCascadeSceneStyle
) {
  disposeOpenCascadeModelRoot(sketchLineRoot)
  for (const segment of sketchLines.segments) {
    const geometry = geometryForSketchLineSegment(segment)
    if (!geometry) {
      continue
    }
    const isSelected =
      selectedEntityIds.has(segment.segmentId) ||
      selectedEntityIds.has(segment.artifactId)
    const isHovered = segment.segmentId === hoveredSegmentId
    const material = new LineBasicMaterial({
      color: isSelected
        ? style.selectionColor
        : isHovered
          ? style.hoverColor
          : style.sketchLineColor,
      transparent: true,
      opacity: isSelected || isHovered ? 1 : 0.82,
      depthTest: false,
      depthWrite: false,
    })
    const line = new LineSegments(geometry, material)
    line.name = `${OPEN_CASCADE_SKETCH_LINE_ROOT}:${segment.segmentId}`
    line.renderOrder = isSelected || isHovered ? 32 : 12
    line.userData.openCascadeSketchLine = true
    line.userData.openCascadeSketchLineSegment = segment
    line.layers.set(SKETCH_LAYER)
    sketchLineRoot.add(line)
  }
}

function updateOpenCascadeSketchLineStyle(
  sketchLineRoot: Group,
  style: OpenCascadeSceneStyle
) {
  sketchLineRoot.traverse((object) => {
    if (
      !(object instanceof LineSegments) ||
      object.userData.openCascadeSketchLine !== true ||
      !(object.material instanceof LineBasicMaterial)
    ) {
      return
    }
    object.material.color.set(style.sketchLineColor)
  })
}

function rebuildOpenCascadeEdgeCandidateRoot(
  edgeCandidateRoot: Group,
  topologyMeshes: OpenCascadeTopologyMeshes,
  faceId: string | undefined,
  style: OpenCascadeSceneStyle
) {
  disposeOpenCascadeModelRoot(edgeCandidateRoot)
  if (!faceId) {
    return
  }

  for (const solid of topologyMeshes.solids) {
    const edges = solid.edges.filter((edge) => edge.faceIds.includes(faceId))
    for (const edge of edges) {
      edgeCandidateRoot.add(
        makeOpenCascadeEdgeLine({
          solidId: solid.solidId,
          edge,
          parentFaceId: faceId,
          color: style.hoverColor,
          opacity: 0.95,
          renderOrder: 34,
          userDataKey: 'openCascadeEdgeCandidate',
        })
      )
    }
  }
}

function rebuildOpenCascadeSelectedEdgeRoot(
  selectedEdgeRoot: Group,
  topologyMeshes: OpenCascadeTopologyMeshes,
  selectedEntityIds: Set<string>,
  style: OpenCascadeSceneStyle
) {
  disposeOpenCascadeModelRoot(selectedEdgeRoot)
  for (const solid of topologyMeshes.solids) {
    for (const edge of solid.edges) {
      if (
        !selectedEntityIds.has(edge.topologyId) &&
        !selectedEntityIds.has(edge.artifactId)
      ) {
        continue
      }
      selectedEdgeRoot.add(
        makeOpenCascadeSelectedEdgeLine({
          solidId: solid.solidId,
          edge,
          parentFaceId: edge.faceIds[0],
          color: style.selectionColor,
          opacity: 1,
          renderOrder: 35,
          userDataKey: 'openCascadeSelectedEdge',
        })
      )
    }
  }
}

function makeOpenCascadeEdgeLine({
  solidId,
  edge,
  parentFaceId,
  color,
  opacity,
  renderOrder,
  userDataKey,
}: {
  solidId: string
  edge: OpenCascadeTopologyEdgeLine
  parentFaceId?: string
  color: number
  opacity: number
  renderOrder: number
  userDataKey: 'openCascadeEdgeCandidate' | 'openCascadeSelectedEdge'
}) {
  const geometry = geometryForTopologyEdge(edge)
  const material = new LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  })
  const line = new LineSegments(geometry, material)
  line.name = `${userDataKey}:${edge.topologyId}`
  line.renderOrder = renderOrder
  line.userData[userDataKey] = true
  line.userData.openCascadeTopologyEdge = edge
  line.userData.openCascadeSolidId = solidId
  line.userData.openCascadeParentFaceId = parentFaceId
  line.layers.set(SKETCH_LAYER)
  return line
}

function makeOpenCascadeSelectedEdgeLine({
  solidId,
  edge,
  parentFaceId,
  color,
  opacity,
  renderOrder,
  userDataKey,
}: {
  solidId: string
  edge: OpenCascadeTopologyEdgeLine
  parentFaceId?: string
  color: number
  opacity: number
  renderOrder: number
  userDataKey: 'openCascadeSelectedEdge'
}) {
  const geometry = selectedLineGeometryForTopologyEdge(edge)
  const material = new LineMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    linewidth: OPEN_CASCADE_SELECTED_EDGE_WIDTH_PX * window.devicePixelRatio,
    resolution: new Vector2(window.innerWidth, window.innerHeight),
    worldUnits: false,
  })
  const line = new Line2(geometry, material)
  line.name = `${userDataKey}:${edge.topologyId}`
  line.renderOrder = renderOrder
  line.userData[userDataKey] = true
  line.userData.openCascadeTopologyEdge = edge
  line.userData.openCascadeSolidId = solidId
  line.userData.openCascadeParentFaceId = parentFaceId
  line.layers.set(SKETCH_LAYER)
  return line
}

function geometryForTopologyEdge(edge: OpenCascadeTopologyEdgeLine) {
  const geometry = new BufferGeometry()
  const positions: number[] = []
  if (edge.points.length >= 6) {
    for (let index = 0; index <= edge.points.length - 6; index += 3) {
      positions.push(
        edge.points[index],
        edge.points[index + 1],
        edge.points[index + 2],
        edge.points[index + 3],
        edge.points[index + 4],
        edge.points[index + 5]
      )
    }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  return geometry
}

function selectedLineGeometryForTopologyEdge(
  edge: OpenCascadeTopologyEdgeLine
) {
  const geometry = new LineGeometry()
  geometry.setPositions(edge.points)
  return geometry
}

function geometryForSketchLineSegment(segment: OpenCascadeSketchLineSegment) {
  if (segment.points.length < 6) {
    return undefined
  }

  const positions: number[] = []
  for (let index = 0; index <= segment.points.length - 6; index += 3) {
    positions.push(
      segment.points[index],
      segment.points[index + 1],
      segment.points[index + 2],
      segment.points[index + 3],
      segment.points[index + 4],
      segment.points[index + 5]
    )
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  return geometry
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

function geometryForRegionGroup(
  region: OpenCascadeRegionMesh,
  group: OpenCascadeRegionFaceGroup
) {
  if (group.count <= 0) {
    return undefined
  }

  const positions: number[] = []
  for (let index = group.start; index < group.start + group.count; index += 1) {
    const vertexIndex = region.indices[index] * 3
    positions.push(
      region.positions[vertexIndex],
      region.positions[vertexIndex + 1],
      region.positions[vertexIndex + 2]
    )
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

export function resolveOpenCascadeHit(
  intersects: Intersection[],
  options: {
    includeDefaultPlanes?: boolean
    preferDefaultPlanes?: boolean
    objectSelectionOnly?: boolean
  } = {}
): OpenCascadeResolvedHit | undefined {
  if (options.includeDefaultPlanes && options.preferDefaultPlanes) {
    for (const intersection of intersects) {
      const defaultPlane = findOpenCascadeDefaultPlaneGuide(intersection.object)
      if (defaultPlane) {
        return defaultPlane
      }
    }
  }

  if (!options.objectSelectionOnly) {
    for (const intersection of intersects) {
      const edgeLine = findOpenCascadeEdgeCandidateLine(intersection.object)
      const edge = edgeLine?.userData.openCascadeTopologyEdge as
        | OpenCascadeTopologyEdgeLine
        | undefined
      const solidId = edgeLine?.userData.openCascadeSolidId as
        | string
        | undefined
      if (edge && solidId) {
        return {
          ...edge,
          hitType: 'edge',
          solidId,
          parentFaceId: edgeLine?.userData.openCascadeParentFaceId as
            | string
            | undefined,
        }
      }
    }
  }

  const defaultPlaneHits: OpenCascadeResolvedDefaultPlaneHit[] = []
  for (const intersection of intersects) {
    if (options.includeDefaultPlanes) {
      const defaultPlane = findOpenCascadeDefaultPlaneGuide(intersection.object)
      if (defaultPlane) {
        defaultPlaneHits.push(defaultPlane)
      }
    }

    const sketchLine = findOpenCascadeSketchLine(intersection.object)
    if (sketchLine) {
      const segment = sketchLine.userData.openCascadeSketchLineSegment as
        | OpenCascadeSketchLineSegment
        | undefined
      if (segment) {
        return { ...segment, hitType: 'sketchLine' }
      }
    }

    const regionMesh = findOpenCascadeRegionPickMesh(intersection.object)
    if (regionMesh && intersection.faceIndex != null) {
      const region = regionMesh.userData.openCascadeRegionMesh as
        | OpenCascadeRegionMesh
        | undefined
      if (region) {
        const indexStart = intersection.faceIndex * 3
        const group = region.groups.find(
          (candidate) =>
            indexStart >= candidate.start &&
            indexStart < candidate.start + candidate.count
        )
        if (group) {
          return { ...group, hitType: 'region' }
        }
      }
    }

    if (!options.objectSelectionOnly) {
      const offsetPlaneId = findOpenCascadeOffsetPlane(intersection.object)
      if (offsetPlaneId) {
        return {
          hitType: 'offsetPlane',
          planeId: offsetPlaneId,
        }
      }
    }

    const mesh = findOpenCascadePickMesh(intersection.object)
    if (!mesh || intersection.faceIndex == null) {
      if (options.objectSelectionOnly) {
        const body = findOpenCascadeBodyVisual(intersection.object)
        if (body) {
          const solidId = body.userData.openCascadeSolidId as string
          const artifactIds = (body.userData.openCascadeArtifactIds as
            | string[]
            | undefined) || [solidId]
          return {
            hitType: 'body',
            solidId,
            artifactId: artifactIds[0] || solidId,
            artifactIds,
          }
        }
      }
      continue
    }
    const solid = mesh.userData.openCascadeTopologySolid as
      | OpenCascadeTopologySolidMesh
      | undefined
    if (!solid) {
      continue
    }
    const indexStart = intersection.faceIndex * 3
    const groupIndex = solid.groups.findIndex(
      (candidate) =>
        indexStart >= candidate.start &&
        indexStart < candidate.start + candidate.count
    )
    const group = groupIndex >= 0 ? solid.groups[groupIndex] : undefined
    if (group) {
      if (options.objectSelectionOnly) {
        return {
          hitType: 'body',
          solidId: solid.solidId,
          artifactId: solid.artifactIds?.[0] || solid.solidId,
          artifactIds: solid.artifactIds || [solid.solidId],
        }
      }
      return {
        ...group,
        hitType: 'topology',
        solidId: solid.solidId,
        faceIndex: groupIndex,
      }
    }
  }
  if (defaultPlaneHits.length > 0) {
    return defaultPlaneHits[0]
  }
  return undefined
}

async function buildOpenCascadeAreaSelectionCandidates({
  scene,
  topologyMeshes,
  regionMeshes,
  sketchLineMeshes,
  objectSelectionOnly,
  edgeSelectionOnly,
}: {
  scene: Scene
  topologyMeshes: OpenCascadeTopologyMeshes
  regionMeshes: OpenCascadeRegionMeshes
  sketchLineMeshes: OpenCascadeSketchLineMeshes
  objectSelectionOnly: boolean
  edgeSelectionOnly: boolean
}): Promise<OpenCascadeAreaSelectionCandidate[]> {
  if (objectSelectionOnly) {
    return buildOpenCascadeBodyAreaSelectionCandidates(topologyMeshes)
  }
  if (edgeSelectionOnly) {
    return buildOpenCascadeEdgeAreaSelectionCandidates(topologyMeshes)
  }
  return [
    ...buildOpenCascadeTopologyAreaSelectionCandidates(topologyMeshes),
    ...buildOpenCascadeRegionAreaSelectionCandidates(regionMeshes),
    ...buildOpenCascadeSketchLineAreaSelectionCandidates(sketchLineMeshes),
    ...buildOpenCascadePlaneAreaSelectionCandidates(scene),
  ]
}

function buildOpenCascadeBodyAreaSelectionCandidates(
  topologyMeshes: OpenCascadeTopologyMeshes
): OpenCascadeAreaSelectionCandidate[] {
  return topologyMeshes.solids.map((solid) => ({
    id: solid.solidId,
    hit: {
      hitType: 'body',
      solidId: solid.solidId,
      artifactId: solid.artifactIds?.[0] || solid.solidId,
      artifactIds: solid.artifactIds || [solid.solidId],
    },
    geometry: {
      points: pointsFromFlatPositionArray(solid.positions),
      triangles: trianglesFromIndexedGeometry(
        solid.positions,
        solid.indices,
        0,
        solid.indices.length
      ),
    },
  }))
}

function buildOpenCascadeTopologyAreaSelectionCandidates(
  topologyMeshes: OpenCascadeTopologyMeshes
): OpenCascadeAreaSelectionCandidate[] {
  const candidates: OpenCascadeAreaSelectionCandidate[] = []
  for (const solid of topologyMeshes.solids) {
    solid.groups.forEach((group, faceIndex) => {
      candidates.push({
        id: group.topologyId,
        hit: {
          ...group,
          hitType: 'topology',
          solidId: solid.solidId,
          faceIndex,
        },
        geometry: {
          points: pointsFromIndexedGeometry(
            solid.positions,
            solid.indices,
            group.start,
            group.count
          ),
          triangles: trianglesFromIndexedGeometry(
            solid.positions,
            solid.indices,
            group.start,
            group.count
          ),
        },
      })
    })
  }
  return candidates
}

function buildOpenCascadeEdgeAreaSelectionCandidates(
  topologyMeshes: OpenCascadeTopologyMeshes
): OpenCascadeAreaSelectionCandidate[] {
  const candidates: OpenCascadeAreaSelectionCandidate[] = []
  for (const solid of topologyMeshes.solids) {
    for (const edge of solid.edges) {
      const points = pointsFromFlatPositionArray(edge.points)
      candidates.push({
        id: edge.topologyId,
        hit: {
          ...edge,
          hitType: 'edge',
          solidId: solid.solidId,
          parentFaceId: edge.faceIds[0],
        },
        geometry: {
          points,
          segments: contiguousSegments(points),
        },
      })
    }
  }
  return candidates
}

function buildOpenCascadeRegionAreaSelectionCandidates(
  regionMeshes: OpenCascadeRegionMeshes
): OpenCascadeAreaSelectionCandidate[] {
  const candidates: OpenCascadeAreaSelectionCandidate[] = []
  for (const region of regionMeshes.regions) {
    for (const group of region.groups) {
      candidates.push({
        id: group.regionId,
        hit: {
          ...group,
          hitType: 'region',
        },
        geometry: {
          points: pointsFromIndexedGeometry(
            region.positions,
            region.indices,
            group.start,
            group.count
          ),
          triangles: trianglesFromIndexedGeometry(
            region.positions,
            region.indices,
            group.start,
            group.count
          ),
        },
      })
    }
  }
  return candidates
}

function buildOpenCascadeSketchLineAreaSelectionCandidates(
  sketchLineMeshes: OpenCascadeSketchLineMeshes
): OpenCascadeAreaSelectionCandidate[] {
  return sketchLineMeshes.segments.map((segment) => {
    const points = pointsFromFlatPositionArray(segment.points)
    return {
      id: segment.segmentId,
      hit: {
        ...segment,
        hitType: 'sketchLine',
      },
      geometry: {
        points,
        segments: contiguousSegments(points),
      },
    }
  })
}

function buildOpenCascadePlaneAreaSelectionCandidates(scene: Scene) {
  const candidates: OpenCascadeAreaSelectionCandidate[] = []
  const seenDefaultPlanes = new Set<string>()
  const seenOffsetPlanes = new Set<string>()
  scene.traverse((object) => {
    const defaultPlane = findOpenCascadeDefaultPlaneGuide(object)
    if (defaultPlane && !seenDefaultPlanes.has(defaultPlane.planeKey)) {
      const geometry = geometryForObjectBounds(object)
      if (geometry) {
        candidates.push({
          id: defaultPlane.planeKey,
          hit: defaultPlane,
          geometry,
        })
        seenDefaultPlanes.add(defaultPlane.planeKey)
      }
      return
    }

    const offsetPlaneId = findOpenCascadeOffsetPlane(object)
    if (offsetPlaneId && !seenOffsetPlanes.has(offsetPlaneId)) {
      const geometry = geometryForObjectBounds(object)
      if (geometry) {
        candidates.push({
          id: offsetPlaneId,
          hit: {
            hitType: 'offsetPlane',
            planeId: offsetPlaneId,
          },
          geometry,
        })
        seenOffsetPlanes.add(offsetPlaneId)
      }
    }
  })
  return candidates
}

function pointsFromIndexedGeometry(
  positions: number[],
  indices: number[],
  start: number,
  count: number
) {
  const points: Vector3[] = []
  for (let index = start; index < start + count; index += 1) {
    points.push(pointFromFlatPositionArray(positions, indices[index]))
  }
  return points
}

function trianglesFromIndexedGeometry(
  positions: number[],
  indices: number[],
  start: number,
  count: number
) {
  const triangles: Array<[Vector3, Vector3, Vector3]> = []
  for (let index = start; index + 2 < start + count; index += 3) {
    triangles.push([
      pointFromFlatPositionArray(positions, indices[index]),
      pointFromFlatPositionArray(positions, indices[index + 1]),
      pointFromFlatPositionArray(positions, indices[index + 2]),
    ])
  }
  return triangles
}

function pointsFromFlatPositionArray(positions: number[]) {
  const points: Vector3[] = []
  for (let index = 0; index + 2 < positions.length; index += 3) {
    points.push(
      new Vector3(positions[index], positions[index + 1], positions[index + 2])
    )
  }
  return points
}

function pointFromFlatPositionArray(positions: number[], vertexIndex: number) {
  const offset = vertexIndex * 3
  return new Vector3(
    positions[offset] || 0,
    positions[offset + 1] || 0,
    positions[offset + 2] || 0
  )
}

function contiguousSegments(points: Vector3[]) {
  const segments: Array<[Vector3, Vector3]> = []
  for (let index = 1; index < points.length; index += 1) {
    segments.push([points[index - 1], points[index]])
  }
  return segments
}

function geometryForObjectBounds(
  object: Object3D
): OpenCascadeAreaSelectionGeometry | undefined {
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) {
    return undefined
  }
  const { min, max } = box
  const points = [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, max.z),
    new Vector3(min.x, max.y, max.z),
  ]
  return {
    points,
    segments: [
      [points[0], points[1]],
      [points[1], points[2]],
      [points[2], points[3]],
      [points[3], points[0]],
      [points[4], points[5]],
      [points[5], points[6]],
      [points[6], points[7]],
      [points[7], points[4]],
      [points[0], points[4]],
      [points[1], points[5]],
      [points[2], points[6]],
      [points[3], points[7]],
    ],
  }
}

function findOpenCascadeBodyVisual(object: unknown): Object3D | undefined {
  let current = object instanceof Object3D ? object : undefined
  while (current) {
    if (current.userData.openCascadeBodyVisual === true) {
      return current
    }
    current = current.parent || undefined
  }
  return undefined
}

function findOpenCascadeSketchLine(object: unknown): LineSegments | undefined {
  let current = object instanceof Object3D ? object : undefined
  while (current) {
    if (
      current instanceof LineSegments &&
      current.userData.openCascadeSketchLine === true
    ) {
      return current
    }
    current = current.parent || undefined
  }
  return undefined
}

function findOpenCascadeEdgeCandidateLine(
  object: unknown
): LineSegments | undefined {
  let current = object instanceof Object3D ? object : undefined
  while (current) {
    if (
      current instanceof LineSegments &&
      current.userData.openCascadeEdgeCandidate === true
    ) {
      return current
    }
    current = current.parent || undefined
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

function findOpenCascadeRegionPickMesh(object: unknown): Mesh | undefined {
  let current = object instanceof Mesh ? object : undefined
  while (current) {
    if (current.userData.openCascadeRegionPickMesh === true) {
      return current
    }
    current = current.parent instanceof Mesh ? current.parent : undefined
  }
  return undefined
}

function findOpenCascadeOffsetPlane(object: unknown): string | undefined {
  let current = object instanceof Object3D ? object : undefined
  while (current) {
    const planeId = current.userData.openCascadeOffsetPlaneId as
      | string
      | undefined
    if (planeId) {
      return planeId
    }
    current = current.parent || undefined
  }
  return undefined
}

function findOpenCascadeDefaultPlaneGuide(
  object: unknown
): OpenCascadeResolvedDefaultPlaneHit | undefined {
  let current = object instanceof Object3D ? object : undefined
  while (current) {
    const planeKey = current.userData.openCascadeDefaultPlaneKey as
      | 'xy'
      | 'xz'
      | 'yz'
      | undefined
    if (planeKey) {
      return {
        hitType: 'defaultPlane',
        planeKey,
        plane: planeKey.toUpperCase() as DefaultPlaneStr,
      }
    }
    current = current.parent || undefined
  }
  return undefined
}

export function openCascadeDefaultPlaneSelection(
  hit: OpenCascadeResolvedDefaultPlaneHit,
  defaultPlanes: DefaultPlanes | null
) {
  const id = defaultPlanes?.[hit.planeKey]
  if (!id) {
    return undefined
  }
  return {
    name: hit.plane,
    id,
  }
}

function openCascadeSelectionsFromHits(
  hits: OpenCascadeResolvedHit[],
  {
    artifactGraph,
    defaultPlanes,
    currentSelection,
    append,
  }: {
    artifactGraph: ArtifactGraph
    defaultPlanes: DefaultPlanes | null
    currentSelection: Selections
    append: boolean
  }
): Selections {
  const payloads = hits
    .map((hit) =>
      openCascadeSelectionPayloadForHit(hit, artifactGraph, defaultPlanes)
    )
    .filter((payload): payload is OpenCascadeSelectionPayload =>
      Boolean(payload)
    )

  const graphSelections = append ? [...currentSelection.graphSelections] : []
  const otherSelections = append ? [...currentSelection.otherSelections] : []
  const graphKeys = new Set(graphSelections.map(graphSelectionKey))
  const otherKeys = new Set(otherSelections.map(nonCodeSelectionKey))

  for (const payload of payloads) {
    if (payload.graphSelection) {
      const key = graphSelectionKey(payload.graphSelection)
      if (!graphKeys.has(key)) {
        graphSelections.push(payload.graphSelection)
        graphKeys.add(key)
      }
      continue
    }
    if (payload.otherSelection) {
      const key = nonCodeSelectionKey(payload.otherSelection)
      if (!otherKeys.has(key)) {
        otherSelections.push(payload.otherSelection)
        otherKeys.add(key)
      }
    }
  }

  return { graphSelections, otherSelections }
}

function openCascadeSelectionPayloadForHit(
  hit: OpenCascadeResolvedHit,
  artifactGraph: ArtifactGraph,
  defaultPlanes: DefaultPlanes | null
): OpenCascadeSelectionPayload | undefined {
  if (hit.hitType === 'defaultPlane') {
    const selection = openCascadeDefaultPlaneSelection(hit, defaultPlanes)
    return selection
      ? {
          id: selection.id,
          otherSelection: selection,
        }
      : undefined
  }

  if (hit.hitType === 'region') {
    const pathArtifact = hit.parentPathId
      ? artifactGraph.get(hit.parentPathId)
      : undefined
    const sketch =
      pathArtifact?.type === 'path'
        ? getSketchBlockForPathArtifact(pathArtifact, artifactGraph)
        : undefined
    if (sketch) {
      return {
        id: hit.regionId,
        otherSelection: {
          type: 'engineRegion',
          id: hit.regionId,
          point: hit.queryPoint,
          sketchId: sketch.id,
        },
      }
    }
  }

  const artifact = artifactForOpenCascadeHit(hit, artifactGraph)
  const codeRef = artifact
    ? getCodeRefsByArtifactId(artifact.id, artifactGraph)?.[0]
    : undefined
  const engineEntityId = engineEntityIdForOpenCascadeHit(hit)
  if (artifact && codeRef) {
    return {
      id: engineEntityId,
      graphSelection: {
        artifact,
        codeRef,
        engineEntityId,
      },
    }
  }

  return {
    id: engineEntityId,
    otherSelection: {
      type: 'enginePrimitive',
      entityId: engineEntityId,
      parentEntityId: parentEntityIdForOpenCascadeHit(hit),
      primitiveIndex: primitiveIndexForOpenCascadeHit(hit),
      primitiveType: primitiveTypeForOpenCascadeHit(hit),
    },
  }
}

function engineEntityIdForOpenCascadeHit(hit: OpenCascadeResolvedHit) {
  if (hit.hitType === 'topology') return hit.topologyId
  if (hit.hitType === 'edge') return hit.topologyId
  if (hit.hitType === 'region') return hit.regionId
  if (hit.hitType === 'body') return hit.solidId
  if (hit.hitType === 'offsetPlane') return hit.planeId
  if (hit.hitType === 'defaultPlane') return hit.planeKey
  return hit.segmentId
}

function parentEntityIdForOpenCascadeHit(hit: OpenCascadeResolvedHit) {
  if (hit.hitType === 'topology') return hit.solidId
  if (hit.hitType === 'edge') return hit.solidId
  if (hit.hitType === 'region') return hit.parentPathId
  if (hit.hitType === 'body') return hit.solidId
  if (hit.hitType === 'offsetPlane') return hit.planeId
  if (hit.hitType === 'defaultPlane') return hit.planeKey
  return hit.pathId
}

function primitiveIndexForOpenCascadeHit(hit: OpenCascadeResolvedHit) {
  if (hit.hitType === 'edge') return hit.edgeIndex
  if (hit.hitType === 'topology') return hit.faceIndex
  return 0
}

function primitiveTypeForOpenCascadeHit(hit: OpenCascadeResolvedHit) {
  if (hit.hitType === 'topology') return hit.kind
  if (hit.hitType === 'body') return 'object'
  if (hit.hitType === 'edge' || hit.hitType === 'sketchLine') return 'edge'
  return 'face'
}

function graphSelectionKey(selection: Selection) {
  return (
    selection.engineEntityId ||
    selection.artifact?.id ||
    `${selection.codeRef.range[0]}:${selection.codeRef.range[1]}`
  )
}

function nonCodeSelectionKey(selection: NonCodeSelection) {
  if (typeof selection === 'string') {
    return selection
  }
  if ('type' in selection && selection.type === 'enginePrimitive') {
    return `primitive:${selection.entityId}`
  }
  if ('type' in selection && selection.type === 'engineRegion') {
    return `region:${selection.id}`
  }
  return `defaultPlane:${selection.id}`
}

function makeSelectionBoxVisualState(): SelectionBoxVisualState {
  let selectionBoxObject: ReturnType<
    SelectionBoxVisualState['getSelectionBoxObject']
  > = null
  let selectionBoxGroup: ReturnType<
    SelectionBoxVisualState['getSelectionBoxGroup']
  > = null
  let labelsWrapper: HTMLElement | null = null
  let boxDiv: HTMLElement | null = null
  let verticalLine: HTMLElement | null = null
  let horizontalLine: HTMLElement | null = null

  return {
    getSelectionBoxObject: () => selectionBoxObject,
    setSelectionBoxObject: (value) => {
      selectionBoxObject = value
    },
    getSelectionBoxGroup: () => selectionBoxGroup,
    setSelectionBoxGroup: (value) => {
      selectionBoxGroup = value
    },
    getLabelsWrapper: () => labelsWrapper,
    setLabelsWrapper: (value) => {
      labelsWrapper = value
    },
    getBoxDiv: () => boxDiv,
    setBoxDiv: (value) => {
      boxDiv = value
    },
    getVerticalLine: () => verticalLine,
    setVerticalLine: (value) => {
      verticalLine = value
    },
    getHorizontalLine: () => horizontalLine,
    setHorizontalLine: (value) => {
      horizontalLine = value
    },
  }
}

function selectedOpenCascadeEntityIds(selectionRanges: {
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
    if (
      selection &&
      typeof selection === 'object' &&
      'type' in selection &&
      selection.type === 'engineRegion' &&
      'id' in selection &&
      typeof selection.id === 'string'
    ) {
      ids.add(selection.id)
    }
  }
  return ids
}

export function selectedOpenCascadeDefaultPlaneKeys(
  selectionRanges: {
    otherSelections: unknown[]
  },
  defaultPlanes: DefaultPlanes | null
) {
  const selected = new Set<'xy' | 'xz' | 'yz'>()
  if (!defaultPlanes) {
    return selected
  }

  for (const selection of selectionRanges.otherSelections) {
    if (!selection || typeof selection !== 'object') {
      continue
    }
    const id =
      'id' in selection && typeof selection.id === 'string'
        ? selection.id
        : undefined
    if (!id) {
      continue
    }
    if (id === defaultPlanes.xy || id === defaultPlanes.negXy) {
      selected.add('xy')
    } else if (id === defaultPlanes.xz || id === defaultPlanes.negXz) {
      selected.add('xz')
    } else if (id === defaultPlanes.yz || id === defaultPlanes.negYz) {
      selected.add('yz')
    }
  }
  return selected
}

function artifactForOpenCascadeHit(
  hit: OpenCascadeResolvedHit,
  artifactGraph: ArtifactGraph
) {
  if (hit.hitType === 'topology') {
    return artifactGraph.get(hit.artifactId)
  }
  if (hit.hitType === 'region') {
    return artifactGraph.get(hit.artifactId)
  }
  if (hit.hitType === 'body') {
    for (const artifactId of hit.artifactIds) {
      const artifact = artifactGraph.get(artifactId)
      if (artifact) {
        return artifact
      }
    }
    return undefined
  }
  if (hit.hitType === 'defaultPlane') {
    return undefined
  }
  if (hit.hitType === 'offsetPlane') {
    return artifactGraph.get(hit.planeId)
  }
  if (hit.hitType === 'edge') {
    return undefined
  }

  return (
    artifactGraph.get(hit.artifactId) ||
    Array.from(artifactGraph.values()).find(
      (artifact) =>
        artifact.type === 'segment' && artifact.edgeIds.includes(hit.segmentId)
    )
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
    sketchLineColor: getSegmentColor({
      freedom: 'Fixed',
      theme: getOppositeTheme(resolvedTheme),
    }),
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
        updateOpenCascadeMeshMaterial(object, style.profileColor, 0.78, 0, 0)
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
      isProfile ? 0 : 0.04,
      isProfile ? 0 : 0.96
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

function styleLoadedOpenCascadePreviewMeshes(
  root: Object3D,
  style: OpenCascadeSceneStyle
) {
  const previewColor = new Color(style.surfaceColor)
  previewColor.lerp(new Color(style.edgeColor), 0.18)
  previewColor.offsetHSL(0, 0.08, 0.16)

  root.userData.openCascadePreview = true
  root.traverse((object) => {
    object.userData.openCascadePreview = true
    object.renderOrder = 90

    if (!(object instanceof Mesh)) {
      return
    }

    object.raycast = () => {}
    object.castShadow = false
    object.receiveShadow = false
    disposeMaterial(object.material)
    object.material = new MeshStandardMaterial({
      color: previewColor,
      roughness: 0.62,
      metalness: 0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: OPEN_CASCADE_HIGHLIGHT_POLYGON_OFFSET,
      polygonOffsetUnits: OPEN_CASCADE_HIGHLIGHT_POLYGON_OFFSET,
    })
  })
}

function tagOpenCascadeBodyVisuals(
  root: Object3D,
  solidId: string,
  artifactIds: string[],
  provenance: OpenCascadeEntityProvenance | undefined
) {
  root.userData.openCascadeSolidId = solidId
  root.userData.openCascadeArtifactIds = artifactIds
  root.userData.openCascadeProvenance = provenance
  root.layers.set(SKETCH_LAYER)
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return
    }
    object.userData.openCascadeBodyVisual = true
    object.userData.openCascadeSolidId = solidId
    object.userData.openCascadeArtifactIds = artifactIds
    object.userData.openCascadeProvenance = provenance
    object.layers.set(SKETCH_LAYER)
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
  metalness: number,
  opacity = 0.96
) {
  disposeMaterial(mesh.material)
  const material = new MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent: true,
    opacity,
    depthWrite: opacity > 0,
  })
  material.colorWrite = opacity > 0
  mesh.material = material
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
      (object.userData.openCascadeEdgeLines === true ||
        object.userData.openCascadeSketchLine === true ||
        object.userData.openCascadeEdgeCandidate === true ||
        object.userData.openCascadeSelectedEdge === true ||
        object.userData.openCascadeOffsetPlaneId)
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
    return getOpenCascadeEmptySceneBounds(1)
  }

  return openCascadeBoundsFromBox(box)
}

export function getOpenCascadeSceneContentBounds(scene: Scene) {
  const box = new Box3()
  let hasBounds = false
  for (const rootName of [
    OPEN_CASCADE_SOLID_ROOT,
    OPEN_CASCADE_PROFILE_ROOT,
    OPEN_CASCADE_SKETCH_LINE_ROOT,
    OPEN_CASCADE_REGION_PICK_ROOT,
  ]) {
    const root = scene.getObjectByName(rootName)
    if (!root) {
      continue
    }
    const rootBox = new Box3().setFromObject(root)
    if (rootBox.isEmpty()) {
      continue
    }
    box.union(rootBox)
    hasBounds = true
  }

  return hasBounds ? openCascadeBoundsFromBox(box) : undefined
}

function openCascadeBoundsFromBox(box: Box3) {
  const center = new Vector3()
  const size = new Vector3()
  box.getCenter(center)
  box.getSize(size)

  return { center, radius: Math.max(size.x, size.y, size.z, 1) }
}

function frameOpenCascadeInitialBounds({
  bounds,
  sceneInfra,
  modelCenterRef,
  modelRadiusRef,
  targetRef,
  hasFramedModelRef,
  hasFramedEmptySceneRef,
}: {
  bounds: { center: Vector3; radius: number }
  sceneInfra: {
    camControls: SceneInfra['camControls']
    baseUnitMultiplier: number
  }
  modelCenterRef: { current: Vector3 }
  modelRadiusRef: { current: number }
  targetRef: { current: Vector3 }
  hasFramedModelRef: { current: boolean }
  hasFramedEmptySceneRef: { current: boolean }
}) {
  modelCenterRef.current.copy(bounds.center)
  modelRadiusRef.current = bounds.radius
  targetRef.current.copy(bounds.center)
  fitCameraToRadius(
    sceneInfra.camControls.camera,
    targetRef.current,
    bounds.radius,
    true,
    sceneInfra.baseUnitMultiplier
  )
  sceneInfra.camControls.target.copy(targetRef.current)
  sceneInfra.camControls.onCameraChange()
  hasFramedModelRef.current = true
  hasFramedEmptySceneRef.current = false
}

export function getOpenCascadeEmptySceneBounds(baseUnitMultiplier: number) {
  const unitScale =
    Number.isFinite(baseUnitMultiplier) && baseUnitMultiplier > 0
      ? baseUnitMultiplier
      : 1
  return {
    center: new Vector3(),
    radius: Math.max(1, OPEN_CASCADE_EMPTY_SCENE_RADIUS_BASE_UNITS * unitScale),
  }
}

export function getOpenCascadeSketchLineBounds(
  sketchLines: OpenCascadeSketchLineMeshes
) {
  const box = new Box3()
  let hasPoint = false
  for (const segment of sketchLines.segments) {
    for (let index = 0; index <= segment.points.length - 3; index += 3) {
      box.expandByPoint(
        new Vector3(
          segment.points[index],
          segment.points[index + 1],
          segment.points[index + 2]
        )
      )
      hasPoint = true
    }
  }
  if (!hasPoint || box.isEmpty()) {
    return undefined
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
  useDefaultDirection = false,
  baseUnitMultiplier = 1
) {
  const direction = useDefaultDirection
    ? new Vector3(1.15, -1.65, 1.05).normalize()
    : camera.position.clone().sub(target).normalize()
  if (direction.lengthSq() === 0) {
    direction.set(1.15, -1.65, 1.05).normalize()
  }

  camera.position.copy(target).add(direction.multiplyScalar(radius * 2.4))
  updateCameraClipping(camera, target, radius, baseUnitMultiplier)
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

export function updateCameraClipping(
  camera: OpenCascadeCamera,
  target: Vector3,
  radius: number,
  baseUnitMultiplier = 1
) {
  const distance = camera.position.distanceTo(target)
  const unitScale =
    Number.isFinite(baseUnitMultiplier) && baseUnitMultiplier > 0
      ? baseUnitMultiplier
      : 1
  const modelRadius = Math.max(radius, unitScale)
  const far = Math.max(modelRadius * 100, distance + modelRadius * 20, 1000)
  if (camera instanceof OrthographicCamera) {
    camera.near = 0
    camera.far = far
    camera.updateProjectionMatrix()
    return
  }

  const minNear = Math.max(
    unitScale * OPEN_CASCADE_MIN_CAMERA_NEAR_BASE_UNITS,
    0.000001
  )
  const closestModelDistance = Math.max(distance - modelRadius * 1.5, 0)
  const adaptiveNear = Math.min(
    modelRadius / 100000,
    distance / 100000,
    closestModelDistance / 1000
  )
  camera.near = Math.max(minNear, adaptiveNear)
  camera.far = far
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
  radius: number,
  baseUnitMultiplier = 1
) {
  if (command.type === 'zoom_to_fit') {
    fitCameraToRadius(camera, target, radius, false, baseUnitMultiplier)
    return
  }
  if (command.type === 'view_isometric') {
    fitCameraToRadius(camera, target, radius, true, baseUnitMultiplier)
    return
  }

  setCameraToAxis(command.axis, camera, target, radius, baseUnitMultiplier)
}

function setCameraToAxis(
  axis: CameraAxisName,
  camera: OpenCascadeCamera,
  target: Vector3,
  radius: number,
  baseUnitMultiplier = 1
) {
  const direction = axisToDirection(axis)
  const distance = Math.max(camera.position.distanceTo(target), radius * 2.4)
  camera.position.copy(target).add(direction.multiplyScalar(distance))
  camera.up.copy(
    axis === 'z' || axis === '-z' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
  )
  camera.lookAt(target)
  updateCameraClipping(camera, target, radius, baseUnitMultiplier)
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
