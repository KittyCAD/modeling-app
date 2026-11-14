import { expect, it } from 'vitest'
import { Mesh } from 'three'
import type { ArtifactGraph } from '@src/lang/wasm'
import { entityStyleTargets } from '@src/clientSideScene/localRenderer/entityStyleTargets'

it('expands a body to rendered faces and deduplicates overlapping references without selecting anything', () => {
  const first = new Mesh(),
    second = new Mesh()
  const graph: ArtifactGraph = new Map([
    [
      'body',
      {
        type: 'sweep',
        id: 'body',
        subType: 'extrusion',
        surfaceIds: ['a', 'b', 'missing'],
        edgeIds: [],
        codeRef: { range: [0, 10, 0], pathToNode: [], nodePath: { steps: [] } },
        consumed: false,
        method: 'new',
        trajectoryId: null,
      },
    ],
  ])
  const byId = (id: string) =>
    id === 'a' ? [first] : id === 'b' ? [second] : []
  expect(
    entityStyleTargets(
      [
        { type: 'solid3d', solid3d_id: 'body' },
        { type: 'face', face_id: 'a' },
      ],
      graph,
      byId
    )
  ).toEqual([first, second])
})
it('does not mistake adjacent faces for the edge being styled', () => {
  const face = new Mesh()
  expect(
    entityStyleTargets(
      [{ type: 'edge', side_faces: ['a', 'b'], end_faces: [], index: 0 }],
      new Map(),
      () => [face]
    )
  ).toEqual([])
})
