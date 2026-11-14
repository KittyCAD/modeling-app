import { LOCAL_EDGE_PICK_RADIUS_PX } from '@src/clientSideScene/localRenderer/config'
import {
  encodeId,
  isBodyEdge,
  isSketchLine,
} from '@src/clientSideScene/localRenderer/selectionId'
import {
  NearestFilter,
  NoBlending,
  NoColorSpace,
  RedIntegerFormat,
  UnsignedByteType,
  UnsignedIntType,
} from 'three'
import {
  Fn,
  float,
  If,
  int,
  ivec2,
  Loop,
  round,
  textureLoad,
  textureSize,
  uint,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl'
import {
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu'

/* This runs shaders on the picker's render to grow the edges' pickable area
 * along the viewport. There are numerous problems trying to use the 3D render
 * to expand the area that will target an edge. (See #15097). This approach
 * allows the 3D to render and then uses pixel shaders to expand the edges in
 * the 2D plane.
 */
export class EdgeGrowthPass {
  readonly target: RenderTarget

  // Keep a texture of horizontal edge distance tests so less calculations are
  // needed for every pixel.
  private readonly horizontalTarget: RenderTarget
  private readonly horizontalMaterial: NodeMaterial

  // The final material that uses the horizontal calculations to figure out
  // closest edge ID.
  private readonly grownMaterial: NodeMaterial

  private readonly quad: QuadMesh

  private readonly radiusX = uniform(0, 'int')
  private readonly radiusY = uniform(0, 'int')
  private readonly pixelWidth = uniform(1)
  private readonly pixelHeight = uniform(1)

  constructor(
    private readonly renderer: WebGPURenderer,

    // The picker render and dimensions
    private readonly raw: RenderTarget,
    width: number,
    height: number,

    // WebGPU and WebGL pack color values differently, need to know which is
    // being used
    packsIdsIntoColor: boolean,
    idOutput: (id: Node<'uint'>) => Node
  ) {
    this.horizontalTarget = new RenderTarget(width, height, {
      type: UnsignedByteType,
      colorSpace: NoColorSpace,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      samples: 0,
    })
    this.horizontalTarget.texture.name = 'local-edge-nearest-horizontal'

    this.target = new RenderTarget(width, height, {
      ...(packsIdsIntoColor
        ? { type: UnsignedByteType, colorSpace: NoColorSpace }
        : { format: RedIntegerFormat, type: UnsignedIntType }),
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      samples: 0,
    })
    this.target.texture.name = 'local-renderer-grown-selection-ids'

    // WebGL stores each tagged ID in RGB bytes; WebGPU stores it as one integer.
    // Both paths must preserve the tag so the passes can distinguish body edges.
    const rawSample = (point: Node<'ivec2'>) => {
      const pixel = textureLoad(raw.texture, point)
      return packsIdsIntoColor
        ? uint(round(pixel.r.mul(255)))
            .add(uint(round(pixel.g.mul(255))).shiftLeft(8))
            .add(uint(round(pixel.b.mul(255))).shiftLeft(16))
        : (pixel.r as unknown as Node<'uint'>)
    }

    // Get the nearest edge looking only horizontally. These act as "cached"
    // values when doing searches for edges at every pixel in the grownPass
    const horizontalPass = Fn(() => {
      const size = textureSize(
        textureLoad(raw.texture)
      ) as unknown as Node<'ivec2'>
      const point = ivec2(uv().mul(vec2(size)))
      const bestId = uint(0).toVar()
      const bestDx = int(256).toVar()
      Loop(
        { start: this.radiusX.negate(), end: this.radiusX.add(1) },
        ({ i }) => {
          const neighborX = point.x.add(i)
          If(
            neighborX.greaterThanEqual(0).and(neighborX.lessThan(size.x)),
            () => {
              const candidate = rawSample(ivec2(neighborX, point.y))
              const dx = i.abs()
              If(isBodyEdge(candidate).and(dx.lessThan(bestDx)), () => {
                bestId.assign(candidate)
                bestDx.assign(dx)
              })
            }
          )
        }
      )
      // By stuffing distance into the alpha channel, search is capped at 255
      // pixels. At 12px radius, a very high DPR would be needed to break this
      return vec4(encodeId(bestId), float(bestDx).min(255).div(255))
    })

    const grownPass = Fn(() => {
      const size = textureSize(
        textureLoad(this.horizontalTarget.texture)
      ) as unknown as Node<'ivec2'>
      const point = ivec2(uv().mul(vec2(size)))
      const centerId = rawSample(point)
      const bestId = centerId.toVar()
      // Avoid a square root by just keeping distance squared
      const bestDistance = float(LOCAL_EDGE_PICK_RADIUS_PX ** 2).toVar()
      // Don't search for an edge if a sketch line is at the center
      If(isSketchLine(centerId).not(), () => {
        Loop(
          { start: this.radiusY.negate(), end: this.radiusY.add(1) },
          ({ i }) => {
            const neighborY = point.y.add(i)
            If(
              neighborY.greaterThanEqual(0).and(neighborY.lessThan(size.y)),
              () => {
                const sample = textureLoad(
                  this.horizontalTarget.texture,
                  ivec2(point.x, neighborY)
                )
                const id = uint(round(sample.r.mul(255)))
                  .add(uint(round(sample.g.mul(255))).shiftLeft(8))
                  .add(uint(round(sample.b.mul(255))).shiftLeft(16))

                // Take the pre-calculated distance to the nearest edge found
                // when searching horizontally and add the vertical component
                // to get the total distance (keep the distance squared to
                // avoid a sqrt calc)
                const dx = round(sample.a.mul(255)).mul(this.pixelWidth)
                const dy = float(i).mul(this.pixelHeight)
                const distance = dx.mul(dx).add(dy.mul(dy))

                If(isBodyEdge(id).and(distance.lessThan(bestDistance)), () => {
                  bestId.assign(id)
                  bestDistance.assign(distance)
                })
              }
            )
          }
        )
      })
      return bestId
    })

    this.horizontalMaterial = new NodeMaterial()
    this.horizontalMaterial.fragmentNode = horizontalPass()
    this.grownMaterial = new NodeMaterial()
    this.grownMaterial.fragmentNode = idOutput(grownPass())
    for (const material of [this.horizontalMaterial, this.grownMaterial]) {
      material.depthTest = false
      material.depthWrite = false
      material.blending = NoBlending
      material.toneMapped = false
    }
    this.quad = new QuadMesh(this.horizontalMaterial)
  }

  resize(width: number, height: number) {
    this.horizontalTarget.setSize(width, height)
    this.target.setSize(width, height)
  }

  render(cssWidth: number, cssHeight: number) {
    // The radius is specified in CSS pixels, but texture loads use drawing-
    // buffer pixels. Convert between them for this render.
    this.pixelWidth.value = Math.max(cssWidth, 1) / this.raw.width
    this.pixelHeight.value = Math.max(cssHeight, 1) / this.raw.height
    this.radiusX.value = Math.min(
      255,
      Math.ceil(LOCAL_EDGE_PICK_RADIUS_PX / this.pixelWidth.value)
    )
    this.radiusY.value = Math.ceil(
      LOCAL_EDGE_PICK_RADIUS_PX / this.pixelHeight.value
    )
    this.renderer.setRenderTarget(this.horizontalTarget)
    this.quad.material = this.horizontalMaterial
    this.quad.render(this.renderer)
    this.renderer.setRenderTarget(this.target)
    this.quad.material = this.grownMaterial
    this.quad.render(this.renderer)
  }

  dispose() {
    this.horizontalTarget.dispose()
    this.target.dispose()
    this.horizontalMaterial.dispose()
    this.grownMaterial.dispose()
  }
}
