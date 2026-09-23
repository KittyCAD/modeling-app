import {
  SKETCH_HIGHLIGHT_COLOR,
  SKETCH_SELECTION_COLOR,
} from '@src/lib/constants'
import {
  type BufferGeometry,
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

const HIGHLIGHT_INTERIOR_OPACITY = 0.2
const HIGHLIGHT_LINE_WIDTH_PX = 2

export type SelectionHighlightRenderMetrics = {
  compositionCpuSubmissionMs: number
  highlightCpuSubmissionMs: number
  presentationCpuSubmissionMs: number
  maskPasses: number
  linePasses: number
}

export class SelectionHighlightRenderer {
  private readonly renderer: WebGPURenderer
  private readonly baseHdrTarget: RenderTarget
  private readonly baseLdrTarget: RenderTarget
  private readonly frameTarget: RenderTarget
  private readonly cacheBasePipeline: RenderPipeline
  private readonly copyBasePipeline: RenderPipeline
  private readonly presentPipeline: RenderPipeline
  private readonly hoverMaskScene = new Scene()
  private readonly selectionMaskScene = new Scene()
  private readonly hoverLineScene = new Scene()
  private readonly selectionLineScene = new Scene()
  private readonly drawingBufferSize = new Vector2()
  private readonly texelSize = new Vector2(1, 1)
  private readonly savedClearColor = new Color()
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
  private readonly hoverCompositeMaterial: NodeMaterial
  private readonly selectionCompositeMaterial: NodeMaterial
  private readonly hoverLineMaterial: Line2NodeMaterial
  private readonly selectionLineMaterial: Line2NodeMaterial
  private readonly compositeQuad = new QuadMesh()
  private readonly overlayByKey = new Map<string, Mesh>()
  private readonly sourceByOverlay = new Map<Mesh, Mesh>()
  private readonly lineKeys = new Set<string>()
  private readonly geometries: BufferGeometry[] = []
  private readonly maskMaterial = new MeshBasicNodeMaterial({
    color: 0xffffff,
    side: DoubleSide,
    toneMapped: false,
  })
  private selectedKeys = new Set<string>()
  private hoveredKey: string | null = null
  private frameOutputTarget: RenderTarget | null = null
  private frameAutoClear = true
  private frameClearAlpha = 1

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

    this.hoverCompositeMaterial = createCompositeMaterial(
      this.maskTarget,
      this.texelSize,
      SKETCH_HIGHLIGHT_COLOR,
      renderer.outputColorSpace
    )
    this.selectionCompositeMaterial = createCompositeMaterial(
      this.maskTarget,
      this.texelSize,
      SKETCH_SELECTION_COLOR,
      renderer.outputColorSpace
    )
    this.hoverLineMaterial = createLineMaterial(
      SKETCH_HIGHLIGHT_COLOR,
      renderer.outputColorSpace
    )
    this.selectionLineMaterial = createLineMaterial(
      SKETCH_SELECTION_COLOR,
      renderer.outputColorSpace
    )

    this.maskTarget.texture.name = 'local-renderer-highlight-mask'
    this.maskTarget.texture.generateMipmaps = false
  }

  beginFrame(rebuildBase: boolean) {
    const targetsResized = this.ensureTargetSize()
    this.frameOutputTarget = this.renderer.getRenderTarget()
    this.frameAutoClear = this.renderer.autoClear
    this.frameClearAlpha = this.renderer.getClearAlpha()
    this.renderer.getClearColor(
      this.savedClearColor as Parameters<WebGPURenderer['getClearColor']>[0]
    )

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

  setHover(target: Mesh | null) {
    this.hoveredKey = target?.uuid ?? null
    this.updateSceneMembership()
  }

  setTargets(targets: Mesh[]) {
    this.clearModel()
    for (const mesh of targets) {
      const overlay = new Mesh(mesh.geometry, this.maskMaterial)
      overlay.matrixAutoUpdate = false
      this.overlayByKey.set(mesh.uuid, overlay)
      this.sourceByOverlay.set(overlay, mesh)
    }
  }

  setSelection(targets: Iterable<Mesh>) {
    console.log('setselection', targets)
    this.selectedKeys = new Set(Array.from(targets, (target) => target.uuid))
    this.updateSceneMembership()
  }

  render(camera: Parameters<WebGPURenderer['render']>[1]) {
    for (const [overlay, source] of this.sourceByOverlay) {
      source.updateWorldMatrix(true, false)
      overlay.matrix.copy(source.matrixWorld)
    }
    this.ensureTargetSize()
    this.renderer.setRenderTarget(this.frameTarget)
    this.renderer.autoClear = true
    const compositionStartedAt = performance.now()
    this.copyBasePipeline.render()
    const compositionCpuSubmissionMs = performance.now() - compositionStartedAt

    const highlightStartedAt = performance.now()
    let maskPasses = 0
    let linePasses = 0
    this.renderer.setClearColor(0x000000, 0)

    if (this.hoverMaskScene.children.length > 0) {
      maskPasses += 1
      this.renderSceneOverlay(
        this.hoverMaskScene,
        camera,
        this.frameTarget,
        this.hoverCompositeMaterial
      )
    }
    if (this.hoverLineScene.children.length > 0) {
      linePasses += 1
    }
    this.renderLines(this.hoverLineScene, camera, this.frameTarget)
    if (this.selectionMaskScene.children.length > 0) {
      maskPasses += 1
      this.renderSceneOverlay(
        this.selectionMaskScene,
        camera,
        this.frameTarget,
        this.selectionCompositeMaterial
      )
    }
    if (this.selectionLineScene.children.length > 0) {
      linePasses += 1
    }
    this.renderLines(this.selectionLineScene, camera, this.frameTarget)

    const highlightCpuSubmissionMs = performance.now() - highlightStartedAt

    this.renderer.setClearColor(this.savedClearColor, this.frameClearAlpha)
    this.renderer.setRenderTarget(this.frameOutputTarget)
    this.renderer.autoClear = true
    const presentationStartedAt = performance.now()
    this.presentPipeline.render()
    const presentationCpuSubmissionMs =
      performance.now() - presentationStartedAt
    this.renderer.setRenderTarget(this.frameOutputTarget)
    this.renderer.autoClear = this.frameAutoClear

    return {
      compositionCpuSubmissionMs,
      highlightCpuSubmissionMs,
      presentationCpuSubmissionMs,
      maskPasses,
      linePasses,
    } satisfies SelectionHighlightRenderMetrics
  }

  clearModel() {
    this.sourceByOverlay.clear()
    this.hoverMaskScene.clear()
    this.selectionMaskScene.clear()
    this.hoverLineScene.clear()
    this.selectionLineScene.clear()
    this.overlayByKey.clear()
    this.lineKeys.clear()
    this.selectedKeys.clear()
    this.hoveredKey = null
    this.geometries.forEach((geometry) => {
      geometry.dispose()
    })
    this.geometries.length = 0
  }

  dispose() {
    this.clearModel()
    this.maskMaterial.dispose()
    this.baseHdrTarget.dispose()
    this.baseLdrTarget.dispose()
    this.frameTarget.dispose()
    this.maskTarget.dispose()
    this.cacheBasePipeline.dispose()
    this.copyBasePipeline.dispose()
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

function createLineMaterial(color: number, outputColorSpace: string) {
  const material = new Line2NodeMaterial({
    color: 0xffffff,
    linewidth: HIGHLIGHT_LINE_WIDTH_PX,
  })
  material.lineColorNode = renderOutput(
    vec4(uniform(new Color(color)), 1),
    NoToneMapping,
    outputColorSpace
  ).rgb
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
  color: number,
  outputColorSpace: string
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
  // Color decodes the sRGB hex palette; renderOutput converts back for display.
  material.fragmentNode = renderOutput(
    vec4(uniform(new Color(color)), alpha),
    NoToneMapping,
    outputColorSpace
  )
  material.transparent = true
  material.blending = NormalBlending
  material.depthTest = false
  material.depthWrite = false
  material.toneMapped = false
  return material
}
