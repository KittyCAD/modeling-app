import {
  type Camera,
  Color,
  DoubleSide,
  type Material,
  Mesh,
  NearestFilter,
  NoBlending,
  type Object3D,
  RedIntegerFormat,
  Scene,
  UnsignedIntType,
  Vector2,
} from 'three'
import {
  type EdgeSelectionTarget,
  EdgeTargetType,
  SELECTION_INDEX_ATTRIBUTE,
} from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { EdgeGrowthPass } from '@src/clientSideScene/localRenderer/EdgeGrowthPass'
import {
  colorizePickBuffer,
  type PickBufferSnapshot,
} from '@src/clientSideScene/localRenderer/pickBufferDebug'
import {
  selectionTargetId,
  selectionTypeTag,
} from '@src/clientSideScene/localRenderer/selectionId'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import {
  attribute,
  float,
  outputStruct,
  select,
  uint,
  uniform,
  varying,
  vec4,
} from 'three/tsl'
import {
  Line2NodeMaterial,
  NodeMaterial,
  RenderTarget,
  WebGLBackend,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu'

// Uses a material to draw the selection lines with this width
const SELECTION_LINE_WIDTH_PX = 24

// This is the line width for the draw buffer, not the radius used for edge
// selection. The radius is used to search for these lines
const VISIBLE_EDGE_LINE_WIDTH_PX = 2

// The ID of whatever can't be picked: occluders, line segments that aren't
// targets, and the background, which clears to 0. targetById[0] is null to match.
const NO_TARGET_ID = 0

type LineTargets = { source: LineSegments2; targets: EdgeSelectionTarget[] }

export type IntegerIdPickResult = {
  target: Mesh | null
  // The targets changed while the ID was being read back.
  stale: boolean
}

export class IntegerIdPicker {
  private readonly renderer: WebGPURenderer
  private readonly scene = new Scene()
  private readonly drawingBufferSize = new Vector2()
  private readonly materials = new Set<Material>()
  private readonly sourceByProxy = new Map<Mesh, Mesh>()
  private targetById: Array<Mesh | null> = [null]
  private renderTarget: RenderTarget | null = null

  private growthPass: EdgeGrowthPass | null = null

  private edgeObject: LineSegments2 | null = null
  private edgesVisible = true
  private dirty = true
  private version = 0

  constructor(renderer: WebGPURenderer) {
    this.renderer = renderer
    this.scene.background = new Color(0)
  }

  // three.js can neither clear nor read back an integer render target on its
  // WebGL backend, so there the ID is packed into the bytes of an RGBA one.
  private get packsIdsIntoColor() {
    return this.renderer.backend instanceof WebGLBackend
  }

  private idOutput(id: Node<'uint'>) {
    if (!this.packsIdsIntoColor) {
      // Preserve integer output instead of NodeMaterial's default vec4 conversion.
      return outputStruct(id)
    }
    const byte = (shift: number) =>
      float(id.shiftRight(uint(shift)).bitAnd(uint(255))).div(255)
    return vec4(byte(0), byte(8), byte(16), 1)
  }

  // Each allowed target gets a copy of its mesh, which draws that target's unique ID.
  // Other model meshes all share NO_TARGET_ID, they block picks behind them but can't be picked themselves. Excluded regions are skipped, because they're invisible.
  // Edges and sketch lines are added only if they were passed in depending on the filter
  // Share geometry; only the small ID materials and scene nodes are owned here.
  setTargets(
    targets: Mesh[],
    occluder: Object3D | null,
    edges?: LineTargets,
    sketchLines?: LineTargets
  ) {
    this.clearModel()
    // All meshes share two materials (with and without the region offset), so
    // the ID shader is built once, not per face. The ID is set per proxy mesh,
    // as it is drawn.
    const pickId = uniform(0, 'uint').onObjectUpdate(
      ({ object }) => object?.userData.pickId
    )
    const createMaterial = (isSketchRegion: boolean) => {
      const material = new NodeMaterial()
      material.fragmentNode = this.idOutput(pickId)
      material.side = DoubleSide
      material.blending = NoBlending
      material.toneMapped = false
      if (isSketchRegion) {
        // A region is on the same plane as the face or plane it was sketched on, so
        // without an offset the two z-fight and hover flickers between them.
        material.polygonOffset = true
        material.polygonOffsetFactor = -1
        material.polygonOffsetUnits = -1
      }
      this.materials.add(material)
      return material
    }
    const meshMaterial = createMaterial(false)
    const regionMaterial = createMaterial(true)
    const addMesh = (source: Mesh, id: number) => {
      const proxy = source.clone(false)
      proxy.material =
        source.userData.isSketchRegion === true ? regionMaterial : meshMaterial
      proxy.userData.pickId = id
      proxy.matrixAutoUpdate = false
      this.sourceByProxy.set(proxy, source)
      this.scene.add(proxy)
    }
    const targetSet = new Set(targets)
    // Add "hit blockers" which have NO_TARGET_ID, they cannot be selected but
    // block objects behind them from being selected.
    occluder?.traverseVisible((object) => {
      if (
        object instanceof Mesh &&
        // Lines sit on the faces, so as blockers they'd make clicks near a face's edge miss.
        // Pickable lines are added by addLines: same geometry, drawn wide with their IDs.
        !(object instanceof LineSegments2) &&
        // Regions aren't drawn, so they mustn't block what's visible behind them
        !object.userData.isSketchRegion &&
        // already pickable, the next loop will add it, no need to add it twice.
        !targetSet.has(object)
      ) {
        addMesh(object, NO_TARGET_ID)
      }
    })
    for (const target of targets) {
      addMesh(target, this.targetById.push(target) - 1)
    }
    if (edges) {
      this.edgeObject = this.addLines(
        edges,
        VISIBLE_EDGE_LINE_WIDTH_PX,
        EdgeTargetType.BodyEdge
      )
      if (this.edgeObject) {
        this.edgeObject.visible = this.edgesVisible
      }
    }
    if (sketchLines) {
      this.addLines(
        sketchLines,
        SELECTION_LINE_WIDTH_PX,
        EdgeTargetType.SketchLine
      )
    }
  }

  // One batch of lines, each segment drawn with its target ID. The lines are
  // drawn from the source's geometry, which is not ours to dispose: disposing a
  // geometry destroys the GPU buffers of all its attributes.
  private addLines(
    { source, targets }: LineTargets,
    linewidth: number,
    targetType: EdgeTargetType
  ) {
    // The source numbers its targets from 1, in this order.
    const idBeforeFirstTarget = this.targetById.length - 1
    for (const { object } of targets) {
      this.targetById.push(object)
    }
    const segmentCount =
      source.geometry.getAttribute('instanceStart')?.count ?? 0
    if (segmentCount === 0) {
      return null
    }

    const material = new Line2NodeMaterial({
      linewidth,
    })
    material.worldUnits = false
    material.alphaToCoverage = false
    material.depthTest = true
    material.depthWrite = true
    material.transparent = false
    material.blending = NoBlending
    material.toneMapped = false
    // In front of sketch regions too, which are offset in front of faces.
    material.polygonOffset = true
    material.polygonOffsetFactor = -2
    material.polygonOffsetUnits = -2
    const selectionIndex = attribute(
      SELECTION_INDEX_ATTRIBUTE,
      'uint'
    ) as unknown as Node<'uint'>
    // A uniform rather than a constant, so the shader stays the same when the
    // number of targets before this batch changes.
    const selectionId = select(
      selectionIndex.equal(uint(0)),
      uint(NO_TARGET_ID),
      uniform(idBeforeFirstTarget, 'uint')
        .add(selectionIndex)
        .bitOr(uint(selectionTypeTag(targetType)))
    )
    material.outputNode = this.idOutput(varying(selectionId))
    const object = new LineSegments2(source.geometry, material)
    object.frustumCulled = false
    object.renderOrder = 2
    this.sourceByProxy.set(object, source)
    this.materials.add(material)
    this.scene.add(object)
    return object
  }

  setEdgesVisible(visible: boolean) {
    this.edgesVisible = visible
    if (this.edgeObject) {
      this.edgeObject.visible = visible
    }
    this.invalidate()
  }

  invalidate() {
    this.dirty = true
    this.version += 1
  }

  async pick({
    x,
    y,
    streamWidth,
    streamHeight,
    camera,
  }: {
    x: number
    y: number
    streamWidth: number
    streamHeight: number
    camera: Camera
  }): Promise<IntegerIdPickResult | null> {
    if (
      streamWidth <= 0 ||
      streamHeight <= 0 ||
      this.scene.children.length === 0
    ) {
      return null
    }

    const target = this.ensureRenderTarget()

    // [x, y] are the coords in the "stream", which is the video element
    // that still exists even when local renderer is used.
    // getNormalisedCoordinates turns mouse events into stream coordinates, but
    // local renderer is hijacking/getting the command so we have to turn them
    // back into renderer coordinates
    const clampPixel = (value: number, size: number) =>
      Math.max(0, Math.min(value, size - 1))
    const readbackPixelX = clampPixel(
      Math.floor((x / streamWidth) * target.width),
      target.width
    )
    const readbackPixelY = clampPixel(
      Math.floor((y / streamHeight) * target.height),
      target.height
    )

    const version = this.version
    const targetById = this.targetById

    if (this.dirty) {
      this.renderIdBuffer(target, camera)
    }

    const pixels = await this.renderer.readRenderTargetPixelsAsync(
      this.growthPass?.target ?? target,
      readbackPixelX,
      this.packsIdsIntoColor
        ? target.height - 1 - readbackPixelY
        : readbackPixelY,
      1,
      1
    )
    const selectionId = selectionTargetId(
      decodeSelectionId(pixels, 0, this.packsIdsIntoColor)
    )
    const stale = version !== this.version

    return {
      target: stale ? null : (targetById[selectionId] ?? null),
      stale,
    }
  }

  async captureDebugBuffer(camera: Camera): Promise<PickBufferSnapshot | null> {
    if (this.scene.children.length === 0) return null
    const target = this.ensureRenderTarget()
    if (this.dirty) this.renderIdBuffer(target, camera)
    const version = this.version
    const targets = this.targetById
    const grown = await this.renderer.readRenderTargetPixelsAsync(
      this.growthPass?.target ?? target,
      0,
      0,
      target.width,
      target.height
    )
    if (version !== this.version) return null
    const seeds = await this.renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      target.width,
      target.height
    )
    if (version !== this.version) return null
    return {
      width: target.width,
      height: target.height,
      pixels: colorizePickBuffer(
        grown,
        target.width,
        target.height,
        this.packsIdsIntoColor,
        targets
      ),
      seedPixels: colorizePickBuffer(
        seeds,
        target.width,
        target.height,
        this.packsIdsIntoColor,
        targets
      ),
    }
  }

  clearModel() {
    this.sourceByProxy.clear()
    this.scene.clear()
    this.edgeObject = null
    this.targetById = [null]
    this.materials.forEach((material) => {
      material.dispose()
    })
    this.materials.clear()
    this.invalidate()
  }

  dispose() {
    this.clearModel()
    this.renderTarget?.dispose()
    this.growthPass?.dispose()
    this.growthPass = null
    this.renderTarget = null
  }

  private ensureRenderTarget() {
    this.renderer.getDrawingBufferSize(this.drawingBufferSize)
    const width = Math.max(1, Math.floor(this.drawingBufferSize.x))
    const height = Math.max(1, Math.floor(this.drawingBufferSize.y))

    if (!this.renderTarget) {
      this.renderTarget = new RenderTarget(width, height, {
        ...(this.packsIdsIntoColor
          ? {}
          : { format: RedIntegerFormat, type: UnsignedIntType }),
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        depthBuffer: true,
        stencilBuffer: false,
        samples: 0,
      })
      this.renderTarget.texture.name = 'local-renderer-selection-ids'
      this.growthPass = new EdgeGrowthPass(
        this.renderer,
        this.renderTarget,
        width,
        height,
        this.packsIdsIntoColor,
        (id) => this.idOutput(id)
      )
      this.invalidate()
    } else if (
      this.renderTarget.width !== width ||
      this.renderTarget.height !== height
    ) {
      this.renderTarget.setSize(width, height)
      this.growthPass?.resize(width, height)
      this.invalidate()
    }

    return this.renderTarget
  }

  private renderIdBuffer(target: RenderTarget, camera: Camera) {
    for (const [proxy, source] of this.sourceByProxy) {
      source.updateWorldMatrix(true, false)
      proxy.matrix.copy(source.matrixWorld)
      proxy.layers.mask = source.layers.mask
      proxy.visible = true
      source.traverseAncestors((parent) => {
        if (!parent.visible) proxy.visible = false
      })
      proxy.visible &&=
        source.visible && (proxy !== this.edgeObject || this.edgesVisible)
    }
    const previousTarget = this.renderer.getRenderTarget()
    const previousAutoClear = this.renderer.autoClear
    this.renderer.autoClear = true
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, camera)
    if (this.growthPass) {
      const bounds = this.renderer.domElement.getBoundingClientRect()
      this.growthPass.render(bounds.width, bounds.height)
    }
    this.renderer.setRenderTarget(previousTarget)
    this.renderer.autoClear = previousAutoClear
    this.dirty = false
  }
}

function decodeSelectionId(
  pixels: ArrayLike<number>,
  index: number,
  packed: boolean
) {
  return packed
    ? (pixels[index] ?? 0) |
        ((pixels[index + 1] ?? 0) << 8) |
        ((pixels[index + 2] ?? 0) << 16)
    : Number(pixels[index] ?? 0)
}
