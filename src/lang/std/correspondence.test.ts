import { expect, it } from 'vitest'
import fc from 'fast-check'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import {
  createArtifactCorrespondence,
  explanationPolicy,
  directPickingPolicy,
  resolvePickingCandidates,
} from '@src/lang/std/correspondence'
import { getCodeRefsFromEntityReference } from '@src/lang/std/legacyCorrespondence'

function codeRef(start: number, end: number, module = 0) {
  return {
    range: [start, end, module] as SourceRange,
    pathToNode: [],
    nodePath: { steps: [] },
  }
}
function graph(): ArtifactGraph {
  const artifacts: Artifact[] = [
    {
      type: 'segment',
      id: 'segment',
      pathId: 'path',
      codeRef: codeRef(10, 20),
      edgeIds: [],
      commonSurfaceIds: [],
    },
    {
      type: 'sweep',
      id: 'extrude',
      subType: 'extrusion',
      trajectoryId: null,
      method: 'new',
      codeRef: codeRef(30, 50),
      pathId: 'path',
      surfaceIds: ['wall'],
      edgeIds: [],
      consumed: false,
    },
    {
      type: 'wall',
      id: 'wall',
      segId: 'segment',
      faceCodeRef: codeRef(30, 50),
      cmdId: 'cmd',
      sweepId: 'extrude',
      pathIds: [],
      edgeCutEdgeIds: [],
    },
  ]
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]))
}

it('explains a wall through both its segment and generating operation without making it a profile candidate', () => {
  const query = createArtifactCorrespondence(graph())
  expect(query.forEntity({ type: 'face', face_id: 'wall' })).toEqual([
    expect.objectContaining({ relation: 'derived-from', range: [10, 20, 0] }),
    expect.objectContaining({ relation: 'generated-by', range: [30, 50, 0] }),
  ])
  const candidates = query.forCode([32, 32, 0], directPickingPolicy)
  expect(
    resolvePickingCandidates(
      [candidates],
      (entity) => entity.type === 'solid3d',
      false
    )
  ).toEqual([{ type: 'solid3d', solid3d_id: 'extrude' }])
  expect(
    resolvePickingCandidates(
      [candidates],
      (entity) => entity.type === 'solid2d',
      true
    )
  ).toBeInstanceOf(Error)
  expect(
    resolvePickingCandidates(
      [query.forCode([12, 12, 0])],
      (entity) => entity.type === 'face',
      true
    )
  ).toBeInstanceOf(Error)
})

it('preserves the legacy face-to-code policy after extraction', () => {
  expect(
    getCodeRefsFromEntityReference({ type: 'face', face_id: 'wall' }, graph())
  ).toEqual([{ range: [10, 20, 0] }, { range: [30, 50, 0] }])
})

it('requires one unambiguous direct candidate for each source selection even for a multiple argument', () => {
  const artifacts = graph()
  artifacts.set('second', {
    type: 'segment',
    id: 'second',
    pathId: 'path',
    codeRef: codeRef(10, 20),
    edgeIds: [],
    commonSurfaceIds: [],
  })
  const query = createArtifactCorrespondence(artifacts)
  expect(
    resolvePickingCandidates([query.forCode([12, 12, 0])], () => true, true)
  ).toBeInstanceOf(Error)
  expect(
    resolvePickingCandidates([query.forCode([32, 32, 0]), []], () => true, true)
  ).toBeInstanceOf(Error)
})

it('never matches offsets in another module and relation policies only remove explanations', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 100 }), (module) => {
      const query = createArtifactCorrespondence(graph())
      expect(query.forCode([10, 50, module])).toEqual([])
      const all = query.forEntity(
        { type: 'face', face_id: 'wall' },
        explanationPolicy
      )
      const direct = query.forEntity(
        { type: 'face', face_id: 'wall' },
        directPickingPolicy
      )
      expect(
        direct.every((item) =>
          all.some(
            (other) =>
              other.relation === item.relation &&
              other.sourceArtifactId === item.sourceArtifactId
          )
        )
      ).toBe(true)
      expect(direct.map((item) => item.relation)).toEqual(['generated-by'])
    })
  )
})
