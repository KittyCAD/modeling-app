import { describe, expect, it, vi } from 'vitest'
import { resolveSourceEdgeSelections } from '@src/lang/modifyAst/resolveSourceEdgeSelections'
import type { ArtifactGraph, SegmentArtifact } from '@src/lang/wasm'
import type {
  EntityReference,
  Selection,
} from '@src/machines/modelingSharedTypes'

const codeRef = {
  range: [0, 10, 0] as [number, number, number],
  nodePath: { steps: [] },
  pathToNode: [],
}
const segment: SegmentArtifact & { type: 'segment' } = {
  type: 'segment' as const,
  id: 'segment',
  pathId: 'path',
  surfaceId: 'wall',
  codeRef,
}
const selection: Selection = { artifact: segment, codeRef }
const edge: EntityReference = {
  type: 'edge',
  side_faces: ['wall', 'end-cap'],
  end_faces: ['bound-a', 'bound-b'],
  index: 2,
}
const graph = (): ArtifactGraph => new Map([[segment.id, segment]])

describe('resolveSourceEdgeSelections', () => {
  it('preserves the engine reference including cap, end faces, and index', async () => {
    const query = vi.fn(async () => edge)
    const result = await resolveSourceEdgeSelections(
      { graphSelections: [selection], otherSelections: [] },
      graph(),
      query
    )
    expect(query).toHaveBeenCalledExactlyOnceWith(segment.id)
    expect(result).toEqual({
      graphSelections: [{ ...selection, entityRef: edge }],
      otherSelections: [],
    })
    expect(selection.entityRef).toBeUndefined()
  })

  it('does not query or replace a reference already chosen in the viewport', async () => {
    const query = vi.fn()
    const selected = { ...selection, entityRef: edge }
    const result = await resolveSourceEdgeSelections(
      { graphSelections: [selected], otherSelections: [] },
      graph(),
      query
    )
    expect(query).not.toHaveBeenCalled()
    expect(result).toEqual({ graphSelections: [selected], otherSelections: [] })
  })

  it('queries the swept region segment mapped from a sketch segment', async () => {
    const source = { ...segment, surfaceId: undefined }
    const mapped = {
      ...segment,
      id: 'region-segment',
      originalSegId: source.id,
    }
    const artifacts: ArtifactGraph = new Map<
      string,
      SegmentArtifact & { type: 'segment' }
    >([
      [source.id, source],
      [mapped.id, mapped],
    ])
    const query = vi.fn(async () => edge)
    await resolveSourceEdgeSelections(
      {
        graphSelections: [{ ...selection, artifact: source }],
        otherSelections: [],
      },
      artifacts,
      query
    )
    expect(query).toHaveBeenCalledExactlyOnceWith(mapped.id)
  })

  it('reuses a topology query for repeated selections of the same segment', async () => {
    const query = vi.fn(async () => edge)
    await resolveSourceEdgeSelections(
      { graphSelections: [selection, selection], otherSelections: [] },
      graph(),
      query
    )
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('returns query errors instead of guessing the start cap', async () => {
    const error = new Error('Topology unavailable')
    const result = await resolveSourceEdgeSelections(
      { graphSelections: [selection], otherSelections: [] },
      graph(),
      async () => error
    )
    expect(result).toBe(error)
  })

  it('returns rejected topology requests as errors', async () => {
    const error = new Error('Connection closed')
    const result = await resolveSourceEdgeSelections(
      { graphSelections: [selection], otherSelections: [] },
      graph(),
      async () => {
        throw error
      }
    )
    expect(result).toBe(error)
  })

  it('rejects a response that does not identify an edge', async () => {
    const result = await resolveSourceEdgeSelections(
      { graphSelections: [selection], otherSelections: [] },
      graph(),
      async () => ({ type: 'face', face_id: 'wall' })
    )
    expect(result).toBeInstanceOf(Error)
  })

  it('rejects a sketch segment mapping to different model edges', async () => {
    const mapped = {
      ...segment,
      id: 'second-segment',
      originalSegId: segment.id,
    }
    const artifacts = graph()
    artifacts.set(mapped.id, mapped)
    const result = await resolveSourceEdgeSelections(
      { graphSelections: [selection], otherSelections: [] },
      artifacts,
      async (id) => ({ type: 'edge', side_faces: ['wall', id] })
    )
    expect(result).toEqual(
      new Error(
        'The sketch segment belongs to multiple model edges. Select the edge in the scene.'
      )
    )
  })
})
