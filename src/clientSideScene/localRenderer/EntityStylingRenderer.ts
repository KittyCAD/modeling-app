import type { EntityStyle } from '@src/lib/scene/entityStyling'
import {
  type Camera,
  type Object3D,
  Color,
  DoubleSide,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  NormalBlending,
  NoToneMapping,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
} from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import {
  max,
  min,
  mix,
  renderOutput,
  screenUV,
  texture,
  uniform,
  vec2,
  vec4,
} from 'three/tsl'
import {
  Line2NodeMaterial,
  MeshBasicNodeMaterial,
  NodeMaterial,
  QuadMesh,
  RenderPipeline,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu'

interface StylingLayer {
  readonly id: symbol
  style: EntityStyle
  keys: Set<string>
  readonly mask: Scene
  readonly lines: Scene
  readonly compositeMaterial: NodeMaterial
  readonly lineMaterial: Line2NodeMaterial
}

export class EntityStylingRenderer {
  private readonly renderer: WebGPURenderer
  private readonly baseHdrTarget: RenderTarget
  private readonly baseLdrTarget: RenderTarget
  private readonly frameTarget: RenderTarget
  private readonly cacheBasePipeline: RenderPipeline
  private readonly copyBasePipeline: RenderPipeline
  private readonly presentPipeline: RenderPipeline
  private readonly drawingBufferSize = new Vector2()
  private readonly texelSize = new Vector2(1, 1)
  private readonly savedClearColor = new Color()
  private savedClearAlpha = 1
  private readonly backgroundColorNode = uniform(new Color())
  private readonly maskTarget = new RenderTarget(1, 1, {
    type: UnsignedByteType,
    colorSpace: NoColorSpace,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  })
  private readonly emptyLineMaterial = new Line2NodeMaterial()
  private readonly layers = new Map<symbol, StylingLayer>()
  private readonly compositeQuad: QuadMesh
  private readonly overlayByKey = new Map<string, Mesh>()
  private readonly sourceByOverlay = new Map<Mesh, Mesh>()
  private readonly lineKeys = new Set<string>()
  private readonly maskMaterial = new MeshBasicNodeMaterial({
    color: 0xffffff,
    side: DoubleSide,
    toneMapped: false,
  })
  private frameOutputTarget: RenderTarget | null = null
  private frameAutoClear = true

  constructor(renderer: WebGPURenderer, backgroundColor: string) {
    this.renderer = renderer
    this.backgroundColorNode.value.set(backgroundColor)
    this.baseHdrTarget = new RenderTarget(1, 1, {
      type: renderer.getOutputBufferType(),
      colorSpace: LinearSRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      samples: renderer.samples,
    })
    this.baseHdrTarget.texture.name = 'local-renderer-base-hdr'
    this.baseLdrTarget = new RenderTarget(1, 1, {
      type: UnsignedByteType,
      colorSpace: NoColorSpace,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0,
    })
    this.baseLdrTarget.texture.name = 'local-renderer-base-ldr'
    this.frameTarget = new RenderTarget(1, 1, {
      type: UnsignedByteType,
      colorSpace: NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      samples: renderer.samples,
    })
    this.frameTarget.texture.name = 'local-renderer-composited-frame'

    const resolvedBase = texture(this.baseHdrTarget.texture)
    const coverage = resolvedBase.a.clamp(0, 1)
    const straightBaseColor = resolvedBase.rgb.div(max(coverage, 0.00001))
    const toneMappedBase = renderOutput(
      vec4(straightBaseColor, 1),
      renderer.toneMapping,
      LinearSRGBColorSpace
    )
    const compositedBase = vec4(
      mix(this.backgroundColorNode, toneMappedBase.rgb, coverage),
      1
    )
    this.cacheBasePipeline = new RenderPipeline(
      renderer,
      renderOutput(compositedBase, NoToneMapping, renderer.outputColorSpace)
    )
    this.cacheBasePipeline.outputColorTransform = false

    this.copyBasePipeline = new RenderPipeline(
      renderer,
      texture(this.baseLdrTarget.texture)
    )
    this.copyBasePipeline.outputColorTransform = false
    this.presentPipeline = new RenderPipeline(
      renderer,
      texture(this.frameTarget.texture)
    )
    this.presentPipeline.outputColorTransform = false

    this.compositeQuad = new QuadMesh(this.maskMaterial)

    this.maskTarget.texture.name = 'local-renderer-highlight-mask'
    this.maskTarget.texture.generateMipmaps = false
  }

  beginFrame(rebuildBase: boolean) {
    const targetsResized = this.ensureTargetSize()
    this.frameOutputTarget = this.renderer.getRenderTarget()
    this.frameAutoClear = this.renderer.autoClear
    this.renderer.getClearColor(this.savedClearColor)
    this.savedClearAlpha = this.renderer.getClearAlpha()

    const shouldRebuildBase = rebuildBase || targetsResized
    if (shouldRebuildBase) {
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.setRenderTarget(this.baseHdrTarget)
      this.renderer.autoClear = true
    }

    return shouldRebuildBase
  }

  cacheBaseFrame() {
    this.renderer.setRenderTarget(this.baseLdrTarget)
    this.renderer.autoClear = true
    this.cacheBasePipeline.render()
  }

  setBackgroundColor(backgroundColor: string) {
    this.backgroundColorNode.value.set(backgroundColor)
  }

  /** Group IDs are opaque. The application chooses appearance and precedence. */
  setGroup(id: symbol, targets: Iterable<Mesh>, style: EntityStyle) {
    let layer = this.layers.get(id)
    if (layer && !sameAppearance(layer.style, style)) {
      layer.compositeMaterial.dispose()
      layer.lineMaterial.dispose()
      layer = undefined
    }
    if (!layer) {
      layer = {
        id,
        style,
        keys: new Set(),
        mask: new Scene(),
        lines: new Scene(),
        compositeMaterial: createCompositeMaterial(
          this.maskTarget,
          this.texelSize,
          style,
          this.renderer.outputColorSpace
        ),
        lineMaterial: createLineMaterial(style, this.renderer.outputColorSpace),
      }
      this.layers.set(id, layer)
    }
    layer.style = style
    layer.keys = new Set(Array.from(targets, (target) => target.uuid))
    this.updateSceneMembership()
  }

  clearGroup(id: symbol) {
    const layer = this.layers.get(id)
    if (!layer) return
    layer.mask.clear()
    layer.lines.clear()
    layer.compositeMaterial.dispose()
    layer.lineMaterial.dispose()
    this.layers.delete(id)
    this.updateSceneMembership()
  }

  // Overlays share source geometry; replacing targets never disposes model-owned geometry.
  setTargets(targets: Mesh[]) {
    this.clearTargets()
    for (const mesh of targets) {
      const overlay =
        mesh instanceof LineSegments2
          ? new LineSegments2(mesh.geometry, this.emptyLineMaterial)
          : new Mesh(mesh.geometry, this.maskMaterial)
      overlay.matrixAutoUpdate = false
      if (mesh instanceof LineSegments2) {
        overlay.frustumCulled = false
        overlay.renderOrder = 2
        this.lineKeys.add(mesh.uuid)
      }
      this.overlayByKey.set(mesh.uuid, overlay)
      this.sourceByOverlay.set(overlay, mesh)
    }
    this.updateSceneMembership()
  }

  render(camera: Camera) {
    for (const [overlay, source] of this.sourceByOverlay) {
      overlay.visible = isVisible(source)
      source.updateWorldMatrix(true, false)
      overlay.matrix.copy(source.matrixWorld)
    }
    this.ensureTargetSize()
    this.renderer.setRenderTarget(this.frameTarget)
    this.renderer.autoClear = true
    this.copyBasePipeline.render()

    this.renderer.setClearColor(0x000000, 0)

    for (const layer of this.orderedLayers()) {
      if (layer.mask.children.length)
        this.renderSceneOverlay(
          layer.mask,
          camera,
          this.frameTarget,
          layer.compositeMaterial
        )
      this.renderLines(layer.lines, camera, this.frameTarget)
    }

    this.renderer.setClearColor(this.savedClearColor, this.savedClearAlpha)
    this.renderer.setRenderTarget(this.frameOutputTarget)
    this.renderer.autoClear = true
    this.presentPipeline.render()
    this.renderer.setRenderTarget(this.frameOutputTarget)
    this.renderer.autoClear = this.frameAutoClear
  }

  clearModel() {
    this.clearTargets()
    for (const id of [...this.layers.keys()]) this.clearGroup(id)
  }

  private clearTargets() {
    for (const layer of this.layers.values()) {
      layer.mask.clear()
      layer.lines.clear()
    }
    this.sourceByOverlay.clear()
    this.overlayByKey.clear()
    this.lineKeys.clear()
  }

  dispose() {
    this.clearModel()
    this.maskMaterial.dispose()
    this.emptyLineMaterial.dispose()
    this.baseHdrTarget.dispose()
    this.baseLdrTarget.dispose()
    this.frameTarget.dispose()
    this.maskTarget.dispose()
    this.cacheBasePipeline.dispose()
    this.copyBasePipeline.dispose()
    this.presentPipeline.dispose()
  }

  private orderedLayers() {
    return [...this.layers.values()].sort(
      (a, b) => a.style.priority - b.style.priority
    )
  }

  private updateSceneMembership() {
    const winners = new Map<string, StylingLayer>()
    for (const layer of this.orderedLayers()) {
      layer.mask.clear()
      layer.lines.clear()
      for (const key of layer.keys) winners.set(key, layer)
    }
    for (const [key, layer] of winners) {
      const object = this.overlayByKey.get(key)
      if (!object) continue
      if (this.lineKeys.has(key) && object instanceof LineSegments2) {
        object.material = layer.lineMaterial
        layer.lines.add(object)
      } else layer.mask.add(object)
    }
  }

  private ensureTargetSize() {
    this.renderer.getDrawingBufferSize(this.drawingBufferSize)
    const width = Math.max(1, Math.floor(this.drawingBufferSize.x))
    const height = Math.max(1, Math.floor(this.drawingBufferSize.y))
    let resized = false
    if (this.maskTarget.width !== width || this.maskTarget.height !== height) {
      this.maskTarget.setSize(width, height)
      resized = true
    }
    for (const target of [
      this.baseHdrTarget,
      this.baseLdrTarget,
      this.frameTarget,
    ]) {
      if (target.width !== width || target.height !== height) {
        target.setSize(width, height)
        resized = true
      }
    }
    this.texelSize.set(1 / width, 1 / height)
    return resized
  }

  private renderSceneOverlay(
    scene: Scene,
    camera: Camera,
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
    camera: Camera,
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

function createLineMaterial(style: EntityStyle, outputColorSpace: string) {
  const material = new Line2NodeMaterial({
    color: 0xffffff,
    linewidth: style.lineWidth,
  })
  material.colorNode = renderOutput(
    vec4(uniform(new Color().setRGB(...style.color, SRGBColorSpace)), 1),
    NoToneMapping,
    outputColorSpace
  ).rgb
  material.worldUnits = false
  material.alphaToCoverage = false
  material.depthTest = false
  material.depthWrite = false
  material.opacity = style.outlineOpacity
  material.transparent = style.outlineOpacity < 1
  material.blending = style.outlineOpacity < 1 ? NormalBlending : NoBlending
  material.fog = false
  material.toneMapped = false
  return material
}

function createCompositeMaterial(
  maskTarget: RenderTarget,
  texelSize: Vector2,
  style: EntityStyle,
  outputColorSpace: string
) {
  const mask = texture(maskTarget.texture)
  const texel = uniform(texelSize).mul(Math.max(0.5, style.lineWidth / 2))
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
  const alpha = boundary.select(
    style.outlineOpacity,
    center.mul(style.fillOpacity)
  )
  const material = new NodeMaterial()
  // Group colors are straight RGBA; RenderOutput defaults to premultiplied input.
  // Keep conversion straight so normal alpha blending honors the requested opacity.
  const output = renderOutput(
    vec4(uniform(new Color().setRGB(...style.color, SRGBColorSpace)), alpha),
    NoToneMapping,
    outputColorSpace
  )
  output.premultipliedAlpha = false
  material.fragmentNode = output
  material.transparent = true
  material.blending = NormalBlending
  material.depthTest = false
  material.depthWrite = false
  material.toneMapped = false
  return material
}

function sameAppearance(a: EntityStyle, b: EntityStyle) {
  return (
    a.color.every((value, index) => value === b.color[index]) &&
    a.fillOpacity === b.fillOpacity &&
    a.outlineOpacity === b.outlineOpacity &&
    a.lineWidth === b.lineWidth
  )
}

function isVisible(source: Object3D) {
  for (let object: Object3D | null = source; object; object = object.parent)
    if (!object.visible) return false
  return true
}
