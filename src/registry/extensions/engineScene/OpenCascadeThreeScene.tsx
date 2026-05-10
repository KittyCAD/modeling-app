import { useSignals } from '@preact/signals-react/runtime'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_LAYER } from '@src/clientSideScene/sceneUtils'
import { useModelingContext } from '@src/hooks/useModelingContext'
import {
  getCodeRefsByArtifactId,
  getSketchBlockForPathArtifact,
} from '@src/lang/std/artifactGraph'
import type { ArtifactGraph } from '@src/lang/wasm'
import { useApp, useSingletons } from '@src/lib/boot'
import {
  type CameraAxisName,
  type OpenCascadeCameraControlCommand,
  addOpenCascadeCameraControlListener,
} from '@src/lib/cameraControls'
import type { DefaultPlaneStr } from '@src/lib/planes'
import {
  selectDefaultSketchPlane,
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
import type { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'
import type {
  OpenCascadeSketchLineMeshes,
  OpenCascadeSketchLineSegment,
  OpenCascadeTopologyEdgeLine,
  OpenCascadeRegionFaceGroup,
  OpenCascadeRegionMeshes,
  OpenCascadeRegionMesh,
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
  Object3D,
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
const OPEN_CASCADE_REGION_PICK_ROOT = 'OPEN_CASCADE_REGION_PICK_ROOT'
const OPEN_CASCADE_HIGHLIGHT_ROOT = 'OPEN_CASCADE_HIGHLIGHT_ROOT'
const OPEN_CASCADE_SKETCH_LINE_ROOT = 'OPEN_CASCADE_SKETCH_LINE_ROOT'
const OPEN_CASCADE_EDGE_CANDIDATE_ROOT = 'OPEN_CASCADE_EDGE_CANDIDATE_ROOT'
const OPEN_CASCADE_SELECTED_EDGE_ROOT = 'OPEN_CASCADE_SELECTED_EDGE_ROOT'
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
const OPEN_CASCADE_SKETCH_LINE_PICK_RADIUS_PX = 8
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
  | OpenCascadeResolvedBodyHit

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
  const latestVisibilityVersion =
    openCascadeManager.latestVisibilityVersion.value
  const activeSelectionFilter = openCascadeManager.latestSelectionFilter.value
  const objectSelectionOnly =
    activeSelectionFilter.includes('object') &&
    activeSelectionFilter.every((filter) => filter === 'object')
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
    const lightRoot = makeOpenCascadeLightRoot()

    scene.add(
      solidRoot,
      profileRoot,
      pickRoot,
      regionPickRoot,
      highlightRoot,
      sketchLineRoot,
      edgeCandidateRoot,
      selectedEdgeRoot,
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
      disposeOpenCascadeModelRoot(regionPickRoot)
      disposeOpenCascadeModelRoot(highlightRoot)
      disposeOpenCascadeModelRoot(sketchLineRoot)
      disposeOpenCascadeModelRoot(edgeCandidateRoot)
      disposeOpenCascadeModelRoot(selectedEdgeRoot)
      disposeOpenCascadeModelRoot(guideRoot)
      scene.remove(
        solidRoot,
        profileRoot,
        pickRoot,
        regionPickRoot,
        highlightRoot,
        sketchLineRoot,
        edgeCandidateRoot,
        selectedEdgeRoot,
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
    if (
      solidRoot instanceof Group ||
      profileRoot instanceof Group ||
      sketchLineRoot instanceof Group ||
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
      if (sketchLineRoot instanceof Group) {
        updateOpenCascadeSketchLineStyle(sketchLineRoot, sceneStyle)
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
            scene: gltf.scene,
          }
        })
      )
      if (cancelled) return

      disposeOpenCascadeModelRoot(modelRoot)
      for (const solid of loadedSolids) {
        solid.scene.name = `${OPEN_CASCADE_SOLID_ROOT}:${solid.solidId}`
        tagOpenCascadeBodyVisuals(solid.scene, solid.solidId, solid.artifactIds)
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
    const isSelectingSketchPlane = state.matches('Sketch no face')
    const resolveHit = (intersects: Intersection[]) =>
      resolveOpenCascadeHit(intersects, {
        includeDefaultPlanes: true,
        preferDefaultPlanes: isSelectingSketchPlane,
        objectSelectionOnly,
      })

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
      const selectedIds = selectedOpenCascadeEntityIds(
        state.context.selectionRanges
      )
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
      sceneInfra.renderFrame()
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
        if (
          hoveredTopologyId === nextTopologyId &&
          hoveredEdgeId === nextEdgeId &&
          hoveredSketchSegmentId === nextSketchSegmentId &&
          hoveredRegionId === nextRegionId &&
          hoveredBodyId === nextBodyId
        ) {
          return
        }
        hoveredTopologyId = nextTopologyId
        hoveredEdgeId = nextEdgeId
        hoveredSketchSegmentId = nextSketchSegmentId
        hoveredRegionId = nextRegionId
        hoveredBodyId = nextBodyId
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
                if (!plane) {
                  return
                }
                send({ type: 'Select sketch plane', data: plane })
              })
              .catch((error) => console.warn(error))
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
                        : hit.pathId,
              primitiveIndex: hit.hitType === 'edge' ? hit.edgeIndex : 0,
              primitiveType:
                hit.hitType === 'topology'
                  ? hit.kind
                  : hit.hitType === 'edge'
                    ? 'edge'
                    : hit.hitType === 'region'
                      ? 'face'
                      : hit.hitType === 'body'
                        ? 'object'
                        : 'edge',
            },
          },
        })
      },
    })

    return () => {
      for (const unsubscribe of unsubscribeLinePickThreshold) {
        unsubscribe()
      }
      sceneInfra.raycaster.params.Line = {
        ...sceneInfra.raycaster.params.Line,
        threshold: previousLineThreshold,
      }
      sceneInfra.resetMouseListeners()
    }
  }, [
    engineCommandManager,
    kclManager.artifactGraph,
    kclManager.sceneInfra,
    passiveProfilesVisible,
    send,
    state.value,
    state.context.selectionRanges,
    objectSelectionOnly,
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
        makeOpenCascadeEdgeLine({
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
    const group = solid.groups.find(
      (candidate) =>
        indexStart >= candidate.start &&
        indexStart < candidate.start + candidate.count
    )
    if (group) {
      if (options.objectSelectionOnly) {
        return {
          hitType: 'body',
          solidId: solid.solidId,
          artifactId: solid.artifactIds?.[0] || solid.solidId,
          artifactIds: solid.artifactIds || [solid.solidId],
        }
      }
      return { ...group, hitType: 'topology', solidId: solid.solidId }
    }
  }
  if (defaultPlaneHits.length > 0) {
    return defaultPlaneHits[0]
  }
  return undefined
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

function tagOpenCascadeBodyVisuals(
  root: Object3D,
  solidId: string,
  artifactIds: string[]
) {
  root.userData.openCascadeSolidId = solidId
  root.userData.openCascadeArtifactIds = artifactIds
  root.layers.set(SKETCH_LAYER)
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return
    }
    object.userData.openCascadeBodyVisual = true
    object.userData.openCascadeSolidId = solidId
    object.userData.openCascadeArtifactIds = artifactIds
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
        object.userData.openCascadeSelectedEdge === true)
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
