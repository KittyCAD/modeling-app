import {
  type BufferGeometry,
  type Camera,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
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
import type { EdgeSelectionTarget } from '@src/clientSideScene/localRenderer/EdgeRenderer'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { attribute, outputStruct, uint, varying } from 'three/tsl'
import {
  Line2NodeMaterial,
  NodeMaterial,
  RenderTarget,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu'

const SELECTION_LINE_WIDTH_AT_REFERENCE_PX = 24
const SELECTION_LINE_WIDTH_REFERENCE_VIEWPORT_PX = 2048

export type IntegerIdPickerGeometryStats = {
  vertexCount: number
  faceCount: number
  faceTriangleCount: number
  surfaceMeshCount: number
  edgeCount: number
  edgeSegmentCount: number
  sketchCount: number
  sketchSegmentCount: number
  regionCount: number
  regionTriangleCount: number
  vertexBufferBytes: number
  indexBufferBytes: number
  edgeSegmentBufferBytes: number
}

export type IntegerIdPickerDiagnostics = {
  idSceneBuildDurationMs: number
  idBufferWasRendered: boolean
  idBufferRenderSubmissionDurationMs: number
  idBufferReadbackDurationMs: number
  idBufferTotalDurationMs: number
  idBufferWidth: number
  idBufferHeight: number
  idBufferPixelCount: number
  readbackPixelX: number
  readbackPixelY: number
  selectionId: number
  stale: boolean
  geometry: IntegerIdPickerGeometryStats
}

export type IntegerIdPickResult = {
  target: Mesh | null
  diagnostics: IntegerIdPickerDiagnostics
}

export class IntegerIdPicker {
  private readonly renderer: WebGPURenderer
  private readonly scene = new Scene()
  private readonly drawingBufferSize = new Vector2()
  private readonly geometries: BufferGeometry[] = []
  private readonly materials = new Set<Material>()
  private readonly sourceByProxy = new Map<Mesh, Mesh>()
  private targetById: Array<Mesh | null> = [null]
  private renderTarget: RenderTarget | null = null
  private edgeObject: LineSegments2 | null = null
  private edgesVisible = true
  private geometryStats: IntegerIdPickerGeometryStats | null = null
  private idSceneBuildDurationMs = 0
  private dirty = true
  private version = 0

  constructor(renderer: WebGPURenderer) {
    this.renderer = renderer
    this.scene.background = new Color(0)
  }

  // Share geometry; only the small ID materials and scene nodes are owned here.
  setTargets(
    targets: Mesh[],
    occluder: Object3D | null,
    edges?: { source: LineSegments2; targets: EdgeSelectionTarget[] }
  ) {
    this.clearModel()
    const startedAt = performance.now()
    const stats: IntegerIdPickerGeometryStats = {
      vertexCount: 0,
      faceCount: targets.length,
      faceTriangleCount: 0,
      surfaceMeshCount: 0,
      edgeCount: 0,
      edgeSegmentCount: 0,
      sketchCount: 0,
      sketchSegmentCount: 0,
      regionCount: 0,
      regionTriangleCount: 0,
      vertexBufferBytes: 0,
      indexBufferBytes: 0,
      edgeSegmentBufferBytes: 0,
    }
    const createMaterial = (id: number) => {
      const material = new NodeMaterial()
      // Preserve integer output instead of NodeMaterial's default vec4 conversion.
      material.fragmentNode = outputStruct(uint(id))
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
      stats.surfaceMeshCount++
      const positions = source.geometry.getAttribute('position')
      stats.vertexCount += positions?.count ?? 0
      stats.faceTriangleCount +=
        (source.geometry.index?.count ?? positions?.count ?? 0) / 3
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
      const segmentCount =
        edges.source.geometry.getAttribute('instanceStart')?.count ?? 0
      const selectionIds = new Uint32Array(segmentCount)
      for (const edge of edges.targets) {
        const id = this.targetById.push(edge.object) - 1
        for (const { firstSegment, segmentCount: count } of edge.ranges) {
          selectionIds.fill(id, firstSegment, firstSegment + count)
        }
      }
      if (segmentCount > 0) {
        const geometry = new LineSegmentsGeometry()
        for (const name of ['instanceStart', 'instanceEnd']) {
          const sourceAttribute = edges.source.geometry.getAttribute(name)
          if (sourceAttribute) geometry.setAttribute(name, sourceAttribute)
        }
        geometry.instanceCount = segmentCount
        geometry.boundingBox = edges.source.geometry.boundingBox
        geometry.boundingSphere = edges.source.geometry.boundingSphere
        geometry.setAttribute(
          'selectionId',
          new InstancedBufferAttribute(selectionIds, 1)
        )
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
        const selectionId = varying(
          attribute('selectionId', 'uint') as unknown as Node<'uint'>
        ) as unknown as Node<'uint'>
        material.outputNode = outputStruct(uint(selectionId)) as Node
        const object = new LineSegments2(geometry, material)
        object.frustumCulled = false
        object.renderOrder = 2
        object.visible = this.edgesVisible
        this.edgeObject = object
        this.sourceByProxy.set(object, edges.source)
        this.geometries.push(geometry)
        this.materials.add(material)
        this.scene.add(object)
      }
      stats.edgeCount = edges.targets.length
      stats.edgeSegmentCount = segmentCount
      stats.edgeSegmentBufferBytes = selectionIds.byteLength
    }
    this.geometryStats = stats
    this.idSceneBuildDurationMs = performance.now() - startedAt
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
      !this.geometryStats ||
      streamWidth <= 0 ||
      streamHeight <= 0 ||
      this.scene.children.length === 0
    ) {
      return null
    }

    const startedAt = performance.now()
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
    const geometryStats = this.geometryStats
    const idBufferWasRendered = this.dirty

    const renderStartedAt = performance.now()
    if (idBufferWasRendered) {
      this.renderIdBuffer(target, camera, streamWidth)
    }
    const idBufferRenderSubmissionDurationMs =
      performance.now() - renderStartedAt

    const readbackStartedAt = performance.now()
    const pixels = await this.renderer.readRenderTargetPixelsAsync(
      target,
      readbackPixelX,
      readbackPixelY,
      1,
      1
    )
    const idBufferReadbackDurationMs = performance.now() - readbackStartedAt
    const selectionId = Number(pixels[0] ?? 0)
    const stale = version !== this.version

    return {
      target: stale ? null : (targetById[selectionId] ?? null),
      diagnostics: {
        idSceneBuildDurationMs: this.idSceneBuildDurationMs,
        idBufferWasRendered,
        idBufferRenderSubmissionDurationMs,
        idBufferReadbackDurationMs,
        idBufferTotalDurationMs: performance.now() - startedAt,
        idBufferWidth: target.width,
        idBufferHeight: target.height,
        idBufferPixelCount: target.width * target.height,
        readbackPixelX,
        readbackPixelY,
        selectionId,
        stale,
        geometry: geometryStats,
      },
    }
  }

  clearModel() {
    this.sourceByProxy.clear()
    this.scene.clear()
    this.edgeObject = null
    this.targetById = [null]
    this.geometryStats = null
    this.geometries.forEach((geometry) => {
      geometry.dispose()
    })
    this.geometries.length = 0
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
        format: RedIntegerFormat,
        type: UnsignedIntType,
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
