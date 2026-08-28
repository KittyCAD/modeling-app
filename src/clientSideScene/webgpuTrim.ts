import { DataTexture, NearestFilter, RedFormat, UnsignedByteType } from 'three'
import {
  MeshStandardNodeMaterial,
  type MeshStandardNodeMaterialParameters,
  type Node,
  StorageBufferAttribute,
} from 'three/webgpu'
import {
  bool,
  Fn,
  If,
  int,
  Loop,
  storage,
  texture,
  uniform,
  uv,
  vec2,
} from 'three/tsl'

const TRIM_MASK_SIZE = 256
const TRIM_MASK_BOUNDARY_WIDTH = 4
const loopOverTrimTriangles = Loop as unknown as (
  parameters: {
    start: Node<'int'>
    end: Node<'int'>
    type: 'int'
    condition: '<'
  },
  callback: (inputs: { i: Node<'int'> }) => void
) => void

export type WebGpuTrimPrimitiveState = {
  maskTexture: DataTexture
  triangleOffset: number
  triangleCount: number
}

export type WebGpuTrimResources = {
  primitiveStates: Array<WebGpuTrimPrimitiveState | null>
  createMaterial: (
    state: WebGpuTrimPrimitiveState,
    parameters: MeshStandardNodeMaterialParameters
  ) => MeshStandardNodeMaterial
  dispose: (renderer: unknown) => void
  triangleCount: number
}

type TrimTriangleRange = {
  triangleOffset: number
  triangleCount: number
}

type TrimLoop = {
  positions: ArrayLike<number>
}

type TrimPrimitive = {
  trimLoops: TrimLoop[]
}

/**
 * Flatten each trim loop into the same triangle fan used by trimSurface.slang.
 * Two vec4s store each triangle so every preview material can share one buffer.
 */
export function packTrimTriangles(primitives: TrimPrimitive[]) {
  const values: number[] = []
  const ranges: TrimTriangleRange[] = []

  for (const primitive of primitives) {
    const triangleOffset = values.length / 8

    for (const loop of primitive.trimLoops) {
      const { positions } = loop
      if (positions.length < 6) {
        continue
      }

      const firstX = positions[0]
      const firstY = positions[1]
      for (let index = 2; index <= positions.length - 4; index += 2) {
        values.push(
          firstX,
          firstY,
          positions[index],
          positions[index + 1],
          positions[index + 2],
          positions[index + 3],
          0,
          0
        )
      }
    }

    ranges.push({
      triangleOffset,
      triangleCount: values.length / 8 - triangleOffset,
    })
  }

  return {
    values: new Float32Array(values),
    ranges,
  }
}

function addTrimLoopsToCanvasPath(
  context: CanvasRenderingContext2D,
  trimLoops: TrimLoop[]
) {
  let hasValidLoop = false

  context.beginPath()
  for (const loop of trimLoops) {
    const { positions } = loop
    if (positions.length < 6) {
      continue
    }

    hasValidLoop = true
    context.moveTo(
      positions[0] * (TRIM_MASK_SIZE - 1),
      (1 - positions[1]) * (TRIM_MASK_SIZE - 1)
    )
    for (let index = 2; index < positions.length; index += 2) {
      context.lineTo(
        positions[index] * (TRIM_MASK_SIZE - 1),
        (1 - positions[index + 1]) * (TRIM_MASK_SIZE - 1)
      )
    }
    context.closePath()
  }

  return hasValidLoop
}

function createTrimClassifierTexture(trimLoops: TrimLoop[]) {
  const canvas = document.createElement('canvas')
  canvas.width = TRIM_MASK_SIZE
  canvas.height = TRIM_MASK_SIZE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return null
  }

  context.fillStyle = 'black'
  context.fillRect(0, 0, TRIM_MASK_SIZE, TRIM_MASK_SIZE)

  if (!addTrimLoopsToCanvasPath(context, trimLoops)) {
    return null
  }

  // Black and white texels are safe fast paths. Gray texels mark a conservative
  // boundary band where the fragment shader must run the exact triangle test.
  context.fillStyle = 'white'
  context.fill('evenodd')
  context.strokeStyle = 'rgb(128, 128, 128)'
  context.lineWidth = TRIM_MASK_BOUNDARY_WIDTH
  context.lineJoin = 'round'
  context.lineCap = 'round'
  context.stroke()

  const canvasPixels = context.getImageData(
    0,
    0,
    TRIM_MASK_SIZE,
    TRIM_MASK_SIZE
  ).data
  const classifier = new Uint8Array(TRIM_MASK_SIZE * TRIM_MASK_SIZE)

  // Canvas rows run from top to bottom, while face UVs use bottom-to-top Y.
  // Flip the rows once here so the shader can sample the texture with uv() directly.
  for (let y = 0; y < TRIM_MASK_SIZE; y += 1) {
    const sourceY = TRIM_MASK_SIZE - 1 - y
    for (let x = 0; x < TRIM_MASK_SIZE; x += 1) {
      const sourceValue = canvasPixels[(sourceY * TRIM_MASK_SIZE + x) * 4] ?? 0
      classifier[y * TRIM_MASK_SIZE + x] =
        sourceValue <= 32 ? 0 : sourceValue >= 223 ? 255 : 128
    }
  }

  const classifierTexture = new DataTexture(
    classifier,
    TRIM_MASK_SIZE,
    TRIM_MASK_SIZE,
    RedFormat,
    UnsignedByteType
  )
  classifierTexture.magFilter = NearestFilter
  classifierTexture.minFilter = NearestFilter
  classifierTexture.generateMipmaps = false
  classifierTexture.flipY = false
  classifierTexture.needsUpdate = true
  return classifierTexture
}

export function createWebGpuTrimResources(
  primitives: TrimPrimitive[]
): WebGpuTrimResources | null {
  const { values, ranges } = packTrimTriangles(primitives)
  if (values.length === 0) {
    return null
  }

  const triangleAttribute = new StorageBufferAttribute(values, 4)
  const triangleStorage = storage(
    triangleAttribute,
    'vec4',
    triangleAttribute.count
  ).toReadOnly()
  const maskTextures: DataTexture[] = []
  const primitiveStates = primitives.map((primitive, primitiveIndex) => {
    const range = ranges[primitiveIndex]
    if (range.triangleCount === 0) {
      return null
    }

    const maskTexture = createTrimClassifierTexture(primitive.trimLoops)
    if (!maskTexture) {
      return null
    }

    maskTextures.push(maskTexture)
    return {
      maskTexture,
      ...range,
    }
  })

  if (primitiveStates.every((state) => state === null)) {
    return null
  }

  return {
    primitiveStates,
    triangleCount: values.length / 8,
    createMaterial: (state, parameters) => {
      const material = new MeshStandardNodeMaterial(parameters)
      const triangleOffset = int(uniform(state.triangleOffset))
      const triangleCount = int(uniform(state.triangleCount))

      material.maskNode = Fn(() => {
        const maskValue = texture(state.maskTexture, uv()).r
        const keepFragment = bool(true).toVar()

        If(maskValue.lessThan(0.25), () => {
          keepFragment.assign(bool(false))
        })
          .ElseIf(maskValue.greaterThan(0.75), () => {
            keepFragment.assign(bool(true))
          })
          .Else(() => {
            const inside = bool(false).toVar()
            const surfaceUv = uv()

            loopOverTrimTriangles(
              {
                start: int(0),
                end: triangleCount,
                type: 'int',
                condition: '<',
              },
              ({ i }) => {
                const storageIndex = triangleOffset.add(i).mul(int(2))
                const firstTwoPoints = triangleStorage.element(storageIndex)
                const thirdPoint = triangleStorage.element(storageIndex.add(1))
                const a = firstTwoPoints.xy
                const b = firstTwoPoints.zw
                const c = thirdPoint.xy

                // This is the winding-independent point-in-triangle test from
                // the Vulkan trim shader. Toggling for every containing fan
                // triangle implements the even-odd rule across all trim loops.
                const fromC = surfaceUv.sub(c)
                const s = a.sub(c).dot(vec2(fromC.y, fromC.x.negate()))
                const fromA = surfaceUv.sub(a)
                const t = b.sub(a).dot(vec2(fromA.y, fromA.x.negate()))
                const signsDiffer = s.mul(t).lessThan(0)
                const bothNonZero = s.notEqual(0).and(t.notEqual(0))
                const rejected = signsDiffer.and(bothNonZero)
                const fromB = surfaceUv.sub(b)
                const d = c.sub(b).dot(vec2(fromB.y, fromB.x.negate()))
                const dIsNegative = d.lessThan(0)
                const sumIsNonPositive = s.add(t).lessThanEqual(0)
                const onSameSide = dIsNegative
                  .and(sumIsNonPositive)
                  .or(dIsNegative.not().and(sumIsNonPositive.not()))
                const containsPoint = rejected
                  .not()
                  .and(d.equal(0).or(onSameSide))

                If(containsPoint, () => {
                  inside.assign(inside.not())
                })
              }
            )

            keepFragment.assign(inside)
          })

        return keepFragment
      })()

      return material
    },
    dispose: (renderer) => {
      maskTextures.forEach((maskTexture) => {
        maskTexture.dispose()
      })

      // Three does not expose storage-buffer disposal publicly yet. Use its
      // attribute manager when present so repeated render-packet refreshes do
      // not retain the old GPU buffer.
      const attributes = (
        renderer as {
          _attributes?: {
            delete: (attribute: StorageBufferAttribute) => unknown
          }
        }
      )._attributes
      attributes?.delete(triangleAttribute)
    },
  }
}
