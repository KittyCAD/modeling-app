import type { IntegerIdPickTarget } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import type { LocalRenderPacket } from '@src/clientSideScene/localRenderer/renderPacketBinary'
import {
  SKETCH_HIGHLIGHT_COLOR,
  SKETCH_SELECTION_COLOR,
} from '@src/lib/constants'
import { isArray } from '@src/lib/utils'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LinearSRGBColorSpace,
  type Material,
  Mesh,
  NearestFilter,
  NoBlending,
  NormalBlending,
  type Object3D,
  Scene,
  Vector2,
} from 'three'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import { max, min, screenUV, texture, uniform, vec2, vec4 } from 'three/tsl'
import {
  Line2NodeMaterial,
  MeshBasicNodeMaterial,
  type Node,
  NodeMaterial,
  QuadMesh,
  RenderPipeline,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu'

const HIGHLIGHT_INTERIOR_OPACITY = 0.2
const HIGHLIGHT_LINE_WIDTH_PX = 2

type NodeMaterialWithMask = Material & {
  maskNode?: Node<'bool'> | null
}

export class SelectionHighlightRenderer {
  private readonly renderer: WebGPURenderer
  private readonly frameTarget: RenderTarget
  private readonly presentPipeline: RenderPipeline
  private readonly hoverMaskScene = new Scene()
  private readonly selectionMaskScene = new Scene()
  private readonly hoverLineScene = new Scene()
  private readonly selectionLineScene = new Scene()
  private readonly drawingBufferSize = new Vector2()
  private readonly texelSize = new Vector2(1, 1)
  private readonly savedClearColor = new Color()
  private readonly maskTarget = new RenderTarget(1, 1, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  })
  private readonly hoverCompositeMaterial = createCompositeMaterial(
    this.maskTarget,
    this.texelSize,
    SKETCH_HIGHLIGHT_COLOR
  )
  private readonly selectionCompositeMaterial = createCompositeMaterial(
    this.maskTarget,
    this.texelSize,
    SKETCH_SELECTION_COLOR
  )
  private readonly hoverLineMaterial = createLineMaterial(
    SKETCH_HIGHLIGHT_COLOR
  )
  private readonly selectionLineMaterial = createLineMaterial(
    SKETCH_SELECTION_COLOR
  )
  private readonly compositeQuad = new QuadMesh()
  private readonly overlayByKey = new Map<string, Object3D>()
  private readonly maskMaterialBySource = new Map<
    Object3D,
    MeshBasicNodeMaterial
  >()
  private readonly lineKeys = new Set<string>()
  private readonly geometries: BufferGeometry[] = []
  private readonly maskMaterials = new Set<Material>()
  private selectedKeys = new Set<string>()
  private hoveredKey: string | null = null
  private frameOutputTarget: RenderTarget | null = null
  private frameAutoClear = true

  constructor(renderer: WebGPURenderer) {
    this.renderer = renderer
    this.frameTarget = new RenderTarget(1, 1, {
      type: renderer.getOutputBufferType(),
      colorSpace: LinearSRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      samples: renderer.samples,
    })
    this.frameTarget.texture.name = 'local-renderer-frame'
    this.presentPipeline = new RenderPipeline(
      renderer,
      texture(this.frameTarget.texture)
    )
    this.maskTarget.texture.name = 'local-renderer-highlight-mask'
    this.maskTarget.texture.generateMipmaps = false
  }

  beginFrame() {
    this.ensureTargetSize()
    this.frameOutputTarget = this.renderer.getRenderTarget()
    this.frameAutoClear = this.renderer.autoClear
    this.renderer.setRenderTarget(this.frameTarget)
    this.renderer.autoClear = true
  }

  setModel(packet: LocalRenderPacket, targets: IntegerIdPickTarget[]) {
    this.clearModel()

    for (const target of targets) {
      const object = this.createOverlayObject(packet, target)
      if (object) {
        const key = getTargetKey(target)
        this.overlayByKey.set(key, object)
        if (target.source.type === 'edge' || target.source.type === 'sketch') {
          this.lineKeys.add(key)
        }
      }
    }
  }

  setHover(target: IntegerIdPickTarget | null) {
    this.hoveredKey = target ? getTargetKey(target) : null
    this.updateSceneMembership()
  }

  setSelection(targets: Iterable<IntegerIdPickTarget>) {
    this.selectedKeys = new Set(
      Array.from(targets, (target) => getTargetKey(target))
    )
    this.updateSceneMembership()
  }

  render(camera: Parameters<WebGPURenderer['render']>[1]) {
    this.ensureTargetSize()
    const previousClearAlpha = this.renderer.getClearAlpha()
    this.renderer.getClearColor(
      this.savedClearColor as Parameters<WebGPURenderer['getClearColor']>[0]
    )
    this.renderer.setClearColor(0x000000, 0)

    if (this.hoverMaskScene.children.length > 0) {
      this.renderSceneOverlay(
        this.hoverMaskScene,
        camera,
        this.frameTarget,
        this.hoverCompositeMaterial
      )
    }
    this.renderLines(this.hoverLineScene, camera, this.frameTarget)
    if (this.selectionMaskScene.children.length > 0) {
      this.renderSceneOverlay(
        this.selectionMaskScene,
        camera,
        this.frameTarget,
        this.selectionCompositeMaterial
      )
    }
    this.renderLines(this.selectionLineScene, camera, this.frameTarget)

    this.renderer.setClearColor(this.savedClearColor, previousClearAlpha)
    this.renderer.setRenderTarget(this.frameOutputTarget)
    this.renderer.autoClear = true
    this.presentPipeline.render()
    this.renderer.setRenderTarget(this.frameOutputTarget)
    this.renderer.autoClear = this.frameAutoClear
  }

  clearModel() {
    this.hoverMaskScene.clear()
    this.selectionMaskScene.clear()
    this.hoverLineScene.clear()
    this.selectionLineScene.clear()
    this.overlayByKey.clear()
    this.maskMaterialBySource.clear()
    this.lineKeys.clear()
    this.selectedKeys.clear()
    this.hoveredKey = null
    this.geometries.forEach((geometry) => {
      geometry.dispose()
    })
    this.geometries.length = 0
    this.maskMaterials.forEach((material) => {
      material.dispose()
    })
    this.maskMaterials.clear()
  }

  dispose() {
    this.clearModel()
    this.frameTarget.dispose()
    this.maskTarget.dispose()
    this.presentPipeline.dispose()
    this.hoverLineMaterial.dispose()
    this.selectionLineMaterial.dispose()
    this.hoverCompositeMaterial.dispose()
    this.selectionCompositeMaterial.dispose()
  }

  private updateSceneMembership() {
    this.hoverMaskScene.clear()
    this.selectionMaskScene.clear()
    this.hoverLineScene.clear()
    this.selectionLineScene.clear()

    for (const key of this.selectedKeys) {
      const object = this.overlayByKey.get(key)
      if (object) {
        if (this.lineKeys.has(key) && object instanceof LineSegments2) {
          object.material = this.selectionLineMaterial
          this.selectionLineScene.add(object)
        } else {
          this.selectionMaskScene.add(object)
        }
      }
    }

    if (this.hoveredKey && !this.selectedKeys.has(this.hoveredKey)) {
      const object = this.overlayByKey.get(this.hoveredKey)
      if (object) {
        if (
          this.lineKeys.has(this.hoveredKey) &&
          object instanceof LineSegments2
        ) {
          object.material = this.hoverLineMaterial
          this.hoverLineScene.add(object)
        } else {
          this.hoverMaskScene.add(object)
        }
      }
    }
  }

  private createOverlayObject(
    packet: LocalRenderPacket,
    target: IntegerIdPickTarget
  ) {
    switch (target.source.type) {
      case 'primitive':
        return this.createPrimitiveOverlay(packet, target)
      case 'edge':
        return this.createLineOverlay(
          packet.edges[target.source.packetIndex]?.positions,
          target.object
        )
      case 'sketch':
        return this.createLineOverlay(
          packet.sketches[target.source.packetIndex]?.positions,
          target.object
        )
      case 'region':
        return this.createRegionOverlay(target)
    }
  }

  private createPrimitiveOverlay(
    packet: LocalRenderPacket,
    target: IntegerIdPickTarget
  ) {
    const primitive = packet.primitives[target.source.packetIndex]
    if (!primitive || !(target.object instanceof Mesh)) {
      return null
    }

    const geometry = createGeometryView(target.object.geometry)
    geometry.setIndex(
      new BufferAttribute(
        packet.indices.subarray(
          primitive.firstIndex,
          primitive.firstIndex + primitive.indexCount
        ),
        1
      )
    )
    let material = this.maskMaterialBySource.get(target.object)
    if (!material) {
      const sourceMaterial = getFirstMaterial(target.object.material)
      material = createMaskMaterial(
        sourceMaterial?.side,
        (sourceMaterial as NodeMaterialWithMask | null)?.maskNode ?? null
      )
      this.maskMaterialBySource.set(target.object, material)
      this.maskMaterials.add(material)
    }
    const object = new Mesh(geometry, material)
    copyWorldTransform(object, target.object)
    object.frustumCulled = false
    object.renderOrder = 0
    this.geometries.push(geometry)
    return object
  }

  private createRegionOverlay(target: IntegerIdPickTarget) {
    if (!(target.object instanceof Mesh)) {
      return null
    }

    const geometry = createGeometryView(target.object.geometry)
    const material = createMaskMaterial(DoubleSide)
    const object = new Mesh(geometry, material)
    copyWorldTransform(object, target.object)
    object.frustumCulled = false
    object.renderOrder = 0
    this.geometries.push(geometry)
    this.maskMaterials.add(material)
    return object
  }

  private createLineOverlay(
    sourcePositions: Float32Array | undefined,
    sourceObject: Object3D
  ) {
    if (!sourcePositions || sourcePositions.length < 6) {
      return null
    }

    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(flattenLineStripToSegments(sourcePositions))
    const object = new LineSegments2(geometry, this.hoverLineMaterial)
    copyWorldTransform(object, sourceObject)
    object.frustumCulled = false
    object.renderOrder = 1
    this.geometries.push(geometry)
    return object
  }

  private ensureTargetSize() {
    this.renderer.getDrawingBufferSize(this.drawingBufferSize)
    const width = Math.max(1, Math.floor(this.drawingBufferSize.x))
    const height = Math.max(1, Math.floor(this.drawingBufferSize.y))
    if (this.maskTarget.width !== width || this.maskTarget.height !== height) {
      this.maskTarget.setSize(width, height)
    }
    if (
      this.frameTarget.width !== width ||
      this.frameTarget.height !== height
    ) {
      this.frameTarget.setSize(width, height)
    }
    this.texelSize.set(1 / width, 1 / height)
  }

  private renderSceneOverlay(
    scene: Scene,
    camera: Parameters<WebGPURenderer['render']>[1],
    outputTarget: RenderTarget | null,
    compositeMaterial: NodeMaterial
  ) {
    this.renderer.autoClear = false
    this.renderer.setRenderTarget(this.maskTarget)
    this.renderer.clear(true, true, false)
    this.renderer.render(scene, camera)

    this.renderer.autoClear = false
    this.renderer.setRenderTarget(outputTarget)
    this.compositeQuad.material = compositeMaterial
    this.compositeQuad.render(this.renderer)
  }

  private renderLines(
    scene: Scene,
    camera: Parameters<WebGPURenderer['render']>[1],
    outputTarget: RenderTarget | null
  ) {
    if (scene.children.length === 0) {
      return
    }

    this.renderer.autoClear = false
    this.renderer.setRenderTarget(outputTarget)
    this.renderer.render(scene, camera)
  }
}

function createMaskMaterial(
  side?: Material['side'],
  maskNode?: Node<'bool'> | null
) {
  const material = new MeshBasicNodeMaterial({
    color: 0xffffff,
    side,
    depthTest: true,
    depthWrite: true,
    transparent: false,
    blending: NoBlending,
  })
  material.fog = false
  material.toneMapped = false
  material.maskNode = maskNode ?? null
  return material
}

function createLineMaterial(color: number) {
  const material = new Line2NodeMaterial({
    color,
    linewidth: HIGHLIGHT_LINE_WIDTH_PX,
  })
  material.worldUnits = false
  material.alphaToCoverage = false
  material.depthTest = false
  material.depthWrite = false
  material.transparent = false
  material.blending = NoBlending
  material.fog = false
  material.toneMapped = false
  return material
}

function createCompositeMaterial(
  maskTarget: RenderTarget,
  texelSize: Vector2,
  color: number
) {
  const mask = texture(maskTarget.texture)
  const texel = uniform(texelSize)
  const center = mask.sample(screenUV).a
  const left = mask.sample(screenUV.sub(vec2(texel.x, 0))).a
  const right = mask.sample(screenUV.add(vec2(texel.x, 0))).a
  const up = mask.sample(screenUV.sub(vec2(0, texel.y))).a
  const down = mask.sample(screenUV.add(vec2(0, texel.y))).a
  const upperLeft = mask.sample(screenUV.sub(texel)).a
  const lowerRight = mask.sample(screenUV.add(texel)).a
  const upperRight = mask.sample(
    screenUV.add(vec2(texel.x, texel.y.negate()))
  ).a
  const lowerLeft = mask.sample(screenUV.add(vec2(texel.x.negate(), texel.y))).a
  const highest = max(
    center,
    left,
    right,
    up,
    down,
    upperLeft,
    upperRight,
    lowerLeft,
    lowerRight
  )
  const lowest = min(
    center,
    left,
    right,
    up,
    down,
    upperLeft,
    upperRight,
    lowerLeft,
    lowerRight
  )
  const boundary = highest.sub(lowest).greaterThan(0.01)
  const alpha = boundary.select(1, center.mul(HIGHLIGHT_INTERIOR_OPACITY))
  const material = new NodeMaterial()
  material.fragmentNode = vec4(uniform(new Color(color)), alpha)
  material.transparent = true
  material.blending = NormalBlending
  material.depthTest = false
  material.depthWrite = false
  material.toneMapped = false
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

function flattenLineStripToSegments(positions: Float32Array) {
  const pointCount = Math.floor(positions.length / 3)
  const segments = new Float32Array(Math.max(0, pointCount - 1) * 6)
  for (let pointIndex = 0; pointIndex < pointCount - 1; pointIndex++) {
    segments.set(
      positions.subarray(pointIndex * 3, pointIndex * 3 + 6),
      pointIndex * 6
    )
  }
  return segments
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

function getTargetKey(target: IntegerIdPickTarget) {
  return `${target.source.type}:${target.source.packetIndex}`
}
