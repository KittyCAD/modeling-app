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
  SELECTION_INDEX_ATTRIBUTE,
} from '@src/clientSideScene/localRenderer/EdgeRenderer'
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

const SELECTION_LINE_WIDTH_AT_REFERENCE_PX = 24
const SELECTION_LINE_WIDTH_REFERENCE_VIEWPORT_PX = 2048

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

  // Share geometry; only the small ID materials and scene nodes are owned here.
  setTargets(
    targets: Mesh[],
    occluder: Object3D | null,
    edges?: LineTargets,
    sketchLines?: LineTargets
  ) {
    this.clearModel()
    const createMaterial = (id: number) => {
      const material = new NodeMaterial()
      material.fragmentNode = this.idOutput(uint(id))
      material.side = DoubleSide
      material.blending = NoBlending
      material.toneMapped = false
      this.materials.add(material)
      return material
    }
    const addMesh = (source: Mesh, material: NodeMaterial) => {
      const proxy = source.clone(false)
      proxy.material = material
      proxy.matrixAutoUpdate = false
      this.sourceByProxy.set(proxy, source)
      this.scene.add(proxy)
    }
    const occluderMaterial = createMaterial(0)
    const targetSet = new Set(targets)
    occluder?.traverseVisible((object) => {
      if (
        object instanceof Mesh &&
        !(object instanceof LineSegments2) &&
        !targetSet.has(object)
      ) {
        addMesh(object, occluderMaterial)
      }
    })
    for (const target of targets) {
      const id = this.targetById.push(target) - 1
      addMesh(target, createMaterial(id))
    }
    if (edges) {
      this.edgeObject = this.addLines(edges)
      if (this.edgeObject) {
        this.edgeObject.visible = this.edgesVisible
      }
    }
    if (sketchLines) {
      this.addLines(sketchLines)
    }
  }

  // One batch of lines, each segment drawn with its target ID. The lines are
  // drawn from the source's geometry, which is not ours to dispose: disposing a
  // geometry destroys the GPU buffers of all its attributes.
  private addLines({ source, targets }: LineTargets) {
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
      linewidth: SELECTION_LINE_WIDTH_AT_REFERENCE_PX,
    })
    material.worldUnits = false
    material.alphaToCoverage = false
    material.depthTest = true
    material.depthWrite = true
    material.transparent = false
    material.blending = NoBlending
    material.toneMapped = false
    material.polygonOffset = true
    material.polygonOffsetFactor = -1
    material.polygonOffsetUnits = -1
    const selectionIndex = attribute(
      SELECTION_INDEX_ATTRIBUTE,
      'uint'
    ) as unknown as Node<'uint'>
    // A uniform rather than a constant, so the shader stays the same when the
    // number of targets before this batch changes.
    const selectionId = select(
      selectionIndex.equal(uint(0)),
      uint(0),
      uniform(idBeforeFirstTarget, 'uint').add(selectionIndex)
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
      this.renderIdBuffer(target, camera, streamWidth)
    }

    const pixels = await this.renderer.readRenderTargetPixelsAsync(
      target,
      readbackPixelX,
      // WebGL counts rows from the bottom.
      this.packsIdsIntoColor
        ? target.height - 1 - readbackPixelY
        : readbackPixelY,
      1,
      1
    )
    const selectionId = this.packsIdsIntoColor
      ? pixels[0] | (pixels[1] << 8) | (pixels[2] << 16)
      : Number(pixels[0] ?? 0)
    const stale = version !== this.version

    return {
      target: stale ? null : (targetById[selectionId] ?? null),
      stale,
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
      this.invalidate()
    } else if (
      this.renderTarget.width !== width ||
      this.renderTarget.height !== height
    ) {
      this.renderTarget.setSize(width, height)
      this.invalidate()
    }

    return this.renderTarget
  }

  private renderIdBuffer(
    target: RenderTarget,
    camera: Camera,
    viewportWidth: number
  ) {
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
    const selectionLineWidth =
      (SELECTION_LINE_WIDTH_AT_REFERENCE_PX * viewportWidth) /
      SELECTION_LINE_WIDTH_REFERENCE_VIEWPORT_PX

    this.materials.forEach((material) => {
      if (material instanceof Line2NodeMaterial) {
        material.linewidth = selectionLineWidth
      }
    })

    this.renderer.autoClear = true
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, camera)
    this.renderer.setRenderTarget(previousTarget)
    this.renderer.autoClear = previousAutoClear
    this.dirty = false
  }
}

function clampPixel(value: number, size: number) {
  return Math.max(0, Math.min(size - 1, value))
}
