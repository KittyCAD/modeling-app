import { LOCAL_EDGE_PICK_RADIUS_PX } from '@src/clientSideScene/localRenderer/config'
import { EdgeTargetType } from '@src/clientSideScene/localRenderer/EdgeRenderer'
import {
  isBodyEdge,
  isFace,
  isSketchLine,
  SELECTION_ID_MASK,
  selectionTypeTag,
} from '@src/clientSideScene/localRenderer/selectionId'
import {
  type Camera,
  FloatType,
  HalfFloatType,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
} from 'three'
import {
  float,
  Fn,
  ivec2,
  orthographicDepthToViewZ,
  perspectiveDepthToViewZ,
  round,
  select,
  textureLoad,
  textureSize,
  uint,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl'
import {
  type Node,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu'

const STENCIL = [0, -1, 1] as const
const FACE_PROBE_CSS_PX = 8
const FACE_SCORE = 0.75
const RADIUS = LOCAL_EDGE_PICK_RADIUS_PX
const COVERAGE_TAPS = [-3, -2, -1, 0, 1, 2, 3] as const
const DEPTH_PENALTY = 0.12
const MAX_FACE_STRENGTH = 0.88
const OCCLUSION_TOLERANCE_METERS = 0.00075
const OCCLUSION_TAPS = [0, 0.25, 0.5, 0.75] as const

export class PickScorePass {
  private readonly buffers: [RenderTarget, RenderTarget]
  private readonly seed: NodeMaterial
  private readonly grow: [NodeMaterial, NodeMaterial]
  private readonly resolve: [NodeMaterial, NodeMaterial]
  private readonly quad: QuadMesh
  private readonly pixelSize = uniform(new Vector2(1, 1))
  private readonly step = uniform(1, 'int')
  private readonly probeX = uniform(1, 'int')
  private readonly probeY = uniform(1, 'int')
  private readonly near = uniform(0.01)
  private readonly far = uniform(1000)
  private readonly perspective = uniform(true)
  private readonly focusDepth = uniform(1)

  constructor(
    private readonly renderer: WebGPURenderer,
    raw: RenderTarget,
    packedIds: boolean,
    idOutput: (id: Node<'uint'>) => Node,
    private readonly coverageScoring = false
  ) {
    const createBuffer = () =>
      new RenderTarget(raw.width, raw.height, {
        type: coverageScoring ? FloatType : HalfFloatType,
        colorSpace: NoColorSpace,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        depthBuffer: false,
      })
    this.buffers = [createBuffer(), createBuffer()]
    const material = (fragment: Node) => {
      const mat = new NodeMaterial()
      mat.fragmentNode = fragment
      mat.depthTest = false
      mat.depthWrite = false
      mat.blending = NoBlending
      mat.toneMapped = false
      return mat
    }
    const size = textureSize(
      textureLoad(raw.texture)
    ) as unknown as Node<'ivec2'>
    const point = () => ivec2(uv().mul(vec2(size)))
    const bounded = (p: Node<'ivec2'>) =>
      ivec2(vec2(p).clamp(vec2(0), vec2(size).sub(vec2(1))))
    const rawId = (p: Node<'ivec2'>) => {
      const pixel = textureLoad(raw.texture, p)
      return packedIds
        ? uint(round(pixel.r.mul(255)))
            .add(uint(round(pixel.g.mul(255))).shiftLeft(8))
            .add(uint(round(pixel.b.mul(255))).shiftLeft(16))
        : (pixel.r as unknown as Node<'uint'>)
    }
    const distanceSquared = (offset: Node<'vec2'>) => {
      const css = offset.mul(this.pixelSize)
      return css.dot(css)
    }
    // Each half-float channel can exactly store 11 bits of the untagged ID.
    const split = (id: Node<'uint'>) =>
      vec2(
        float(id.bitAnd(uint(2047))),
        float(id.shiftRight(11).bitAnd(uint(2047)))
      )
    const join = (data: Node<'vec2'>) =>
      uint(data.x).bitOr(uint(data.y).shiftLeft(11))
    const depthTexture = raw.depthTexture
    const viewDepthAt = (q: Node<'ivec2'>) => {
      if (!depthTexture) return this.far
      const depth = textureLoad(depthTexture, q).r.toVar()
      return select(
        this.perspective,
        perspectiveDepthToViewZ(depth, this.near, this.far),
        orthographicDepthToViewZ(depth, this.near, this.far)
      ).negate()
    }
    const seedStrength = (q: Node<'ivec2'>) => {
      if (!depthTexture) return float(1)
      const viewDepth = viewDepthAt(q)
      return float(1).sub(
        viewDepth.div(this.focusDepth).sub(0.5).clamp(0, 1).mul(DEPTH_PENALTY)
      )
    }
    // Coverage mode stores an exact 22-bit ID, XY seed offset, and seed strength.
    const candidateId = (data: Node<'vec4'>) =>
      coverageScoring ? uint(data.x) : join(data.xy)
    const candidateOffset = (data: Node<'vec4'>) =>
      coverageScoring ? data.yz : data.zw

    const propagate = (input?: RenderTarget) =>
      material(
        Fn(() => {
          const p = point()
          const bestId = uint(0).toVar()
          const bestOffset = vec2(0).toVar()
          const bestValue = float(coverageScoring ? 0 : -(RADIUS ** 2)).toVar()
          const bestStrength = coverageScoring ? float(0).toVar() : null
          for (const y of STENCIL) {
            for (const x of STENCIL) {
              const q = bounded(p.add(ivec2(x, y).mul(this.step))).toVar()
              const delta = vec2(q.sub(p))
              const candidate = input
                ? textureLoad(input.texture, q)
                : (() => {
                    const id = rawId(q).toVar()
                    if (coverageScoring) {
                      return vec4(
                        select(
                          isBodyEdge(id),
                          float(id.bitAnd(uint(SELECTION_ID_MASK))),
                          float(0)
                        ),
                        vec2(0),
                        seedStrength(q)
                      )
                    }
                    return vec4(
                      select(isBodyEdge(id), split(id), vec2(0)),
                      vec2(0)
                    )
                  })()
              const id = candidateId(candidate).toVar()
              const offset = candidateOffset(candidate).add(delta).toVar()
              const distance = distanceSquared(offset)
              const value = (
                coverageScoring
                  ? candidate.w.sub(distance.sqrt().div(RADIUS))
                  : distance.negate()
              ).toVar()
              const wins = id
                .notEqual(0)
                .and(
                  value
                    .greaterThan(bestValue)
                    .or(value.equal(bestValue).and(id.lessThan(bestId)))
                )
                .toVar()
              bestOffset.assign(select(wins, offset, bestOffset))
              bestValue.assign(select(wins, value, bestValue))
              bestId.assign(select(wins, id, bestId))
              if (bestStrength)
                bestStrength.assign(select(wins, candidate.w, bestStrength))
            }
          }
          return bestStrength
            ? vec4(float(bestId), bestOffset, bestStrength)
            : vec4(split(bestId), bestOffset)
        })()
      )
    const composite = (input: RenderTarget) =>
      material(
        idOutput(
          Fn(() => {
            const p = point()
            const center = rawId(p).toVar()
            const edge = textureLoad(input.texture, p).toVar()
            const id = candidateId(edge)
            const edgeScore = (coverageScoring ? edge.w : float(1)).sub(
              distanceSquared(candidateOffset(edge)).sqrt().div(RADIUS)
            )
            const x = ivec2(this.probeX, 0)
            const y = ivec2(0, this.probeY)
            const missingPair = (d: Node<'ivec2'>) =>
              rawId(bounded(p.add(d)))
                .notEqual(center)
                .and(rawId(bounded(p.sub(d))).notEqual(center))
            // Require missing support on opposite sides, not just at one boundary.
            const narrow = missingPair(x).or(missingPair(y))
            const faceScore = (() => {
              if (!coverageScoring) {
                return select(
                  isFace(center).and(narrow),
                  float(FACE_SCORE),
                  float(0)
                )
              }
              const matches = float(1).toVar()
              for (const y of COVERAGE_TAPS) {
                for (const x of COVERAGE_TAPS) {
                  if (x === 0 && y === 0) continue
                  const offset = ivec2(this.probeX.mul(x), this.probeY.mul(y))
                  const sameFace = rawId(bounded(p.add(offset))).equal(center)
                  matches.addAssign(select(sameFace, float(1), float(0)))
                }
              }
              const coverage = matches.div(COVERAGE_TAPS.length ** 2).toVar()
              return select(
                isFace(center),
                float(1).sub(coverage.mul(coverage)).mul(MAX_FACE_STRENGTH),
                float(0)
              )
            })()
            const grow = id
              .notEqual(0)
              .and(edgeScore.greaterThan(faceScore))
              .and(isBodyEdge(center).not())
              .and(isSketchLine(center).not())
            let canGrow = grow
            if (coverageScoring && depthTexture) {
              const offset = candidateOffset(edge)
              const seedDepth = viewDepthAt(bounded(p.add(ivec2(offset))))
              const nearest = seedDepth.toVar()
              for (const t of OCCLUSION_TAPS) {
                const tap = bounded(p.add(ivec2(round(offset.mul(t)))))
                nearest.assign(nearest.min(viewDepthAt(tap)))
              }
              canGrow = grow.and(
                seedDepth.lessThanEqual(nearest.add(OCCLUSION_TOLERANCE_METERS))
              )
            }
            return select(
              canGrow,
              id.bitOr(uint(selectionTypeTag(EdgeTargetType.BodyEdge))),
              center
            )
          })()
        )
      )

    this.seed = propagate()
    this.grow = [propagate(this.buffers[0]), propagate(this.buffers[1])]
    this.resolve = [composite(this.buffers[0]), composite(this.buffers[1])]
    this.quad = new QuadMesh(this.seed)
  }

  render(
    target: RenderTarget,
    cssWidth: number,
    cssHeight: number,
    camera: Camera,
    focusDistance: number | null
  ) {
    const x = Math.max(cssWidth, 1) / target.width
    const y = Math.max(cssHeight, 1) / target.height
    this.pixelSize.value.set(x, y)
    const probe = this.coverageScoring
      ? RADIUS / ((COVERAGE_TAPS.length - 1) / 2)
      : FACE_PROBE_CSS_PX
    this.probeX.value = Math.max(1, Math.round(probe / x))
    this.probeY.value = Math.max(1, Math.round(probe / y))
    if (
      camera instanceof PerspectiveCamera ||
      camera instanceof OrthographicCamera
    ) {
      this.near.value = camera.near
      this.far.value = camera.far
      this.perspective.value = camera instanceof PerspectiveCamera
    }
    this.focusDepth.value = Math.max(0.001, focusDistance ?? 1)
    const render = (buffer: RenderTarget, material: NodeMaterial) => {
      this.renderer.setRenderTarget(buffer)
      this.quad.material = material
      this.quad.render(this.renderer)
    }
    for (const buffer of this.buffers)
      buffer.setSize(target.width, target.height)
    const reach = Math.max(1, Math.ceil(RADIUS / Math.min(x, y)))
    this.step.value = 2 ** Math.floor(Math.log2(reach))
    let current: 0 | 1 = 0
    render(this.buffers[current], this.seed)
    while (this.step.value > 1) {
      this.step.value /= 2
      const next: 0 | 1 = current === 0 ? 1 : 0
      render(this.buffers[next], this.grow[current])
      current = next
    }
    render(target, this.resolve[current])
  }

  dispose() {
    for (const buffer of this.buffers) buffer.dispose()
    for (const material of [this.seed, ...this.grow, ...this.resolve])
      material.dispose()
  }
}
