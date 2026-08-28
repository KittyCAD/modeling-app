import type { RenderPacket } from '@src/lib/rustContext'
import { describe, expect, it } from 'vitest'

import { decodeRenderPacket } from './renderPacketBinary'

function writeFloat32Values(
  view: DataView,
  byteOffset: number,
  values: number[]
) {
  values.forEach((value, index) => {
    view.setFloat32(
      byteOffset + index * Float32Array.BYTES_PER_ELEMENT,
      value,
      true
    )
  })
}

function makePacket(): RenderPacket {
  const data = new Uint8Array(180)
  const view = new DataView(data.buffer)

  writeFloat32Values(view, 0, [1, 2, 3, 0, 0, 1, 0.1, 0.2])
  writeFloat32Values(view, 32, [4, 5, 6, 0, 1, 0, 0.3, 0.4])
  view.setUint32(64, 0, true)
  view.setUint32(68, 0, true)
  ;[0, 1, 0].forEach((value, index) => {
    view.setUint32(72 + index * Uint32Array.BYTES_PER_ELEMENT, value, true)
  })
  writeFloat32Values(view, 84, [0, 0, 1, 0, 0, 1])
  writeFloat32Values(view, 108, [0, 0, 0, 1, 0, 0])
  writeFloat32Values(view, 132, [0, 0, 0, 0, 1, 0])
  writeFloat32Values(view, 156, [0, 0, 1, 0, 0, 1])

  return {
    metadata: {
      version: 1,
      vertexLayout: {
        stride: 32,
        positionOffset: 0,
        normalOffset: 12,
        uvOffset: 24,
      },
      sections: {
        vertices: { byteOffset: 0, byteLength: 64 },
        primitiveIndices: { byteOffset: 64, byteLength: 8 },
        indices: { byteOffset: 72, byteLength: 12 },
        trimPoints: { byteOffset: 84, byteLength: 24 },
        edgePoints: { byteOffset: 108, byteLength: 24 },
        sketchPoints: { byteOffset: 132, byteLength: 24 },
        regionPoints: { byteOffset: 156, byteLength: 24 },
      },
      bodyMaterials: [],
      primitives: [
        {
          firstVertex: 0,
          vertexCount: 2,
          firstIndex: 0,
          indexCount: 3,
          trimLoops: [{ firstPoint: 0, pointCount: 3 }],
          objectId: '00000000-0000-0000-0000-000000000001',
          bodyId: '00000000-0000-0000-0000-000000000001',
          faceId: '00000000-0000-0000-0000-000000000002',
          faceIndex: 4,
          primitiveIndex: 0,
        },
      ],
      edges: [
        {
          firstPoint: 0,
          pointCount: 2,
          objectId: '00000000-0000-0000-0000-000000000001',
          bodyId: '00000000-0000-0000-0000-000000000001',
          edgeId: '00000000-0000-0000-0000-000000000003',
          edgeIndex: 2,
        },
      ],
      sketches: [
        {
          firstPoint: 0,
          pointCount: 2,
          sketchId: '00000000-0000-0000-0000-000000000004',
          segmentId: null,
          segmentIndex: 0,
          holeIndex: null,
          closed: false,
          sourceRange: null,
          nodePath: null,
        },
      ],
      regions: [
        {
          planeOrigin: { x: 0, y: 0, z: 0 },
          planeXAxis: { x: 1, y: 0, z: 0 },
          planeYAxis: { x: 0, y: 1, z: 0 },
          outerLoop: { firstPoint: 0, pointCount: 3 },
          holeLoops: [],
          sketchId: '00000000-0000-0000-0000-000000000004',
          regionId: '00000000-0000-0000-0000-000000000005',
          parentId: '00000000-0000-0000-0000-000000000004',
          queryPoint: { x: 0.25, y: 0.25 },
        },
      ],
    },
    data,
  }
}

describe('decodeRenderPacket', () => {
  it('creates typed views over all binary sections', () => {
    const packet = decodeRenderPacket(makePacket())

    expect(packet).not.toBeInstanceOf(Error)
    if (packet instanceof Error) {
      return
    }

    expect(packet.vertices).toHaveLength(16)
    expect(Array.from(packet.primitiveIndices)).toEqual([0, 0])
    expect(Array.from(packet.indices)).toEqual([0, 1, 0])
    expect(Array.from(packet.primitives[0].trimLoops[0].positions)).toEqual([
      0, 0, 1, 0, 0, 1,
    ])
    expect(Array.from(packet.edges[0].positions)).toEqual([0, 0, 0, 1, 0, 0])
    expect(Array.from(packet.sketches[0].positions)).toEqual([0, 0, 0, 0, 1, 0])
    expect(Array.from(packet.regions[0].outerLoop.positions)).toEqual([
      0, 0, 1, 0, 0, 1,
    ])
  })

  it('rejects an out-of-bounds section', () => {
    const packet = makePacket()
    packet.metadata.sections.indices.byteLength = packet.data.byteLength

    expect(decodeRenderPacket(packet)).toEqual(
      new Error('index section exceeds the render packet binary payload')
    )
  })
})
