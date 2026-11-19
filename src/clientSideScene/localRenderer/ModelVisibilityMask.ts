import {
  Color,
  DoubleSide,
  Mesh,
  type Object3D,
  type Camera,
  Scene,
} from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/webgpu/LineSegments2.js'
import {
  MeshBasicNodeMaterial,
  Line2NodeMaterial,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu'

const MASK_SIZE = 64

/** A model-only silhouette; independent of lighting, colors and selection filters. */
export class ModelVisibilityMask {
  private readonly scene = new Scene()
  private readonly material = new MeshBasicNodeMaterial({
    color: 0xffffff,
    side: DoubleSide,
  })
  // Widen lines slightly so a coarse mask does not miss visible sketch curves.
  private readonly lineMaterial = new Line2NodeMaterial({
    color: 0xffffff,
    linewidth: 4,
  })
  private readonly target = new RenderTarget(MASK_SIZE, MASK_SIZE, {
    samples: 0,
  })
  private readonly sources = new Map<Mesh, Mesh>()
  private readonly reads = new Set<Promise<unknown>>()
  private disposed = false

  constructor(
    private readonly renderer: Pick<
      WebGPURenderer,
      | 'getRenderTarget'
      | 'setRenderTarget'
      | 'render'
      | 'readRenderTargetPixelsAsync'
      | 'autoClear'
    >
  ) {
    this.scene.background = new Color(0)
    this.material.toneMapped = false
    this.lineMaterial.toneMapped = false
    this.lineMaterial.worldUnits = false
    this.lineMaterial.alphaToCoverage = false
  }

  setModel(model: Object3D | null) {
    this.scene.clear()
    this.sources.clear()
    model?.traverse((source) => {
      if (!(source instanceof Mesh)) return
      // Selection-only line proxies share geometry with the drawn lines.
      if (
        source.material instanceof Line2NodeMaterial &&
        !source.material.visible
      )
        return
      const proxy =
        source instanceof LineSegments2
          ? new LineSegments2(source.geometry, this.lineMaterial)
          : new Mesh(source.geometry, this.material)
      proxy.matrixAutoUpdate = false
      this.sources.set(proxy, source)
      this.scene.add(proxy)
    })
  }

  async coverage(camera: Camera): Promise<number | undefined> {
    if (this.disposed || this.sources.size === 0) return undefined
    for (const [proxy, source] of this.sources) {
      source.updateWorldMatrix(true, false)
      proxy.matrix.copy(source.matrixWorld)
      proxy.layers.mask = source.layers.mask
      proxy.visible = source.visible
      source.traverseAncestors((parent) => {
        proxy.visible &&= parent.visible
      })
    }
    const previousTarget = this.renderer.getRenderTarget()
    const previousAutoClear = this.renderer.autoClear
    try {
      this.renderer.autoClear = true
      this.renderer.setRenderTarget(this.target)
      this.renderer.render(this.scene, camera)
    } finally {
      this.renderer.setRenderTarget(previousTarget)
      this.renderer.autoClear = previousAutoClear
    }
    const read = this.renderer.readRenderTargetPixelsAsync(
      this.target,
      0,
      0,
      MASK_SIZE,
      MASK_SIZE
    )
    this.reads.add(read)
    try {
      const pixels = await read
      if (this.disposed) return undefined
      let visible = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== 0) visible++
      }
      return visible / (MASK_SIZE * MASK_SIZE)
    } finally {
      this.reads.delete(read)
    }
  }

  async dispose() {
    this.disposed = true
    await Promise.allSettled(this.reads)
    this.setModel(null)
    this.target.dispose()
    this.material.dispose()
    this.lineMaterial.dispose()
  }
}
