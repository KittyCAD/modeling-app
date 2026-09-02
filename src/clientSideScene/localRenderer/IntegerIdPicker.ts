import type { LocalRenderPacket } from '@src/clientSideScene/localRenderer/renderPacketBinary'
import { isArray } from '@src/lib/utils'
import {
  BufferAttribute,
  BufferGeometry,
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
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { attribute, outputStruct, uint, varying } from 'three/tsl'
import {
  Line2NodeMaterial,
  MeshBasicNodeMaterial,
  type Node,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu'

const SELECTION_LINE_WIDTH_AT_REFERENCE_PX = 24
const SELECTION_LINE_WIDTH_REFERENCE_VIEWPORT_PX = 2048

export type IntegerIdPickSource =
  | { type: 'primitive'; packetIndex: number }
  | { type: 'edge'; packetIndex: number }
  | { type: 'sketch'; packetIndex: number }
  | { type: 'region'; packetIndex: number }

export type IntegerIdPickTarget = {
  object: Object3D
  source: IntegerIdPickSource
}

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
  trimmedFaceCount: number
  trimLoopCount: number
  trimPointCount: number
  vertexBufferBytes: number
  indexBufferBytes: number
  primitiveIndexBufferBytes: number
  edgeSegmentBufferBytes: number
  trimPointBufferBytes: number
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
  target: IntegerIdPickTarget | null
  diagnostics: IntegerIdPickerDiagnostics
}

type IntegerIdPickerModel = {
  packet: LocalRenderPacket
  targets: IntegerIdPickTarget[]
  surfaceObjects: Mesh[]
  edgeLines: LineSegments2
  geometryStats: IntegerIdPickerGeometryStats
}

type NodeMaterialWithMask = Material & {
  maskNode?: Node<'bool'> | null
}

export class IntegerIdPicker {
  private readonly renderer: WebGPURenderer
  private readonly scene = new Scene()
  private readonly drawingBufferSize = new Vector2()
  private readonly geometries: BufferGeometry[] = []
  private readonly materials = new Set<Material>()
  private targetById: Array<IntegerIdPickTarget | null> = [null]
  private renderTarget: RenderTarget | null = null
  private edgeObject: LineSegments2 | null = null
  private geometryStats: IntegerIdPickerGeometryStats | null = null
  private idSceneBuildDurationMs = 0
  private dirty = true
  private version = 0
  private edgesVisible = true

  constructor(renderer: WebGPURenderer) {
    this.renderer = renderer
    this.scene.background = new Color(0)
  }

  setModel({
    packet,
    targets,
    surfaceObjects,
    edgeLines,
    geometryStats,
  }: IntegerIdPickerModel) {
    const startedAt = performance.now()
    this.clearModel()
    this.geometryStats = geometryStats

    const primitiveIdByPacketIndex = new Map<number, number>()
    const edgeIdByPacketIndex = new Map<number, number>()
    const sketchIdByPacketIndex = new Map<number, number>()
    const regionIdByPacketIndex = new Map<number, number>()

    for (const target of targets) {
      const selectionId = this.targetById.length
      this.targetById.push(target)
      switch (target.source.type) {
        case 'primitive':
          primitiveIdByPacketIndex.set(target.source.packetIndex, selectionId)
          break
        case 'edge':
          edgeIdByPacketIndex.set(target.source.packetIndex, selectionId)
          break
        case 'sketch':
          sketchIdByPacketIndex.set(target.source.packetIndex, selectionId)
          break
        case 'region':
          regionIdByPacketIndex.set(target.source.packetIndex, selectionId)
          break
      }
    }

    this.addSurfaces(packet, surfaceObjects, primitiveIdByPacketIndex)
    this.addEdges(packet, edgeLines, edgeIdByPacketIndex)
    this.addSketches(packet, sketchIdByPacketIndex)
    this.addRegions(targets, regionIdByPacketIndex)
    this.idSceneBuildDurationMs = performance.now() - startedAt
    this.invalidate()
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
    camera: Parameters<WebGPURenderer['render']>[1]
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

  private addSurfaces(
    packet: LocalRenderPacket,
    surfaceObjects: Mesh[],
    idByPacketIndex: Map<number, number>
  ) {
    const idByPrimitiveIndex = new Map<number, number>()
    packet.primitives.forEach((primitive, packetIndex) => {
      const selectionId = idByPacketIndex.get(packetIndex)
      if (selectionId !== undefined) {
        idByPrimitiveIndex.set(primitive.primitiveIndex, selectionId)
      }
    })

    const selectionIds = new Uint32Array(packet.primitiveIndices.length)
    for (
      let vertexIndex = 0;
      vertexIndex < selectionIds.length;
      vertexIndex++
    ) {
      selectionIds[vertexIndex] =
        idByPrimitiveIndex.get(packet.primitiveIndices[vertexIndex]) ?? 0
    }
    const selectionIdAttribute = new BufferAttribute(selectionIds, 1)

    for (const sourceObject of surfaceObjects) {
      const geometry = createGeometryView(sourceObject.geometry)
      geometry.setAttribute('selectionId', selectionIdAttribute)
      const sourceMaterial = getFirstMaterial(sourceObject.material)
      const material = createIdMaterial(
        sourceMaterial?.side,
        (sourceMaterial as NodeMaterialWithMask | null)?.maskNode ?? null
      )
      const object = new Mesh(geometry, material)
      copyWorldTransform(object, sourceObject)
      object.frustumCulled = false
      object.renderOrder = 0
      this.geometries.push(geometry)
      this.materials.add(material)
      this.scene.add(object)
    }
  }

  private addEdges(
    packet: LocalRenderPacket,
    sourceLines: LineSegments2,
    idByPacketIndex: Map<number, number>
  ) {
    const selectionIds: number[] = []
    packet.edges.forEach((edge, packetIndex) => {
      const segmentCount = Math.max(
        0,
        Math.floor(edge.positions.length / 3) - 1
      )
      const selectionId = idByPacketIndex.get(packetIndex) ?? 0
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
        selectionIds.push(selectionId)
      }
    })
    if (selectionIds.length === 0) {
      return
    }

    const geometry = createLineGeometryView(sourceLines.geometry)
    geometry.setAttribute(
      'selectionId',
      new InstancedBufferAttribute(new Uint32Array(selectionIds), 1)
    )
    const material = createIdLineMaterial()
    const object = new LineSegments2(geometry, material)
    copyWorldTransform(object, sourceLines)
    object.frustumCulled = false
    object.renderOrder = 2
    object.visible = this.edgesVisible
    this.edgeObject = object
    this.geometries.push(geometry)
    this.materials.add(material)
    this.scene.add(object)
  }

  private addSketches(
    packet: LocalRenderPacket,
    idByPacketIndex: Map<number, number>
  ) {
    const positions: number[] = []
    const selectionIds: number[] = []
    packet.sketches.forEach((sketch, packetIndex) => {
      const pointCount = Math.floor(sketch.positions.length / 3)
      const selectionId = idByPacketIndex.get(packetIndex) ?? 0
      for (let pointIndex = 0; pointIndex < pointCount - 1; pointIndex++) {
        const offset = pointIndex * 3
        positions.push(
          sketch.positions[offset],
          sketch.positions[offset + 1],
          sketch.positions[offset + 2],
          sketch.positions[offset + 3],
          sketch.positions[offset + 4],
          sketch.positions[offset + 5]
        )
        selectionIds.push(selectionId)
      }
    })
    if (selectionIds.length === 0) {
      return
    }

    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(new Float32Array(positions))
    geometry.setAttribute(
      'selectionId',
      new InstancedBufferAttribute(new Uint32Array(selectionIds), 1)
    )
    const material = createIdLineMaterial()
    const object = new LineSegments2(geometry, material)
    object.frustumCulled = false
    object.renderOrder = 2
    this.geometries.push(geometry)
    this.materials.add(material)
    this.scene.add(object)
  }

  private addRegions(
    targets: IntegerIdPickTarget[],
    idByPacketIndex: Map<number, number>
  ) {
    const material = createIdMaterial(DoubleSide)
    let regionAdded = false

    for (const target of targets) {
      if (target.source.type !== 'region' || !(target.object instanceof Mesh)) {
        continue
      }
      const selectionId = idByPacketIndex.get(target.source.packetIndex)
      if (selectionId === undefined) {
        continue
      }

      const geometry = createGeometryView(target.object.geometry)
      const vertexCount = geometry.getAttribute('position').count
      const selectionIds = new Uint32Array(vertexCount)
      selectionIds.fill(selectionId)
      geometry.setAttribute('selectionId', new BufferAttribute(selectionIds, 1))
      const object = new Mesh(geometry, material)
      copyWorldTransform(object, target.object)
      object.frustumCulled = false
      object.renderOrder = 1
      this.geometries.push(geometry)
      this.scene.add(object)
      regionAdded = true
    }

    if (regionAdded) {
      material.polygonOffset = true
      material.polygonOffsetFactor = -1
      material.polygonOffsetUnits = -1
      this.materials.add(material)
    } else {
      material.dispose()
    }
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
    camera: Parameters<WebGPURenderer['render']>[1],
    viewportWidth: number
  ) {
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

function createIntegerOutputNode() {
  const selectionIdAttribute = attribute(
    'selectionId',
    'uint'
  ) as unknown as Node<'uint'>
  const selectionId = varying(selectionIdAttribute) as unknown as Node<'uint'>
  return outputStruct(uint(selectionId)) as Node
}

function createIdMaterial(
  side?: Material['side'],
  maskNode?: Node<'bool'> | null
) {
  const material = new MeshBasicNodeMaterial({
    side,
    depthTest: true,
    depthWrite: true,
    transparent: false,
    blending: NoBlending,
  })
  material.fog = false
  material.toneMapped = false
  material.maskNode = maskNode ?? null
  material.outputNode = createIntegerOutputNode()
  return material
}

function createIdLineMaterial() {
  const material = new Line2NodeMaterial({
    linewidth: SELECTION_LINE_WIDTH_AT_REFERENCE_PX,
  })
  material.worldUnits = false
  material.alphaToCoverage = false
  material.depthTest = true
  material.depthWrite = true
  material.transparent = false
  material.blending = NoBlending
  material.fog = false
  material.toneMapped = false
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  material.polygonOffsetUnits = -1
  material.outputNode = createIntegerOutputNode()
  return material
}

function createGeometryView(source: BufferGeometry) {
  const geometry = new BufferGeometry()
  for (const attributeName of ['position', 'uv', 'primitiveIndex']) {
    const sourceAttribute = source.getAttribute(attributeName)
    if (sourceAttribute) {
      geometry.setAttribute(attributeName, sourceAttribute)
    }
  }
  if (source.index) {
    geometry.setIndex(source.index)
  }
  geometry.drawRange = { ...source.drawRange }
  geometry.boundingBox = source.boundingBox
  geometry.boundingSphere = source.boundingSphere
  return geometry
}

function createLineGeometryView(source: LineSegmentsGeometry) {
  const geometry = new LineSegmentsGeometry()
  for (const attributeName of ['instanceStart', 'instanceEnd']) {
    const sourceAttribute = source.getAttribute(attributeName)
    if (sourceAttribute) {
      geometry.setAttribute(attributeName, sourceAttribute)
    }
  }
  geometry.instanceCount = source.instanceCount
  geometry.boundingBox = source.boundingBox
  geometry.boundingSphere = source.boundingSphere
  return geometry
}

function copyWorldTransform(target: Object3D, source: Object3D) {
  source.updateWorldMatrix(true, false)
  target.matrix.copy(source.matrixWorld)
  target.matrixWorld.copy(source.matrixWorld)
  target.matrixAutoUpdate = false
  target.layers.mask = source.layers.mask
}

function getFirstMaterial(material: Material | Material[]) {
  return isArray(material) ? (material[0] ?? null) : material
}

function clampPixel(value: number, size: number) {
  return Math.max(0, Math.min(size - 1, value))
}
