import {
  DataArrayTexture,
  DataTexture,
  FrontSide,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
} from 'three'
import {
  attribute,
  bool,
  Fn,
  If,
  int,
  Loop,
  storage,
  texture,
  uv,
  varying,
  vec2,
} from 'three/tsl'
import {
  MeshStandardNodeMaterial,
  type Node,
  StorageBufferAttribute,
} from 'three/webgpu'

const HYBRID_TRIM_MASK_SIZE = 128
const HYBRID_TRIM_MASK_BOUNDARY_WIDTH = 4
const COMPLEX_TRIM_MASK_SIZE = 2048
const MAX_HYBRID_MASK_LAYERS = 256
const loopOverTrimTriangles = Loop as unknown as (
  parameters: {
    start: Node<'int'>
    end: Node<'int'>
    type: 'int'
    condition: '<'
  },
  callback: (inputs: { i: Node<'int'> }) => void
) => void

type TrimLoop = {
  positions: ArrayLike<number>
}

type TrimPrimitive = {
  primitiveIndex: number
  materialIndex: number
  trimMode: 'none' | 'hybrid' | 'complexTexture'
  trimLoops: TrimLoop[]
}

type SurfaceMaterial = {
  baseColor: { r: number; g: number; b: number; a: number }
  metalness: number
  roughness: number
}

type TrimTriangleRange = {
  triangleOffset: number
  triangleCount: number
}

export type WebGpuSurfaceBatch = {
  primitiveOffsets: number[]
  material: MeshStandardNodeMaterial
  transparent: boolean
  hybridMaskLayerCount: number
}

export type WebGpuComplexSurface = {
  primitiveOffset: number
  material: MeshStandardNodeMaterial
}

export type WebGpuSurfaceResources = {
  batches: WebGpuSurfaceBatch[]
  complexSurfaces: WebGpuComplexSurface[]
  dispose: (renderer: unknown) => void
  triangleCount: number
  hybridMaskLayerCount: number
  complexMaskCount: number
}

/**
 * Flatten each trim loop into the same triangle fan used by trimSurface.slang.
 * Two vec4s store each triangle so every batched material can share one buffer.
 */
export function packTrimTriangles(
  primitives: Pick<TrimPrimitive, 'trimLoops'>[]
) {
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
  trimLoops: TrimLoop[],
  size: number
) {
  let hasValidLoop = false

  context.beginPath()
  for (const loop of trimLoops) {
    const { positions } = loop
    if (positions.length < 6) {
      continue
    }

    hasValidLoop = true
    context.moveTo(positions[0] * (size - 1), (1 - positions[1]) * (size - 1))
    for (let index = 2; index < positions.length; index += 2) {
      context.lineTo(
        positions[index] * (size - 1),
        (1 - positions[index + 1]) * (size - 1)
      )
    }
    context.closePath()
  }

  return hasValidLoop
}

function rasterizeTrimMask(
  trimLoops: TrimLoop[],
  size: number,
  boundaryWidth: number | null
) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return null
  }

  context.fillStyle = 'black'
  context.fillRect(0, 0, size, size)
  if (!addTrimLoopsToCanvasPath(context, trimLoops, size)) {
    return null
  }

  context.fillStyle = 'white'
  context.fill('evenodd')
  if (boundaryWidth !== null) {
    // Black and white texels are safe fast paths. Gray marks a conservative
    // boundary band where the fragment shader runs the exact triangle test.
    context.strokeStyle = 'rgb(128, 128, 128)'
    context.lineWidth = boundaryWidth
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.stroke()
  }

  const canvasPixels = context.getImageData(0, 0, size, size).data
  const mask = new Uint8Array(size * size)

  // Canvas rows run top-to-bottom while face UVs run bottom-to-top.
  for (let y = 0; y < size; y += 1) {
    const sourceY = size - 1 - y
    for (let x = 0; x < size; x += 1) {
      const sourceValue = canvasPixels[(sourceY * size + x) * 4] ?? 0
      mask[y * size + x] =
        boundaryWidth === null
          ? sourceValue >= 128
            ? 255
            : 0
          : sourceValue <= 32
            ? 0
            : sourceValue >= 223
              ? 255
              : 128
    }
  }

  return mask
}

function configureMaskTexture(texture: DataArrayTexture | DataTexture) {
  texture.format = RedFormat
  texture.type = UnsignedByteType
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

function createHybridMaskArray(primitives: TrimPrimitive[]) {
  const layerCount = Math.max(primitives.length, 1)
  const layerSize = HYBRID_TRIM_MASK_SIZE * HYBRID_TRIM_MASK_SIZE
  const masks = new Uint8Array(layerSize * layerCount)

  if (primitives.length === 0) {
    masks.fill(255)
  } else {
    primitives.forEach((primitive, layer) => {
      const mask = rasterizeTrimMask(
        primitive.trimLoops,
        HYBRID_TRIM_MASK_SIZE,
        HYBRID_TRIM_MASK_BOUNDARY_WIDTH
      )
      if (mask) {
        masks.set(mask, layer * layerSize)
      }
    })
  }

  return configureMaskTexture(
    new DataArrayTexture(
      masks,
      HYBRID_TRIM_MASK_SIZE,
      HYBRID_TRIM_MASK_SIZE,
      layerCount
    )
  ) as DataArrayTexture
}

function createComplexMaskTexture(primitive: TrimPrimitive) {
  const mask = rasterizeTrimMask(
    primitive.trimLoops,
    COMPLEX_TRIM_MASK_SIZE,
    null
  )
  if (!mask) {
    return null
  }

  return configureMaskTexture(
    new DataTexture(
      mask,
      COMPLEX_TRIM_MASK_SIZE,
      COMPLEX_TRIM_MASK_SIZE,
      RedFormat,
      UnsignedByteType
    )
  ) as DataTexture
}

function deleteStorageAttribute(
  renderer: unknown,
  attribute: StorageBufferAttribute
) {
  // Three does not expose storage-buffer disposal publicly yet.
  const attributes = (
    renderer as {
      _attributes?: {
        delete: (attribute: StorageBufferAttribute) => unknown
      }
    }
  )._attributes
  attributes?.delete(attribute)
}

export function createWebGpuSurfaceResources(
  primitives: TrimPrimitive[],
  bodyMaterials: SurfaceMaterial[],
  trimmingEnabled: boolean
): WebGpuSurfaceResources {
  const { values: triangleValues, ranges } = packTrimTriangles(primitives)
  // WebGPU does not permit zero-sized storage bindings.
  const triangleAttribute = new StorageBufferAttribute(
    triangleValues.length > 0 ? triangleValues : new Float32Array(4),
    4
  )
  const triangleStorage = storage(
    triangleAttribute,
    'vec4',
    triangleAttribute.count
  ).toReadOnly()

  const materialCount = Math.max(bodyMaterials.length, 1)
  const materialValues = new Float32Array(materialCount * 8)
  if (bodyMaterials.length === 0) {
    materialValues.set([0.9, 0.9, 0.9, 1, 0.6, 0.4, 0, 0])
  } else {
    bodyMaterials.forEach((material, materialIndex) => {
      const offset = materialIndex * 8
      materialValues.set(
        [
          material.baseColor.r,
          material.baseColor.g,
          material.baseColor.b,
          material.baseColor.a,
          material.metalness,
          material.roughness,
          0,
          0,
        ],
        offset
      )
    })
  }
  const materialAttribute = new StorageBufferAttribute(materialValues, 4)
  const materialStorage = storage(
    materialAttribute,
    'vec4',
    materialAttribute.count
  ).toReadOnly()

  // x: material index, y: trim triangle offset, z: triangle count, w: mask layer.
  const maxPrimitiveIndex = primitives.reduce(
    (maximum, primitive) => Math.max(maximum, primitive.primitiveIndex),
    0
  )
  const primitiveValues = new Float32Array((maxPrimitiveIndex + 1) * 4)
  primitives.forEach((primitive, primitiveOffset) => {
    const range = ranges[primitiveOffset]
    const offset = primitive.primitiveIndex * 4
    primitiveValues[offset] = Math.min(
      Math.max(primitive.materialIndex, 0),
      materialCount - 1
    )
    primitiveValues[offset + 1] = range.triangleOffset
    primitiveValues[offset + 2] = range.triangleCount
  })
  const primitiveAttribute = new StorageBufferAttribute(primitiveValues, 4)
  const primitiveStorage = storage(
    primitiveAttribute,
    'vec4',
    primitiveAttribute.count
  ).toReadOnly()

  const textures: Array<DataArrayTexture | DataTexture> = []
  const batches: WebGpuSurfaceBatch[] = []
  const complexSurfaces: WebGpuComplexSurface[] = []

  const createPbrMaterial = (transparent: boolean) => {
    const material = new MeshStandardNodeMaterial({
      side: FrontSide,
      transparent,
      depthWrite: !transparent,
    })
    const primitiveIndexAttribute = attribute(
      'primitiveIndex',
      'uint'
    ) as unknown as Node<'uint'>
    const primitiveIndex = int(varying(primitiveIndexAttribute))
    const primitiveData = primitiveStorage.element(primitiveIndex)
    const materialIndex = int(primitiveData.x)
    const baseColor = materialStorage.element(materialIndex.mul(2))
    const pbrParameters = materialStorage.element(materialIndex.mul(2).add(1))

    material.colorNode = baseColor.rgb
    material.opacityNode = baseColor.a
    material.metalnessNode = pbrParameters.x
    material.roughnessNode = pbrParameters.y
    return { material, primitiveData }
  }

  const createHybridMaterial = (
    maskTexture: DataArrayTexture,
    transparent: boolean
  ) => {
    const { material, primitiveData } = createPbrMaterial(transparent)

    material.maskNode = Fn(() => {
      const keepFragment = bool(true).toVar()
      const triangleOffset = int(primitiveData.y)
      const triangleCount = int(primitiveData.z)

      If(triangleCount.greaterThan(0), () => {
        const maskLayer = int(primitiveData.w)
        const maskValue = texture(maskTexture, uv()).depth(maskLayer).r

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
                const storageIndex = triangleOffset.add(i).mul(2)
                const firstTwoPoints = triangleStorage.element(storageIndex)
                const thirdPoint = triangleStorage.element(storageIndex.add(1))
                const a = firstTwoPoints.xy
                const b = firstTwoPoints.zw
                const c = thirdPoint.xy

                // Winding-independent point-in-triangle test from the Vulkan
                // trim shader. Toggling implements even-odd across all loops.
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
      })

      return keepFragment
    })()

    return material
  }

  const createComplexMaterial = (
    maskTexture: DataTexture,
    transparent: boolean
  ) => {
    const { material } = createPbrMaterial(transparent)
    material.maskNode = texture(maskTexture, uv()).r.greaterThan(0.5)
    return material
  }

  for (const transparent of [false, true]) {
    const isTransparent = (primitive: TrimPrimitive) =>
      (bodyMaterials[primitive.materialIndex]?.baseColor.a ?? 1) < 1
    const matchingOffsets = primitives
      .map((primitive, primitiveOffset) => ({ primitive, primitiveOffset }))
      .filter(({ primitive }) => isTransparent(primitive) === transparent)

    const complexOffsets = matchingOffsets.filter(
      ({ primitive, primitiveOffset }) =>
        trimmingEnabled &&
        primitive.trimMode === 'complexTexture' &&
        ranges[primitiveOffset].triangleCount > 0
    )
    const hybridOffsets = matchingOffsets.filter(
      ({ primitive, primitiveOffset }) =>
        trimmingEnabled &&
        primitive.trimMode === 'hybrid' &&
        ranges[primitiveOffset].triangleCount > 0
    )
    const noTrimOffsets = matchingOffsets.filter(
      ({ primitive, primitiveOffset }) =>
        !trimmingEnabled ||
        primitive.trimMode === 'none' ||
        ranges[primitiveOffset].triangleCount === 0
    )

    const hybridPages: (typeof hybridOffsets)[] = []
    for (
      let first = 0;
      first < hybridOffsets.length;
      first += MAX_HYBRID_MASK_LAYERS
    ) {
      hybridPages.push(
        hybridOffsets.slice(first, first + MAX_HYBRID_MASK_LAYERS)
      )
    }
    if (hybridPages.length === 0 && noTrimOffsets.length > 0) {
      hybridPages.push([])
    }

    hybridPages.forEach((page, pageIndex) => {
      page.forEach(({ primitive }, layer) => {
        primitiveValues[primitive.primitiveIndex * 4 + 3] = layer
      })
      const maskTexture = createHybridMaskArray(
        page.map(({ primitive }) => primitive)
      )
      textures.push(maskTexture)
      batches.push({
        primitiveOffsets: [
          ...(pageIndex === 0
            ? noTrimOffsets.map(({ primitiveOffset }) => primitiveOffset)
            : []),
          ...page.map(({ primitiveOffset }) => primitiveOffset),
        ],
        material: createHybridMaterial(maskTexture, transparent),
        transparent,
        hybridMaskLayerCount: page.length,
      })
    })

    complexOffsets.forEach(({ primitive, primitiveOffset }) => {
      const maskTexture = createComplexMaskTexture(primitive)
      if (!maskTexture) {
        return
      }
      textures.push(maskTexture)
      complexSurfaces.push({
        primitiveOffset,
        material: createComplexMaterial(maskTexture, transparent),
      })
    })
  }

  primitiveAttribute.needsUpdate = true

  return {
    batches,
    complexSurfaces,
    triangleCount: triangleValues.length / 8,
    hybridMaskLayerCount: batches.reduce(
      (count, batch) => count + batch.hybridMaskLayerCount,
      0
    ),
    complexMaskCount: complexSurfaces.length,
    dispose: (renderer) => {
      textures.forEach((maskTexture) => {
        maskTexture.dispose()
      })
      deleteStorageAttribute(renderer, triangleAttribute)
      deleteStorageAttribute(renderer, materialAttribute)
      deleteStorageAttribute(renderer, primitiveAttribute)
    },
  }
}
