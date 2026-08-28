import type {
  RenderPacket,
  RenderPacketBinarySection,
  RenderPacketEdge,
  RenderPacketMetadata,
  RenderPacketPrimitive,
  RenderPacketRegion,
  RenderPacketRegionLoop,
  RenderPacketSketchSegment,
} from '@src/lib/rustContext'

const RENDER_PACKET_VERSION = 1
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT
const UINT32_BYTES = Uint32Array.BYTES_PER_ELEMENT

export type LocalRenderPacketTrimLoop = {
  positions: Float32Array
}

export type LocalRenderPacketPrimitive = Omit<
  RenderPacketPrimitive,
  'trimLoops'
> & {
  trimLoops: LocalRenderPacketTrimLoop[]
}

export type LocalRenderPacketEdge = RenderPacketEdge & {
  positions: Float32Array
}

export type LocalRenderPacketSketchSegment = RenderPacketSketchSegment & {
  positions: Float32Array
}

export type LocalRenderPacketRegionLoop = RenderPacketRegionLoop & {
  positions: Float32Array
}

export type LocalRenderPacketRegion = Omit<
  RenderPacketRegion,
  'outerLoop' | 'holeLoops'
> & {
  outerLoop: LocalRenderPacketRegionLoop
  holeLoops: LocalRenderPacketRegionLoop[]
}

export type LocalRenderPacket = Omit<
  RenderPacketMetadata,
  'primitives' | 'edges' | 'sketches' | 'regions'
> & {
  vertices: Float32Array
  primitiveIndices: Uint32Array
  indices: Uint32Array
  primitives: LocalRenderPacketPrimitive[]
  edges: LocalRenderPacketEdge[]
  sketches: LocalRenderPacketSketchSegment[]
  regions: LocalRenderPacketRegion[]
}

function sectionView(
  packet: RenderPacket,
  section: RenderPacketBinarySection,
  elementSize: number,
  name: string
) {
  if (section.byteOffset % elementSize !== 0) {
    return new Error(`${name} is not ${elementSize}-byte aligned`)
  }
  if (section.byteLength % elementSize !== 0) {
    return new Error(`${name} length is not divisible by ${elementSize}`)
  }

  const end = section.byteOffset + section.byteLength
  if (end > packet.data.byteLength) {
    return new Error(`${name} exceeds the render packet binary payload`)
  }

  return {
    byteOffset: packet.data.byteOffset + section.byteOffset,
    elementCount: section.byteLength / elementSize,
  }
}

function float32Section(
  packet: RenderPacket,
  section: RenderPacketBinarySection,
  name: string
) {
  const view = sectionView(packet, section, FLOAT32_BYTES, name)
  if (view instanceof Error) {
    return view
  }
  return new Float32Array(
    packet.data.buffer,
    view.byteOffset,
    view.elementCount
  )
}

function uint32Section(
  packet: RenderPacket,
  section: RenderPacketBinarySection,
  name: string
) {
  const view = sectionView(packet, section, UINT32_BYTES, name)
  if (view instanceof Error) {
    return view
  }
  return new Uint32Array(packet.data.buffer, view.byteOffset, view.elementCount)
}

function pointRange(
  values: Float32Array,
  firstPoint: number,
  pointCount: number,
  componentCount: number,
  name: string
) {
  const firstValue = firstPoint * componentCount
  const endValue = firstValue + pointCount * componentCount
  if (
    !Number.isSafeInteger(firstValue) ||
    !Number.isSafeInteger(endValue) ||
    firstValue < 0 ||
    endValue > values.length
  ) {
    return new Error(`${name} exceeds its render packet point section`)
  }
  return values.subarray(firstValue, endValue)
}

export function decodeRenderPacket(packet: RenderPacket) {
  const { metadata } = packet
  if (metadata.version !== RENDER_PACKET_VERSION) {
    return new Error(
      `Unsupported render packet version ${metadata.version}; expected ${RENDER_PACKET_VERSION}`
    )
  }

  const stride = metadata.vertexLayout.stride
  if (stride === 0 || stride % FLOAT32_BYTES !== 0) {
    return new Error('Render packet vertex stride is not float32 aligned')
  }
  for (const [name, offset, size] of [
    ['position', metadata.vertexLayout.positionOffset, 12],
    ['normal', metadata.vertexLayout.normalOffset, 12],
    ['uv', metadata.vertexLayout.uvOffset, 8],
  ] as const) {
    if (offset % FLOAT32_BYTES !== 0 || offset + size > stride) {
      return new Error(`Render packet ${name} vertex attribute is invalid`)
    }
  }

  const vertices = float32Section(
    packet,
    metadata.sections.vertices,
    'vertex section'
  )
  if (vertices instanceof Error) {
    return vertices
  }
  const primitiveIndices = uint32Section(
    packet,
    metadata.sections.primitiveIndices,
    'primitive-index section'
  )
  if (primitiveIndices instanceof Error) {
    return primitiveIndices
  }
  const indices = uint32Section(
    packet,
    metadata.sections.indices,
    'index section'
  )
  if (indices instanceof Error) {
    return indices
  }
  const trimPoints = float32Section(
    packet,
    metadata.sections.trimPoints,
    'trim-point section'
  )
  if (trimPoints instanceof Error) {
    return trimPoints
  }
  const edgePoints = float32Section(
    packet,
    metadata.sections.edgePoints,
    'edge-point section'
  )
  if (edgePoints instanceof Error) {
    return edgePoints
  }
  const sketchPoints = float32Section(
    packet,
    metadata.sections.sketchPoints,
    'sketch-point section'
  )
  if (sketchPoints instanceof Error) {
    return sketchPoints
  }
  const regionPoints = float32Section(
    packet,
    metadata.sections.regionPoints,
    'region-point section'
  )
  if (regionPoints instanceof Error) {
    return regionPoints
  }

  const strideElements = stride / FLOAT32_BYTES
  if (vertices.length % strideElements !== 0) {
    return new Error('Vertex section does not contain complete vertices')
  }
  const vertexCount = vertices.length / strideElements
  if (primitiveIndices.length !== vertexCount) {
    return new Error(
      'Primitive-index section does not contain one index per vertex'
    )
  }

  const primitives: LocalRenderPacketPrimitive[] = []
  for (const primitive of metadata.primitives) {
    if (
      primitive.firstVertex + primitive.vertexCount > vertexCount ||
      primitive.firstIndex + primitive.indexCount > indices.length
    ) {
      return new Error(
        `Primitive ${primitive.primitiveIndex} exceeds the vertex or index section`
      )
    }

    const trimLoops: LocalRenderPacketTrimLoop[] = []
    for (const loop of primitive.trimLoops) {
      const positions = pointRange(
        trimPoints,
        loop.firstPoint,
        loop.pointCount,
        2,
        `Primitive ${primitive.primitiveIndex} trim loop`
      )
      if (positions instanceof Error) {
        return positions
      }
      trimLoops.push({ positions })
    }
    primitives.push({ ...primitive, trimLoops })
  }

  const edges: LocalRenderPacketEdge[] = []
  for (const edge of metadata.edges) {
    const positions = pointRange(
      edgePoints,
      edge.firstPoint,
      edge.pointCount,
      3,
      `Edge ${edge.edgeIndex}`
    )
    if (positions instanceof Error) {
      return positions
    }
    edges.push({ ...edge, positions })
  }

  const sketches: LocalRenderPacketSketchSegment[] = []
  for (const sketch of metadata.sketches) {
    const positions = pointRange(
      sketchPoints,
      sketch.firstPoint,
      sketch.pointCount,
      3,
      `Sketch segment ${sketch.segmentIndex}`
    )
    if (positions instanceof Error) {
      return positions
    }
    sketches.push({ ...sketch, positions })
  }

  const decodeRegionLoop = (loop: RenderPacketRegionLoop, name: string) => {
    const positions = pointRange(
      regionPoints,
      loop.firstPoint,
      loop.pointCount,
      2,
      name
    )
    if (positions instanceof Error) {
      return positions
    }
    return { ...loop, positions }
  }

  const regions: LocalRenderPacketRegion[] = []
  for (const [regionIndex, region] of metadata.regions.entries()) {
    const outerLoop = decodeRegionLoop(
      region.outerLoop,
      `Region ${regionIndex} outer loop`
    )
    if (outerLoop instanceof Error) {
      return outerLoop
    }
    const holeLoops: LocalRenderPacketRegionLoop[] = []
    for (const [holeIndex, loop] of region.holeLoops.entries()) {
      const holeLoop = decodeRegionLoop(
        loop,
        `Region ${regionIndex} hole ${holeIndex}`
      )
      if (holeLoop instanceof Error) {
        return holeLoop
      }
      holeLoops.push(holeLoop)
    }
    regions.push({ ...region, outerLoop, holeLoops })
  }

  return {
    ...metadata,
    vertices,
    primitiveIndices,
    indices,
    primitives,
    edges,
    sketches,
    regions,
  } satisfies LocalRenderPacket
}
