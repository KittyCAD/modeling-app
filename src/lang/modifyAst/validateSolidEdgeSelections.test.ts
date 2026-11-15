import { describe, expect, it } from 'vitest'
import { validateSolidEdgeSelections } from '@src/lang/modifyAst/validateSolidEdgeSelections'
import type { ArtifactGraph, SegmentArtifact } from '@src/lang/wasm'
import type { Selection } from '@src/machines/modelingSharedTypes'

const codeRef = {
  range: [0, 10, 0] as [number, number, number],
  nodePath: { steps: [] },
  pathToNode: [],
}
const segment: SegmentArtifact & { type: 'segment' } = {
  type: 'segment',
  id: 'segment',
  edgeIds: [],
  commonSurfaceIds: [],
  pathId: 'path',
  surfaceId: 'wall',
  codeRef,
}
const graph: ArtifactGraph = new Map([[segment.id, segment]])
const validate = (...graphSelections: Selection[]) =>
  validateSolidEdgeSelections({ graphSelections, otherSelections: [] }, graph)

describe('validateSolidEdgeSelections', () => {
  it('rejects a raw segment artifact even with stored adjacency', () => {
    expect(validate({ artifact: segment, codeRef })).toBeInstanceOf(Error)
  })

  it('rejects a segment selected by its source range alone', () => {
    expect(validate({ codeRef })).toBeInstanceOf(Error)
  })

  it('rejects segment entity references', () => {
    expect(
      validate({
        entityRef: { type: 'segment', segment_id: segment.id, path_id: 'path' },
      })
    ).toBeInstanceOf(Error)
  })

  it('rejects actual Solid2D edges, which are still sketch geometry', () => {
    expect(
      validate({
        entityRef: { type: 'solid2d_edge', edge_id: segment.id },
        artifact: segment,
        codeRef,
      })
    ).toBeInstanceOf(Error)
  })

  it('rejects unswept sketch segments too', () => {
    expect(
      validate({ artifact: { ...segment, surfaceId: undefined }, codeRef })
    ).toBeInstanceOf(Error)
  })

  it('preserves a complete edge reference even when anchored to a segment', () => {
    const selection: Selection = {
      artifact: segment,
      codeRef,
      entityRef: {
        type: 'edge',
        side_faces: ['wall', 'cap'],
        end_faces: ['bound-a', 'bound-b'],
        index: 2,
      },
    }
    expect(validate(selection)).toBeUndefined()
    expect(selection.entityRef).toEqual({
      type: 'edge',
      side_faces: ['wall', 'cap'],
      end_faces: ['bound-a', 'bound-b'],
      index: 2,
    })
  })

  it('allows explicit faces whose source anchor is a sketch segment', () => {
    expect(
      validate({
        artifact: segment,
        codeRef,
        entityRef: { type: 'face', face_id: 'wall' },
      })
    ).toBeUndefined()
  })

  it('rejects mixed selections if any raw segment remains', () => {
    expect(
      validate(
        { entityRef: { type: 'edge', side_faces: ['wall', 'cap'] } },
        { artifact: segment, codeRef }
      )
    ).toBeInstanceOf(Error)
  })
})
