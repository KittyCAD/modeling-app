import type {
  EntityReference,
  EntityType,
  OkModelingCmdResponse,
} from '@kittycad/lib'
import type { LocalSelectionCommandHandler } from '@src/clientSideScene/localSelectionCommandProxy'
import {
  LOCAL_WEBGPU_GTAO_SAMPLES,
  LOCAL_WEBGPU_GTAO_USE_DENOISE,
  LOCAL_WEBGPU_GTAO_USE_NORMAL_MRT,
  LOCAL_WEBGPU_SKETCH_LINE_WIDTH_PX,
} from '@src/clientSideScene/localRenderer/config'
import {
  getEntityPoint,
  projectEntityPoint,
} from '@src/clientSideScene/localRenderer/projectEntityPoint'
import {
  EdgeRenderer,
  getBodyEdges,
  getSketchLineColor,
  getSketchSegmentEdges,
} from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { createRegionMeshes } from '@src/clientSideScene/localRenderer/sketchRegions'
import { PlaneRenderer } from '@src/clientSideScene/localRenderer/PlaneRenderer'
import { EnvMapLoader } from '@src/clientSideScene/localRenderer/EnvMapLoader'
import { IntegerIdPicker } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import { HDR_ENV_MAP_URL } from '@src/clientSideScene/localRenderer/maps'
import { SelectionHighlightRenderer } from '@src/clientSideScene/localRenderer/SelectionHighlightRenderer'
import {
  getSectionPlane,
  setSectionPlane,
} from '@src/clientSideScene/localRenderer/sectionView'
import type { LocalRendererHost } from '@src/clientSideScene/localRenderer/host'
import {
  DEFAULT_LOCAL_VIEWPORT_OPTIONS,
  type LocalViewportOptions,
  ViewportAppearance,
  getViewportPixelRatio,
  isVisibleInViewport,
} from '@src/clientSideScene/localRenderer/viewportOptions'
import {
  SceneExecutionEvents,
  type SceneExecutionDoneDetail,
} from '@src/lib/kcl/scene/execution'
import { artifactToEntityRef } from '@src/lang/queryAst'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { DprDetector } from '@src/lib/DprDetector'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { type ResolvedTheme, getThemeBackgroundColor } from '@src/lib/theme'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { reportRejection, trap } from '@src/lib/trap'
import { isArray, isNonNullable, uuidv4 } from '@src/lib/utils'
import type { PlaneVisibilityMap } from '@src/machines/modelingSharedTypes'
import toast from 'react-hot-toast'
import {
  Box3,
  BufferGeometry,
  type Camera,
  Color,
  DoubleSide,
  Group,
  Material,
  MathUtils,
  Mesh,
  NeutralToneMapping,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
} from 'three'
import {
  GLTFLoader,
  type GLTFLoaderPlugin,
  type GLTFReference,
} from 'three/examples/jsm/loaders/GLTFLoader.js'
import type DenoiseNode from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import type GTAONode from 'three/examples/jsm/tsl/display/GTAONode.js'
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js'
import {
  color,
  frontFacing,
  materialColor,
  mrt,
  normalView,
  output,
  pass,
  select,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import {
  ClippingGroup,
  MeshStandardNodeMaterial,
  type Node,
  type PassNode,
  RenderPipeline,
  WebGPURenderer,
} from 'three/webgpu'
import type {
  KITTYCAD_GLTF,
  KITTYCAD_GLTF_BREP,
} from '@src/clientSideScene/localRenderer/KITTYCAD_GLTF'

const ENGINE_MILLIMETERS_TO_GLTF_METERS = 1 / 1000

const MODEL_LOAD_ERROR_TOAST_ID = 'local-renderer-model-load-error'

// If the filter selects whole bodies, returns which kind: 'solid3d' (the "Bodies"
// filter) or 'object' (set by commands, also allows planes and regions).
// With any other type alongside it, e.g. ['face', 'object'], returns undefined.
function getBodySelectionType(filter: readonly EntityType[]) {
  const [type] = filter
  return filter.length === 1 && (type === 'object' || type === 'solid3d')
    ? type
    : undefined
}

function addToGroup<K>(groups: Map<K, Mesh[]>, key: K, mesh: Mesh) {
  const group = groups.get(key)
  if (group) {
    group.push(mesh)
  } else {
    groups.set(key, [mesh])
  }
}

// A frame size in device pixels.
export type FrameSize = { width: number; height: number }

// Changes the camera to the aspect ratio, still showing all it shows now.
function widenCameraToAspect(
  camera: PerspectiveCamera | OrthographicCamera,
  aspect: number
) {
  if (camera instanceof PerspectiveCamera) {
    if (aspect < camera.aspect) {
      // A narrower frame keeps the horizontal view and shows more vertically.
      const halfWidth =
        Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.aspect
      camera.fov = MathUtils.radToDeg(2 * Math.atan(halfWidth / aspect))
    }
    camera.aspect = aspect
  } else {
    const centerX = (camera.left + camera.right) / 2
    const centerY = (camera.top + camera.bottom) / 2
    const halfWidth = Math.max(
      (camera.right - camera.left) / 2,
      ((camera.top - camera.bottom) / 2) * aspect
    )
    const halfHeight = halfWidth / aspect
    camera.left = centerX - halfWidth
    camera.right = centerX + halfWidth
    camera.top = centerY + halfHeight
    camera.bottom = centerY - halfHeight
  }
  camera.updateProjectionMatrix()
}

/** glTF is Y-up in meters; the shared navigation camera is Z-up in mm. */
function gltfToEngineBounds({ min, max }: Box3) {
  const bounds = new Box3(
    new Vector3(min.x, -max.z, min.y),
    new Vector3(max.x, -min.z, max.y)
  )
  bounds.min.divideScalar(ENGINE_MILLIMETERS_TO_GLTF_METERS)
  bounds.max.divideScalar(ENGINE_MILLIMETERS_TO_GLTF_METERS)
  return bounds
}

// The installed typings omit support for reconstructing normals from depth.
type CreateAmbientOcclusion = (
  depthNode: Node,
  normalNode: Node | null,
  camera: Camera
) => GTAONode
type AmbientOcclusionPipeline = {
  camera: PerspectiveCamera | OrthographicCamera
  pipeline: RenderPipeline
  scenePass: PassNode
  aoPass: GTAONode
  denoisePass: DenoiseNode | null
  denoiseNoiseTexture: Texture | null
}
/** What three.js reports for a lost WebGPU device or WebGL context. */
type DeviceLostInfo = Parameters<WebGPURenderer['onDeviceLost']>[0]
type DisposableGpuDevice = {
  destroy: () => void
}
/** Created together by initialize(), once the renderer is ready. */
type GpuResources = {
  renderer: WebGPURenderer
  maxTextureDimension: number
  device: DisposableGpuDevice | null
  scene: Scene
  envMapLoader: EnvMapLoader
  edgeRenderer: EdgeRenderer
  sketchLineRenderer: EdgeRenderer
  planeRenderer: PlaneRenderer
  integerIdPicker: IntegerIdPicker
  selectionHighlightRenderer: SelectionHighlightRenderer
}
/** What LocalWebGPUScene last passed in, through the constructor or a setter. */
type RendererSettings = {
  theme: ResolvedTheme
  enableSSAO: boolean
  shouldHighlightEdges: boolean
  fixedSizeGrid: boolean
  pickingEnabled: boolean
  defaultPlaneVisibility: PlaneVisibilityMap
}
/** Why the local renderer cannot draw, so the scene can offer streaming instead. */
export interface LocalRendererFailure {
  /** 'initialization': no GPU renderer could start. 'lost': the GPU went away while rendering. */
  kind: 'initialization' | 'lost'
  message: string
}
export interface LocalRendererProps {
  theme: ResolvedTheme
  enableSSAO: boolean
  shouldHighlightEdges: boolean
  fixedSizeGrid: boolean
  backfaceColor: string
  /** isNewModel: the result of a finished execution is now in the scene. */
  onModelLoadSettled?: (isNewModel?: boolean) => void
  onRendererFailed?: (failure: LocalRendererFailure) => void
}

export class LocalRenderer {
  private readonly container: HTMLDivElement
  private readonly host: LocalRendererHost
  private readonly settings: RendererSettings
  private readonly onModelLoadSettled: LocalRendererProps['onModelLoadSettled']
  private readonly onRendererFailed: LocalRendererProps['onRendererFailed']
  private gpu: GpuResources | null = null
  /** Undo what this renderer registered elsewhere; dispose() runs them. */
  private readonly disposers: (() => void)[] = []
  private animationFrameId = -1
  private currentModel: Object3D | null = null
  private readonly modelSectionGroup = new ClippingGroup()
  private readonly sectionBounds = new Box3()
  private viewportOptions = { ...DEFAULT_LOCAL_VIEWPORT_OPTIONS }
  private readonly viewportAppearance = new ViewportAppearance()
  private viewportVersion = 0
  private readonly gltfLoader = new GLTFLoader()
  // Shared by all model materials, so a new color doesn't rebuild their shaders.
  private readonly backfaceColor = uniform(new Color())
  /** Bumped when an execution starts. Async work started before it is stale. */
  private executionVersion = 0
  /** The engine scene generation of the model on screen, once it has loaded. */
  private loadedSceneGeneration: number | null = null
  /** A camera reset waiting for the next model. The first model always gets one. */
  private cameraResetPending = true
  private camera: PerspectiveCamera | OrthographicCamera | null = null
  private ambientOcclusionRadius = 0.01
  private ambientOcclusionPipeline: AmbientOcclusionPipeline | null = null
  private baseRenderDirty = true
  private disposed = false
  // What the engine last said is selected, kept so that the highlight can be
  // redrawn when the meshes are rebuilt.
  private selectedEntityIds: string[] = []
  private selectionRequestVersion = 0
  private readonly engineEntityReferences = new Map<string, EntityReference>()
  // Several meshes, since periodic surfaces can be split with one face ID.
  private readonly targetsByEntityId = new Map<string, Mesh[]>()
  private readonly facesByBodyMesh = new Map<number, Mesh[]>()
  // Filled in by clicks, since the GLB doesn't have the solids' UUIDs: the engine
  // writes them, but the format crate loses them when it tessellates through
  // HOOPS (map_topology_uuids only restores edges and faces). Once the GLB has
  // them, this can go and faces can be matched to their body by that UUID.
  private readonly bodyFacesById = new Map<string, Mesh[]>()
  private hoveredTarget: Mesh | null = null
  private hoverRequestVersion = 0
  private pointerOverCanvas = false

  constructor(
    container: HTMLDivElement,
    host: LocalRendererHost,
    props: LocalRendererProps
  ) {
    this.container = container
    this.host = host
    this.settings = {
      theme: props.theme,
      enableSSAO: props.enableSSAO,
      shouldHighlightEdges: props.shouldHighlightEdges,
      fixedSizeGrid: props.fixedSizeGrid,
      pickingEnabled: false,
      defaultPlaneVisibility: { xy: true, xz: true, yz: true },
    }
    this.onModelLoadSettled = props.onModelLoadSettled
    this.onRendererFailed = props.onRendererFailed
    this.backfaceColor.value.set(props.backfaceColor)
    this.gltfLoader.register(() => backfaceColorPlugin(this.backfaceColor))

    this.container.style.opacity = '0'
    host.executionEvents.addEventListener(
      SceneExecutionEvents.ExecutionDone,
      this.onExecutionDone
    )
    const dprDetector = new DprDetector(this.updateLocalCamera)
    this.disposers.push(
      () =>
        host.executionEvents.removeEventListener(
          SceneExecutionEvents.ExecutionDone,
          this.onExecutionDone
        ),
      host.executing.subscribe((isExecuting) => {
        if (isExecuting) {
          // A new execution invalidates exports, GLB parses, picks and engine
          // queries still in flight.
          this.executionVersion += 1
          this.clearHover()
        }
      }),
      host.selectionFilter.subscribe(() => this.rebuildSelectionTargets()),
      host.sceneInfra.baseUnitChange.add(this.syncPlaneScale),
      () => dprDetector.dispose()
    )
    void this.initialize().catch(this.handleInitializationError)
  }

  setFixedSizeGrid(fixedSizeGrid: boolean) {
    if (this.settings.fixedSizeGrid === fixedSizeGrid) return
    this.settings.fixedSizeGrid = fixedSizeGrid
    this.syncPlaneScale()
  }

  setViewportOptions(options: LocalViewportOptions) {
    const visibilityChanged =
      options.showBreps !== this.viewportOptions.showBreps ||
      options.showSketches !== this.viewportOptions.showSketches
    const sectionChanged =
      options.sectionEnabled !== this.viewportOptions.sectionEnabled ||
      options.sectionPlane !== this.viewportOptions.sectionPlane ||
      options.sectionPosition !== this.viewportOptions.sectionPosition ||
      options.sectionReversed !== this.viewportOptions.sectionReversed
    this.viewportOptions = { ...options }
    this.applyViewportOptions()
    if (visibilityChanged || sectionChanged) {
      this.viewportVersion++
      this.clearHover()
    }
    if (visibilityChanged) {
      this.rebuildSelectionTargets()
    }
    this.invalidateBaseRender()
  }

  private applyViewportOptions() {
    if (this.currentModel) {
      this.viewportAppearance.apply(this.currentModel, this.viewportOptions)
    }
    const edgesVisible =
      this.settings.shouldHighlightEdges && this.viewportOptions.showBreps
    this.gpu?.edgeRenderer.setVisible(edgesVisible)
    this.gpu?.integerIdPicker.setEdgesVisible(edgesVisible)
    this.gpu?.sketchLineRenderer.setVisible(this.viewportOptions.showSketches)
    this.gpu?.selectionHighlightRenderer.setColorAdjustments(
      this.viewportOptions.brightness,
      this.viewportOptions.contrast
    )
    const plane = getSectionPlane(this.sectionBounds, this.viewportOptions)
    setSectionPlane(this.modelSectionGroup, plane)
    this.gpu?.integerIdPicker.setSectionPlane(plane)
    this.gpu?.selectionHighlightRenderer.setSectionPlane(plane)
  }

  setPickingEnabled(enabled: boolean) {
    this.settings.pickingEnabled = enabled
    this.gpu?.integerIdPicker.invalidate()
    if (!enabled) this.clearHover()
  }

  setDefaultPlaneVisibility(visibility: PlaneVisibilityMap) {
    this.settings.defaultPlaneVisibility = { ...visibility }
    this.gpu?.planeRenderer.setDefaultVisibility(visibility)
    this.gpu?.integerIdPicker.invalidate()
    this.clearHover()
    this.updateSelection()
    this.invalidateBaseRender()
  }

  get hasVisibleDefaultPlanes() {
    return Object.values(this.settings.defaultPlaneVisibility).some(Boolean)
  }

  private getPlaneTargets(id: string | null): Mesh[] | null {
    if (!id) return null
    const plane = this.gpu?.planeRenderer.planes.get(id)
    return plane?.group.visible ? plane.meshes : null
  }

  private getSelectedTargets() {
    return this.selectedEntityIds
      .flatMap(
        (id) =>
          this.bodyFacesById.get(id) ??
          this.getPlaneTargets(id) ??
          this.targetsByEntityId.get(id)
      )
      .filter(isNonNullable)
      .filter(isVisibleInViewport)
  }

  // All the meshes of the target's body, or just the target if it isn't on a body.
  private getBodyFaces(target: Mesh) {
    return this.facesByBodyMesh.get(target.userData.bodyMeshIndex) ?? [target]
  }

  private updateSelection() {
    this.gpu?.selectionHighlightRenderer.setSelection(this.getSelectedTargets())
    this.scheduleRender()
  }

  private readonly clearHover = () => {
    this.hoverRequestVersion++
    this.hoveredTarget = null
    this.gpu?.selectionHighlightRenderer.setHover([])
    this.scheduleRender()
  }

  // What hovering the target highlights: all quadrants of a plane, its whole
  // body with a body filter, otherwise all the meshes of its face, or just the
  // target for edges.
  private getHoverTargets(target: Mesh | null, filter: readonly EntityType[]) {
    if (!target) {
      return []
    }
    const planeTargets = this.getPlaneTargets(target.name)
    if (planeTargets) {
      return planeTargets
    }
    if (getBodySelectionType(filter)) {
      return this.getBodyFaces(target).filter(isVisibleInViewport)
    }
    return (
      this.targetsByEntityId.get(target.userData.faceUuid) ?? [target]
    ).filter(isVisibleInViewport)
  }

  // Refresh everything that depends on what's pickable when the model or filter changes.
  private rebuildSelectionTargets() {
    const { gpu } = this
    if (!gpu) return
    const { planeRenderer, edgeRenderer, sketchLineRenderer } = gpu
    planeRenderer.updateDefaultPlanes(this.host.defaultPlanes())
    planeRenderer.setDefaultVisibility(this.settings.defaultPlaneVisibility)
    const targets = Array.from(planeRenderer.planes.values()).flatMap(
      ({ meshes }) => meshes
    )

    // Rebuild lookups
    this.targetsByEntityId.clear()
    this.facesByBodyMesh.clear()
    this.currentModel?.traverse((object) => {
      if (
        (object as Mesh).isMesh &&
        typeof object.userData.faceUuid === 'string'
      ) {
        const mesh = object as Mesh
        targets.push(mesh)
        addToGroup(this.targetsByEntityId, object.userData.faceUuid, mesh)
        if (object.userData.bodyMeshIndex !== undefined) {
          addToGroup(this.facesByBodyMesh, object.userData.bodyMeshIndex, mesh)
        }
      }
    })
    const edgeTargets = edgeRenderer.getSelectionTargets()
    const sketchLineTargets = sketchLineRenderer.getSelectionTargets()
    for (const { object } of [...edgeTargets, ...sketchLineTargets]) {
      addToGroup(this.targetsByEntityId, object.userData.edgeUuid, object)
    }

    // Pass filtered targets to picker
    const filter = this.host.selectionFilter.peek()
    gpu.integerIdPicker.setTargets(
      targets.filter(
        (target) =>
          isVisibleInViewport(target) && this.isSelectable(target, filter)
      ),
      this.currentModel,
      filter.includes('edge') &&
        this.viewportOptions.showBreps &&
        this.settings.shouldHighlightEdges
        ? { source: edgeRenderer.lines, targets: edgeTargets }
        : undefined,
      // Object-selection commands accept paths and helices, not just solids.
      this.viewportOptions.showSketches &&
        (filter.includes('curve') || getBodySelectionType(filter) === 'object')
        ? { source: sketchLineRenderer.lines, targets: sketchLineTargets }
        : undefined
    )

    // All targets, so what's already selected stays highlighted when the filter changes
    gpu.selectionHighlightRenderer.setTargets(
      [
        ...targets,
        ...edgeTargets.map(({ object }) => object),
        ...sketchLineTargets.map(({ object }) => object),
      ].filter(isVisibleInViewport)
    )
    this.clearHover()
    this.updateSelection()
  }

  // Decides if the target can be selected by the currently set filter.
  // Edges and sketch lines are handled in rebuildSelectionTargets.
  private isSelectable(target: Mesh, filter: readonly EntityType[]) {
    if (this.gpu?.planeRenderer.planes.has(target.name)) {
      // Only "object" filter allows planes ("All", "Faces" and ['object'] but not "Edges" or "Bodies")
      return filter.includes('object')
    }
    const bodyType = getBodySelectionType(filter)
    if (target.userData.isSketchRegion) {
      // A region filter, or object on its own
      return filter.includes('region') || bodyType === 'object'
    }
    return filter.includes('face') || bodyType !== undefined
  }

  private getLocalEntityReference(entityId: string) {
    if (this.gpu?.planeRenderer.planes.has(entityId)) {
      return { type: 'plane' as const, plane_id: entityId }
    }
    const artifact = this.host.artifacts().get(entityId)
    if (!artifact) {
      return undefined
    }
    return artifactToEntityRef(
      artifact.type,
      entityId,
      artifact.type === 'segment' ? artifact.pathId : undefined
    )
  }

  /**
   * The engine's reference is the complete one: it can describe an edge
   * between two faces of a sweep, and it adds a face's parent body and index.
   * So the engine is asked once per entity and the answer is cached.
   * Only click asks for this, hover doesn't need it (we just highlight the edge by its id).
   */
  private async getEngineEntityReference(entityId: string) {
    const cached = this.engineEntityReferences.get(entityId)
    if (cached) {
      return cached
    }
    const version = this.executionVersion
    const response = await this.host.commands.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'query_entity_type', entity_id: entityId },
    })
    // An execution started while the engine was answering.
    if (version !== this.executionVersion) {
      return undefined
    }
    // A reply from the engine arrives wrapped in a one-element array
    const single = isArray(response) ? response[0] : response

    if (single && isModelingResponse(single)) {
      const modelingResponse = single.resp.data.modeling_response
      if (modelingResponse.type === 'query_entity_type') {
        const reference = modelingResponse.data.reference
        this.engineEntityReferences.set(entityId, reference)
        return reference
      }
    }
  }

  /**
   * The engine holds the selection: the app tells it which references are
   * selected and it turns them into entity IDs. Those IDs are what is
   * highlighted here, so the engine is asked for them whenever a command
   * changes the selection.
   */
  private async syncSelectionFromEngine() {
    const version = ++this.selectionRequestVersion
    // Lets the command that changed the selection be sent first, and lets only
    // the last command of a burst ask.
    await Promise.resolve()
    if (version !== this.selectionRequestVersion) {
      return
    }
    const response = await this.host.commands.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'select_get' },
    })
    // The selection changed again while the engine was answering.
    if (this.disposed || version !== this.selectionRequestVersion) {
      return
    }
    // A reply from the engine arrives wrapped in a one-element array
    const single = isArray(response) ? response[0] : response

    if (single && isModelingResponse(single)) {
      const modelingResponse = single.resp.data.modeling_response
      if (modelingResponse.type === 'select_get') {
        this.selectedEntityIds = modelingResponse.data.entity_ids
        this.updateSelection()
      }
    }
  }

  private readonly handleLocalSelectionCommand: LocalSelectionCommandHandler =
    async (command, { streamDimensions }) => {
      if (command.type !== 'modeling_cmd_req') return null
      const { cmd } = command
      if (
        cmd.type !== 'highlight_set_entity' &&
        cmd.type !== 'query_entity_type_with_point'
      )
        return null
      const isHover = cmd.type === 'highlight_set_entity'
      const controls = this.host.sceneInfra.camControls
      if (
        !this.settings.pickingEnabled ||
        this.host.executing.peek() ||
        // The old model stays on screen until the new one has loaded,
        // but don't allow hover/picking if the new model is already downloading.
        (this.currentModel !== null && !this.isLoadedSceneCurrent()) ||
        controls.isDragging ||
        (isHover &&
          (!this.pointerOverCanvas || controls.hoverPickingDisabled)) ||
        (!isHover && controls.wasDragging) ||
        !this.camera
      )
        return {}
      const requestVersion = isHover
        ? ++this.hoverRequestVersion
        : this.hoverRequestVersion
      const executionVersion = this.executionVersion
      const viewportVersion = this.viewportVersion
      const filter = this.host.selectionFilter.peek()
      const result = await this.gpu?.integerIdPicker.pick({
        ...cmd.selected_at_window,
        streamWidth: streamDimensions.width,
        streamHeight: streamDimensions.height,
        camera: this.camera,
      })

      if (
        this.disposed ||
        !this.settings.pickingEnabled ||
        this.host.executing.peek() ||
        executionVersion !== this.executionVersion ||
        viewportVersion !== this.viewportVersion ||
        result?.stale ||
        (isHover && requestVersion !== this.hoverRequestVersion)
      )
        return {}
      const target = result?.target ?? null
      const entityId =
        (typeof target?.userData.edgeUuid === 'string' &&
          target.userData.edgeUuid) ||
        (typeof target?.userData.faceUuid === 'string' &&
          target.userData.faceUuid) ||
        (target && this.gpu?.planeRenderer.planes.has(target.name)
          ? target.name
          : null)
      if (isHover) {
        if (this.hoveredTarget !== target) {
          this.hoveredTarget = target
          this.gpu?.selectionHighlightRenderer.setHover(
            this.getHoverTargets(target, filter)
          )
          this.scheduleRender()
        }
        return {
          unreliableModelingResponse: {
            type: 'highlight_set_entity',
            data: { entity_id: entityId },
          },
        }
      }
      let reference: EntityReference | undefined = entityId
        ? ((await this.getEngineEntityReference(entityId)) ??
          this.getLocalEntityReference(entityId))
        : undefined
      if (
        executionVersion !== this.executionVersion ||
        viewportVersion !== this.viewportVersion ||
        filter !== this.host.selectionFilter.peek()
      ) {
        return {}
      }
      // With a body filter, a picked face stands for its whole body.
      if (reference?.type === 'face' && getBodySelectionType(filter)) {
        const bodyId = reference.topology_fallback?.parent_id
        if (bodyId) {
          reference = { type: 'solid3d', solid3d_id: bodyId }
          if (target) {
            this.bodyFacesById.set(bodyId, this.getBodyFaces(target))
          }
        } else {
          reference = undefined
          trap(new Error('Could not find the body of the selected face'))
        }
      }
      const response = {
        type: 'query_entity_type_with_point',
        data: { reference },
      } satisfies Extract<
        OkModelingCmdResponse,
        { type: 'query_entity_type_with_point' }
      >
      return {
        modelingResponse: { type: response.type, data: { ...response.data } },
        websocketResponse: {
          success: true,
          request_id: command.cmd_id,
          resp: { type: 'modeling', data: { modeling_response: response } },
        },
      }
    }

  private get backgroundColor() {
    return getThemeBackgroundColor(this.settings.theme)
  }

  /**
   * Whether the loaded model is the scene of the last finished execution.
   * The host can finish execution before publishing the artifact graph, so prefer
   * its current execution generation over the published generation.
   */
  isLoadedSceneCurrent() {
    return (
      this.loadedSceneGeneration ===
      (this.host.currentSceneGeneration() ?? this.host.sceneGeneration.peek())
    )
  }

  setTheme(theme: ResolvedTheme) {
    if (this.settings.theme === theme) return
    this.settings.theme = theme
    this.gpu?.selectionHighlightRenderer.setBackgroundColor(
      this.backgroundColor
    )
    this.gpu?.planeRenderer.setTheme(theme)
    this.gpu?.sketchLineRenderer.setColor(getSketchLineColor(theme))
    this.invalidateBaseRender()
  }

  setEnableSSAO(enableSSAO: boolean) {
    if (this.settings.enableSSAO === enableSSAO) {
      return
    }

    this.settings.enableSSAO = enableSSAO
    // render() rebuilds the pipeline if SSAO is turned back on.
    if (!enableSSAO) {
      this.disposeAmbientOcclusionPipeline()
    }
    this.invalidateBaseRender()
  }

  setEdgeHighlighting(shouldHighlightEdges: boolean) {
    if (this.settings.shouldHighlightEdges === shouldHighlightEdges) {
      return
    }

    this.settings.shouldHighlightEdges = shouldHighlightEdges
    this.viewportVersion++
    this.applyViewportOptions()
    this.rebuildSelectionTargets()
    this.invalidateBaseRender()
  }

  setBackfaceColor(backfaceColor: string) {
    this.backfaceColor.value.set(backfaceColor)
    this.invalidateBaseRender()
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true
    for (const dispose of this.disposers.splice(0)) {
      dispose()
    }
    this.container.style.opacity = '0'
    this.clearModel()
    if (this.animationFrameId !== -1) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = -1
    }
    this.disposeAmbientOcclusionPipeline()
    const { gpu } = this
    this.gpu = null
    if (gpu) {
      gpu.planeRenderer.dispose()
      gpu.edgeRenderer.dispose()
      gpu.sketchLineRenderer.dispose()
      gpu.integerIdPicker.dispose()
      gpu.selectionHighlightRenderer.dispose()
      gpu.envMapLoader.dispose()
      gpu.renderer.domElement.remove()
      // The renderer frees its resources asynchronously, so the device has to outlive that.
      gpu.renderer
        .dispose()
        .then(() => gpu.device?.destroy())
        .catch(reportRejection)
    }
    this.camera = null
  }

  private readonly syncPlaneScale = () => {
    const { camControls, baseUnitMultiplier } = this.host.sceneInfra
    // Match the engine's fixed grid: ten file units, expressed in decimeters.
    // baseUnitMultiplier converts one file unit to mm; 100 mm = one dm.
    const fixedGridScale = this.settings.fixedSizeGrid
      ? (10 * baseUnitMultiplier) / 100
      : undefined
    const distance = camControls.camera.position.distanceTo(camControls.target)
    this.gpu?.planeRenderer.updateScale(distance, fixedGridScale)
    this.gpu?.integerIdPicker.invalidate()
    this.invalidateBaseRender()
  }

  private readonly updateLocalCamera = () => {
    const cameraControls = this.host.sceneInfra.camControls
    if (cameraControls.isDragging) {
      // Dragging should clear hover, but mouse scroll shouldn't (to avoid flickering when over a plane)
      this.clearHover()
    }
    const sharedCamera = cameraControls.camera
    const sharedTarget = cameraControls.target
    this.syncPlaneScale()
    if (!this.camera) {
      return
    }

    const position = convertEngineWorldVectorToGltfWorld(
      sharedCamera.position,
      ENGINE_MILLIMETERS_TO_GLTF_METERS
    )
    const target = convertEngineWorldVectorToGltfWorld(
      sharedTarget,
      ENGINE_MILLIMETERS_TO_GLTF_METERS
    )
    const up = convertEngineWorldVectorToGltfWorld(sharedCamera.up)

    if (
      sharedCamera instanceof PerspectiveCamera &&
      !(this.camera instanceof PerspectiveCamera)
    ) {
      this.camera = new PerspectiveCamera()
    } else if (
      sharedCamera instanceof OrthographicCamera &&
      !(this.camera instanceof OrthographicCamera)
    ) {
      this.camera = new OrthographicCamera()
    }

    this.camera.layers.mask = sharedCamera.layers.mask
    this.camera.position.copy(position)
    this.camera.up.copy(up)
    // Preserve the shared clip range, including a negative orthographic near plane.
    this.camera.near = sharedCamera.near * ENGINE_MILLIMETERS_TO_GLTF_METERS
    this.camera.far = sharedCamera.far * ENGINE_MILLIMETERS_TO_GLTF_METERS

    if (
      sharedCamera instanceof PerspectiveCamera &&
      this.camera instanceof PerspectiveCamera
    ) {
      this.camera.fov = sharedCamera.fov
      this.camera.aspect =
        Math.max(this.container.clientWidth, 1) /
        Math.max(this.container.clientHeight, 1)
    } else if (
      sharedCamera instanceof OrthographicCamera &&
      this.camera instanceof OrthographicCamera
    ) {
      this.camera.left = sharedCamera.left * ENGINE_MILLIMETERS_TO_GLTF_METERS
      this.camera.right = sharedCamera.right * ENGINE_MILLIMETERS_TO_GLTF_METERS
      this.camera.top = sharedCamera.top * ENGINE_MILLIMETERS_TO_GLTF_METERS
      this.camera.bottom =
        sharedCamera.bottom * ENGINE_MILLIMETERS_TO_GLTF_METERS
      this.camera.zoom = sharedCamera.zoom
    }

    this.camera.lookAt(target)
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld(true)
    this.gpu?.integerIdPicker.invalidate()
    this.invalidateBaseRender()
  }

  private readonly handleInitializationError = (error: unknown) => {
    if (this.disposed) return
    console.error('[LocalRenderer] initialization failed', error)
    reportRejection(error)
    void reportClientError({
      code: ClientErrorCode.LocalRendererFailure,
      message: 'Local renderer failed: initialization',
      error,
      dedupeKey: 'LocalRenderer:initialization',
      extra: { kind: 'initialization' },
    })
    this.onRendererFailed?.({
      kind: 'initialization',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  private readonly handleDeviceLost = (info: DeviceLostInfo) => {
    // three.js ignores the loss that dispose() causes, but the scene may be gone.
    if (this.disposed) return
    console.error('[LocalRenderer] GPU device lost', info)
    void reportClientError({
      code: ClientErrorCode.LocalRendererFailure,
      message: 'Local renderer failed: lost',
      dedupeKey: 'LocalRenderer:lost',
      extra: {
        kind: 'lost',
        api: info.api,
        reason: info.reason,
        message: info.message,
      },
    })
    // Stop rendering, so a later execution can't save a blank project thumbnail.
    this.dispose()
    this.onRendererFailed?.({ kind: 'lost', message: info.message })
  }

  private configureAmbientOcclusion(
    aoPass: GTAONode,
    denoisePass?: DenoiseNode | null
  ) {
    aoPass.radius.value = this.ambientOcclusionRadius
    aoPass.thickness.value = this.ambientOcclusionRadius * 3
    //aoPass.distanceFallOff.value = 0.5
    aoPass.scale.value = 1
    aoPass.samples.value = LOCAL_WEBGPU_GTAO_SAMPLES
    if (denoisePass) {
      denoisePass.depthPhi.value = this.ambientOcclusionRadius * 3
    }
  }

  private disposeAmbientOcclusionPipeline() {
    this.ambientOcclusionPipeline?.pipeline.dispose()
    this.ambientOcclusionPipeline?.scenePass.dispose()
    this.ambientOcclusionPipeline?.aoPass.dispose()
    this.ambientOcclusionPipeline?.denoiseNoiseTexture?.dispose()
    this.ambientOcclusionPipeline?.denoisePass?.dispose()
    this.ambientOcclusionPipeline = null
  }

  private updateAmbientOcclusionScale(modelBounds: Box3) {
    if (modelBounds.isEmpty()) {
      return
    }

    const size = modelBounds.getSize(new Vector3())
    const modelScale = Math.max(size.x, size.y, size.z)
    if (!Number.isFinite(modelScale) || modelScale <= 0) {
      return
    }

    // Local geometry is expressed in meters. Keep the sampling radius
    // proportional to the part instead of GTAO's room-scale default.
    this.ambientOcclusionRadius = Math.max(modelScale * 0.5, 0.00001)
    if (this.ambientOcclusionPipeline) {
      this.configureAmbientOcclusion(
        this.ambientOcclusionPipeline.aoPass,
        this.ambientOcclusionPipeline.denoisePass
      )
    }
  }

  // Draws at the viewport's size, or at the given size in device pixels.
  private render(size?: FrameSize) {
    const { camera, gpu } = this
    if (!camera || !gpu) {
      return
    }
    const { renderer, scene, selectionHighlightRenderer } = gpu
    const width = size?.width ?? this.container.clientWidth
    const height = size?.height ?? this.container.clientHeight
    if (width === 0 || height === 0) {
      return
    }
    const pixelRatio = size
      ? 1
      : getViewportPixelRatio(
          width,
          height,
          window.devicePixelRatio,
          this.viewportOptions.resolutionScale,
          gpu.maxTextureDimension
        )
    if (
      renderer.domElement.width !== Math.floor(width * pixelRatio) ||
      renderer.domElement.height !== Math.floor(height * pixelRatio) ||
      renderer.getPixelRatio() !== pixelRatio
    ) {
      renderer.setDrawingBufferSize(width, height, pixelRatio)
    }

    const baseRendered = selectionHighlightRenderer.beginFrame(
      this.baseRenderDirty
    )
    if (baseRendered) {
      // Thumbnails are drawn without SSAO. Its scene, AO and denoise passes
      // draw into textures that three.js redraws only once per animation
      // frame. A thumbnail is drawn in the same frame as the viewport, but at
      // another size and with a wider camera, so SSAO would reuse the
      // viewport's textures: the thumbnail would show the viewport's view
      // stretched to its own size.
      // Making the passes redraw on every render does not work: the scene pass
      // then also redraws inside the AO pass's own render, which clears to
      // opaque white, and the viewport background turns white. Starting a new
      // animation frame for the thumbnail works, but only through three.js's
      // private renderer._nodes which felt wrong to call.
      // Simplest solution: draw thumbnails without SSAO. If this becomes a problem
      // revisit the above options.
      if (
        !this.settings.enableSSAO ||
        size ||
        this.viewportOptions.opacity < 100 ||
        this.viewportOptions.style === 'wireframe'
      ) {
        renderer.render(scene, camera)
      } else {
        if (this.ambientOcclusionPipeline?.camera !== camera) {
          this.disposeAmbientOcclusionPipeline()

          // GTAO expects a regular depth texture. The renderer itself can keep
          // using MSAA, but this intermediate pass must be single-sampled.
          const scenePass = pass(scene, camera, {
            samples: 0,
          })
          if (LOCAL_WEBGPU_GTAO_USE_NORMAL_MRT) {
            scenePass.setMRT(
              mrt({
                output,
                normal: normalView,
              })
            )
          }
          const scenePassColor = LOCAL_WEBGPU_GTAO_USE_NORMAL_MRT
            ? scenePass.getTextureNode('output')
            : scenePass.getTextureNode()
          const scenePassNormal = LOCAL_WEBGPU_GTAO_USE_NORMAL_MRT
            ? scenePass.getTextureNode('normal')
            : null
          const scenePassDepth = scenePass.getTextureNode('depth')
          const aoPass = (ao as CreateAmbientOcclusion)(
            scenePassDepth,
            scenePassNormal,
            camera
          )
          aoPass.resolutionScale = 0.5
          const denoisePass = LOCAL_WEBGPU_GTAO_USE_DENOISE
            ? denoise(
                aoPass.getTextureNode(),
                scenePassDepth,
                scenePassNormal as Node,
                camera
              )
            : null
          const denoiseNoiseTexture = denoisePass
            ? (denoisePass.noiseNode as unknown as { value: Texture }).value
            : null
          this.configureAmbientOcclusion(aoPass, denoisePass)

          const pipeline = new RenderPipeline(renderer)
          pipeline.outputColorTransform = false
          // DenoiseNode produces vec4, but the bundled declaration omits its
          // TempNode output type.
          const aoOutput = denoisePass
            ? vec4(denoisePass as unknown as Node<'vec4'>)
            : aoPass.getTextureNode()
          // Preserve some indirect light even at maximum occlusion while leaving
          // enough contrast to make the setting visibly effective.
          const ambientOcclusion = aoOutput.r.mul(0.8).add(0.2)
          pipeline.outputNode = scenePassColor.mul(
            vec4(vec3(ambientOcclusion), 1)
          )

          this.ambientOcclusionPipeline = {
            camera,
            pipeline,
            scenePass,
            aoPass,
            denoisePass,
            denoiseNoiseTexture,
          }
        }

        this.ambientOcclusionPipeline.pipeline.render()
      }
      selectionHighlightRenderer.cacheBaseFrame()
      this.baseRenderDirty = false
    }

    selectionHighlightRenderer.render(camera)
  }

  /** Debug/E2E snapshot in CSS viewport pixels, using the same camera and picker as clicks. */
  async getProjectedEntities() {
    const camera = this.camera
    const canvas = this.gpu?.renderer.domElement
    if (
      !camera ||
      !canvas ||
      !this.currentModel ||
      !this.isLoadedSceneCurrent() ||
      this.host.executing.peek()
    )
      return []
    const version = this.executionVersion
    const rect = canvas.getBoundingClientRect()
    this.currentModel.updateWorldMatrix(true, true)
    camera.updateMatrixWorld(true)
    const entities = []
    for (const [id, [object]] of this.targetsByEntityId) {
      const kind =
        typeof object.userData.edgeUuid === 'string' ? 'edge' : 'face'
      object.updateWorldMatrix(true, false)
      const point = getEntityPoint(object.geometry, kind)
      if (!point) continue
      point.applyMatrix4(object.matrixWorld)
      const pointOnScreen = projectEntityPoint(point, camera, rect)
      if (!pointOnScreen) continue
      // The test mouse helpers use integer CSS pixels. Try the coordinates
      // surrounding the projected center so rasterization does not hide a thin edge.
      const xs = [
        ...new Set([Math.floor(pointOnScreen.x), Math.ceil(pointOnScreen.x)]),
      ]
      const ys = [
        ...new Set([Math.floor(pointOnScreen.y), Math.ceil(pointOnScreen.y)]),
      ]
      const candidates = xs
        .flatMap((x) => ys.map((y) => ({ x, y })))
        .filter(
          ({ x, y }) =>
            x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
        )
        .sort(
          (a, b) =>
            (a.x - pointOnScreen.x) ** 2 +
            (a.y - pointOnScreen.y) ** 2 -
            ((b.x - pointOnScreen.x) ** 2 + (b.y - pointOnScreen.y) ** 2)
        )
      let projected = candidates[0]
      if (!projected) continue
      let visible = false
      for (const candidate of candidates) {
        const result = await this.gpu?.integerIdPicker.pick({
          x: candidate.x - rect.left,
          y: candidate.y - rect.top,
          streamWidth: rect.width,
          streamHeight: rect.height,
          camera,
        })
        if (this.disposed || version !== this.executionVersion || result?.stale)
          return []
        if (result?.target === object) {
          projected = candidate
          visible = true
          break
        }
      }
      entities.push({
        id,
        kind,
        ...projected,
        // This means the real picker would select this entity at its representative point.
        visible,
      })
    }
    return entities
  }

  /**
   * Draws a frame and lends out the canvas. It can only be read during the
   * call: WebGPU and WebGL canvases read back blank in a later task.
   *
   * With a size, the frame has that many pixels and shows at least what the
   * viewport shows. The viewport is drawn again before the browser paints.
   */
  readFrame<T>(read: (canvas: HTMLCanvasElement) => T, size?: FrameSize) {
    const { camera, gpu } = this
    if (!gpu || !camera) return undefined
    if (size) {
      widenCameraToAspect(camera, size.width / size.height)
      this.baseRenderDirty = true
      try {
        this.render(size)
        return read(gpu.renderer.domElement)
      } finally {
        // Copies the shared camera again, which also marks the base dirty.
        this.updateLocalCamera()
        this.render()
      }
    }
    this.render()
    return read(gpu.renderer.domElement)
  }

  private scheduleRender() {
    if (this.disposed || !this.camera || this.animationFrameId !== -1) {
      return
    }

    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = -1
      if (this.disposed || !this.camera) {
        return
      }

      this.render()
    })
  }

  private invalidateBaseRender() {
    this.baseRenderDirty = true
    this.scheduleRender()
  }

  /**
   * What zoom to fit frames, as in the engine: the loaded model and the
   * visible planes. In the engine's world: Z up, in mm.
   */
  getFitBounds(): Box3 | undefined {
    const bounds = this.gpu?.planeRenderer.getVisibleBounds() ?? new Box3()
    if (this.currentModel) {
      this.currentModel.updateWorldMatrix(true, true)
      this.currentModel.traverseVisible((object) => {
        if (!(object instanceof Mesh)) return
        object.geometry.computeBoundingBox()
        if (object.geometry.boundingBox) {
          bounds.union(
            gltfToEngineBounds(
              object.geometry.boundingBox
                .clone()
                .applyMatrix4(object.matrixWorld)
            )
          )
        }
      })
    }
    return bounds.isEmpty() ? undefined : bounds
  }

  /**
   * What center view on selection centers on, as in the engine: the selected
   * entities. In the engine's world: Z up, in mm.
   */
  getSelectionBounds(): Box3 | undefined {
    const bounds = new Box3()
    for (const target of this.getSelectedTargets()) {
      bounds.union(new Box3().setFromObject(target))
    }
    return bounds.isEmpty() ? undefined : gltfToEngineBounds(bounds)
  }

  private clearModel() {
    const { gpu } = this
    this.loadedSceneGeneration = null
    this.engineEntityReferences.clear()
    this.bodyFacesById.clear()
    gpu?.integerIdPicker.clearModel()
    gpu?.selectionHighlightRenderer.clearModel()
    this.modelSectionGroup.removeFromParent()
    this.sectionBounds.makeEmpty()
    if (this.currentModel) {
      this.currentModel.removeFromParent()
      gpu?.edgeRenderer.removeFromParent()
      gpu?.sketchLineRenderer.removeFromParent()
      disposeObject3D(this.currentModel)
      this.currentModel = null
    }

    this.invalidateBaseRender()
  }

  private async initialize() {
    const { host } = this
    const { container } = this

    const hasNavigatorGpu = typeof navigator !== 'undefined' && !!navigator.gpu
    const adapter = hasNavigatorGpu
      ? await navigator.gpu.requestAdapter({
          powerPreference: 'high-performance',
        })
      : null

    // Without a WebGPU device, three.js renders the same scene through WebGL 2.
    const device = adapter
      ? await adapter
          .requestDevice({
            requiredLimits: {
              // TODO: Chunk geometry so large models work on
              // adapters with lower per-buffer limits.
              maxBufferSize: adapter.limits.maxBufferSize,
            },
          })
          .catch((error: unknown) => {
            reportRejection(error)
            return undefined
          })
      : undefined
    if (this.disposed) {
      device?.destroy()
      return
    }

    const renderer = new WebGPURenderer({
      antialias: true,
      alpha: false,
      device,
    })
    // Covers both backends: a lost WebGPU device and a lost WebGL 2 context.
    // Keep three.js's default handler, which marks the renderer as lost.
    const defaultOnDeviceLost = renderer.onDeviceLost.bind(renderer)
    renderer.onDeviceLost = (info) => {
      defaultOnDeviceLost(info)
      this.handleDeviceLost(info)
    }
    await renderer.init()
    if (this.disposed) {
      await renderer.dispose()
      device?.destroy()
      return
    }
    renderer.toneMapping = NeutralToneMapping
    renderer.toneMappingExposure = 1
    const context = renderer.getContext()
    const maxTextureDimension =
      typeof WebGL2RenderingContext !== 'undefined' &&
      context instanceof WebGL2RenderingContext
        ? Math.min(
            Number(context.getParameter(context.MAX_TEXTURE_SIZE)),
            Number(context.getParameter(context.MAX_RENDERBUFFER_SIZE))
          )
        : (device?.limits.maxTextureDimension2D ?? 8192)
    renderer.domElement.className =
      'absolute inset-0 h-full w-full pointer-events-none'
    container.appendChild(renderer.domElement)

    const scene = new Scene()
    scene.background = null
    const envMapLoader = new EnvMapLoader(renderer, device)
    const hdrEnvMapUrl = HDR_ENV_MAP_URL?.trim()
    if (hdrEnvMapUrl) {
      try {
        await envMapLoader.loadHdr(scene, hdrEnvMapUrl)
      } catch {
        await envMapLoader.loadDefault(scene)
      }
    } else {
      await envMapLoader.loadDefault(scene)
    }
    if (this.disposed) {
      envMapLoader.dispose()
      renderer.domElement.remove()
      await renderer.dispose()
      device?.destroy()
      return
    }

    const { theme, shouldHighlightEdges } = this.settings
    // Keep reference planes separate from the GLB and its fit-to-model bounds.
    const planeRenderer = new PlaneRenderer(theme)
    planeRenderer.addTo(scene)
    const integerIdPicker = new IntegerIdPicker(renderer)
    integerIdPicker.setEdgesVisible(shouldHighlightEdges)
    this.gpu = {
      renderer,
      maxTextureDimension,
      device: device ?? null,
      scene,
      envMapLoader,
      edgeRenderer: new EdgeRenderer(shouldHighlightEdges),
      sketchLineRenderer: new EdgeRenderer(
        true,
        getSketchLineColor(theme),
        LOCAL_WEBGPU_SKETCH_LINE_WIDTH_PX
      ),
      planeRenderer,
      integerIdPicker,
      selectionHighlightRenderer: new SelectionHighlightRenderer(
        renderer,
        this.backgroundColor
      ),
    }

    this.applyViewportOptions()
    // updateLocalCamera() below matches this to the shared camera.
    this.camera = new PerspectiveCamera()
    this.disposers.push(
      host.sceneInfra.camControls.cameraChange.add(this.updateLocalCamera)
    )

    this.rebuildSelectionTargets()
    const removeSelectionHandler =
      host.commands.setLocalSelectionCommandHandler((command, context) => {
        if (this.disposed) return null
        if (
          command.type === 'modeling_cmd_req' &&
          (command.cmd.type === 'select_entity' ||
            command.cmd.type === 'select_add' ||
            command.cmd.type === 'select_remove' ||
            command.cmd.type === 'select_clear')
        ) {
          this.syncSelectionFromEngine().catch(reportRejection)
          return null
        }
        return this.settings.pickingEnabled
          ? this.handleLocalSelectionCommand(command, context)
          : null
      })
    const inputCanvas = host.sceneInfra.camControls.domElement
    this.pointerOverCanvas = inputCanvas.matches(':hover')
    const onEnter = () => {
      this.pointerOverCanvas = true
    }
    const onLeave = () => {
      this.pointerOverCanvas = false
      this.clearHover()
    }
    inputCanvas.addEventListener('pointerenter', onEnter)
    inputCanvas.addEventListener('pointerleave', onLeave)
    this.disposers.push(() => {
      removeSelectionHandler()
      inputCanvas.removeEventListener('pointerenter', onEnter)
      inputCanvas.removeEventListener('pointerleave', onLeave)
    })

    this.updateLocalCamera()
    const resizeObserver = new ResizeObserver(this.updateLocalCamera)
    resizeObserver.observe(container)
    this.disposers.push(() => resizeObserver.disconnect())

    this.scheduleRender()

    this.container.style.opacity = '1'
    // Models load on ExecutionDone, which this renderer misses if the execution
    // finished before it was created or while initialize() waited for the GPU.
    // So load the current file's finished execution here, in case ExecutionDone
    // was missed. A file switch empties execState, so an execution from the
    // previous file doesn't count.
    if (
      !host.executing.peek() &&
      host.currentSceneGeneration() !== null &&
      !host.hasErrors()
    ) {
      void this.refreshModel().catch(reportRejection)
    } else if (!host.executing.peek()) {
      this.onModelLoadSettled?.()
    }
  }

  private readonly onExecutionDone = (event: Event) => {
    if (this.disposed || this.host.executing.peek()) return

    const { detail } = event as CustomEvent<SceneExecutionDoneDetail>
    if (!detail.successful) {
      if (!this.isLoadedSceneCurrent()) {
        // The failed run replaced the scene, so its old geometry is stale.
        this.clearModel()
        this.gpu?.planeRenderer.updateOffsetPlanes(this.host.artifacts())
      }
      this.rebuildSelectionTargets()
      this.syncPlaneScale()
      this.onModelLoadSettled?.()
      return
    }

    // A cache hit leaves the engine scene as it was, so keep the loaded model.
    if (this.isLoadedSceneCurrent()) {
      this.onModelLoadSettled?.()
      return
    }

    // Before initialization finishes, initialize() loads the completed scene.
    if (this.gpu) {
      void this.refreshModel().catch(reportRejection)
    }
  }

  private async refreshModel() {
    // Loads only start between executions, so two loads never overlap without
    // an execution starting in between.
    const version = this.executionVersion

    // Read the signal instead of execState, because the signal updates
    // together with the artifact graph this load reads.
    const sceneGeneration = this.host.sceneGeneration.peek()

    const isCurrent = () => !this.disposed && version === this.executionVersion
    // Reference planes do not depend on a successful GLB export.
    this.gpu?.planeRenderer.updateOffsetPlanes(this.host.artifacts())
    this.syncPlaneScale()
    // An empty execution has no GLB to export, but must clear the old model.
    if (this.host.artifacts().size === 0) {
      this.clearModel()
      this.loadedSceneGeneration = sceneGeneration
      this.rebuildSelectionTargets()
      this.resetCameraIfPending()
      this.onModelLoadSettled?.(true)
      return
    }
    this.rebuildSelectionTargets()
    try {
      const files = await this.host.exportModel({
        type: 'gltf',
        storage: 'binary',
        presentation: 'compact',
        // Deployed engines still need this flag to link exported geometry to the artifact graph.
        // It also stands in for the `geometry_uuids` extra, which older engines reject.
        include_uuids: true,
        extras: ['sketches', 'regions'],
      })
      if (!isCurrent()) return

      const file = files?.find((file) => file.name.endsWith('.glb'))
      if (!file) {
        this.handleModelLoadError(
          new Error('Engine export returned no GLB file.')
        )
        return
      }

      const bytes = new Uint8Array(file.contents)
      const gltf = (await this.gltfLoader.parseAsync(
        bytes.buffer,
        ''
      )) as KITTYCAD_GLTF
      console.log('local renderer glTF', gltf.parser.json, gltf)
      gltf.scene ??= new Group() // A sketch-only model has no scene
      fillEmptyBrepArrays(gltf)

      if (!isCurrent()) {
        // This is an outdated load, a new one is in progress already.
        disposeObject3D(gltf.scene)
        return
      }

      this.clearModel()

      assignFaceUuids(gltf)
      this.currentModel = gltf.scene
      const { gpu } = this
      this.modelSectionGroup.add(gltf.scene)
      gpu?.scene.add(this.modelSectionGroup)

      gpu?.edgeRenderer.buildEdges(gltf, getBodyEdges(gltf))
      gpu?.edgeRenderer.addTo(gltf.scene)
      gpu?.sketchLineRenderer.buildEdges(gltf, getSketchSegmentEdges(gltf))
      gpu?.sketchLineRenderer.addTo(gltf.scene)
      for (const mesh of createRegionMeshes(gltf, this.host.artifacts())) {
        gltf.scene.add(mesh)
      }

      this.sectionBounds.setFromObject(gltf.scene)
      this.applyViewportOptions()
      this.rebuildSelectionTargets()
      const bounds = new Box3().setFromObject(gltf.scene)
      this.updateAmbientOcclusionScale(bounds)
      this.resetCameraIfPending()
      this.invalidateBaseRender()
      this.loadedSceneGeneration = sceneGeneration
      toast.dismiss(MODEL_LOAD_ERROR_TOAST_ID)
      this.onModelLoadSettled?.(true)
    } catch (error) {
      if (isCurrent()) this.handleModelLoadError(error)
    }
  }

  private handleModelLoadError(error: unknown) {
    this.clearModel()
    this.rebuildSelectionTargets()
    console.error('[LocalRenderer] GLB model load failed', error)
    reportRejection(error)
    toast.error('Failed to load the model for display.', {
      id: MODEL_LOAD_ERROR_TOAST_ID,
    })
    this.onModelLoadSettled?.()
  }

  /**
   * The reset after an execution, once its model is on screen. A failed
   * execution loads no model, so its reset waits for the next one.
   */
  resetCameraAfterModelLoad() {
    if (this.isLoadedSceneCurrent()) {
      this.resetCamera()
    } else {
      this.cameraResetPending = true
    }
  }

  /**
   * Also stands in for the reset after opening a project, which local mode
   * skips because the model is not loaded yet.
   */
  private resetCameraIfPending() {
    if (this.cameraResetPending) {
      this.cameraResetPending = false
      this.resetCamera()
    }
  }

  private resetCamera() {
    resetCameraPosition({
      sceneInfra: this.host.sceneInfra,
      settingsActor: this.host.settingsActor,
    }).catch(reportRejection)
  }
}

// The glTF materials are single-sided, but the engine draws the backs of faces
// in the backface color, which shows on open surfaces.
// This makes GLTFLoaderbuild doubleSided materials.
function backfaceColorPlugin(backfaceColor: Node<'color'>): GLTFLoaderPlugin {
  return {
    name: 'zoo_backface_color',
    getMaterialType: () => MeshStandardNodeMaterial,
    extendMaterialParams: (_materialIndex, params) => {
      params.side = DoubleSide
      params.colorNode = select(
        frontFacing,
        color(materialColor),
        backfaceColor
      )
      return null
    },
  }
}

function disposeObject3D(root: Object3D) {
  // GLTFLoader can share these resources between multiple nodes.
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    if ('geometry' in object && object.geometry instanceof BufferGeometry) {
      geometries.add(object.geometry)
    }

    if (!('material' in object)) return
    const objectMaterials = (
      isArray(object.material) ? object.material : [object.material]
    ).filter((material): material is Material => material instanceof Material)
    for (const material of objectMaterials) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value)
      }
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  textures.forEach((texture) => texture.dispose())
  materials.forEach((material) => material.dispose())
}

function convertEngineWorldVectorToGltfWorld(
  vector: Vector3,
  scale = 1
): Vector3 {
  return new Vector3(vector.x * scale, vector.z * scale, -vector.y * scale)
}

/** The engine omits empty B-rep arrays, e.g. solids in a sketch-only model. */
function fillEmptyBrepArrays(gltf: KITTYCAD_GLTF) {
  const extensions = gltf.userData.gltfExtensions
  const brep: Partial<KITTYCAD_GLTF_BREP> | undefined =
    extensions?.KITTYCAD_boundary_representation
  if (!extensions || !brep) return
  extensions.KITTYCAD_boundary_representation = {
    solids: [],
    shells: [],
    faces: [],
    loops: [],
    edges: [],
    vertices: [],
    surfaces: [],
    curves3D: [],
    ...brep,
  }
}

/** Attach B-rep face IDs to the corresponding glTF primitive meshes. */
export function assignFaceUuids(gltf: KITTYCAD_GLTF) {
  const brep = gltf.userData.gltfExtensions?.KITTYCAD_boundary_representation
  if (!brep) {
    console.warn(
      '[LocalRenderer] The model has no B-rep data, so its faces and edges cannot be selected.'
    )
    return
  }
  const faceIdsBySolidMesh = new Map<number, number[]>()
  const bodyMeshIndices = new Set(brep.solids.map((solid) => solid.mesh))

  for (const solid of brep.solids) {
    const faceIds = solid.shells.flatMap(
      ([shellIndex]) =>
        brep.shells[shellIndex]?.faces.map(([faceIndex]) => faceIndex) ?? []
    )
    const primitiveCount =
      gltf.parser.json.meshes?.[solid.mesh]?.primitives?.length ?? 0
    if (faceIds.length !== primitiveCount) {
      console.warn(
        'B-rep face count does not match glTF mesh primitive count; face UUID assignment may be incorrect.',
        {
          meshIndex: solid.mesh,
          faceCount: faceIds.length,
          primitiveCount,
        }
      )
    }
    faceIdsBySolidMesh.set(solid.mesh, faceIds)
  }

  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const association: (GLTFReference & { primitives?: number }) | undefined =
      gltf.parser.associations.get(object)
    const meshIndex = association?.meshes
    const primitiveIndex = association?.primitives
    if (meshIndex === undefined || primitiveIndex === undefined) return

    // Each solid has its own glTF mesh, so this groups the faces by body.
    object.userData.bodyMeshIndex = meshIndex
    object.userData.isBrep = bodyMeshIndices.has(meshIndex)
    const faceIndex = faceIdsBySolidMesh.get(meshIndex)?.[primitiveIndex]
    const face = faceIndex === undefined ? undefined : brep.faces[faceIndex]
    const uuid = face?.extras?.KITTYCAD?.uuid
    if (uuid) object.userData.faceUuid = uuid
  })
}
