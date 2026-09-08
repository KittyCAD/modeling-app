import type { Artifact, CodeRef } from '@rust/kcl-lib/bindings/Artifact'
import type { OpArg } from '@rust/kcl-lib/bindings/Operation'

import { retrieveFaceSelectionsFromOpArgs } from '@src/lang/modifyAst/faces'
import type { ArtifactGraph } from '@src/lang/wasm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLib', () => ({
  modelingStdLibCall: vi.fn(),
  modelingStdLibCommandName: vi.fn(),
}))

const codeRef: CodeRef = {
  range: [0, 0, 0],
  pathToNode: [['body', 'Program']],
  nodePath: { steps: [] },
}

describe('retrieveFaceSelectionsFromOpArgs', () => {
  it('retrieves a tagged wall when editing chained holes', () => {
    const path: Artifact = {
      type: 'path',
      id: 'region-1',
      subType: 'region',
      planeId: 'plane-1',
      segIds: ['segment-1'],
      consumed: true,
      sweepId: 'sweep-1',
      trajectorySweepId: null,
      codeRef,
    }
    const segment: Artifact = {
      type: 'segment',
      id: 'segment-1',
      pathId: path.id,
      edgeIds: [],
      commonSurfaceIds: ['wall-1'],
      codeRef,
    }
    const sweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      subType: 'extrusion',
      pathId: path.id,
      surfaceIds: ['wall-1'],
      edgeIds: [],
      codeRef,
      trajectoryId: null,
      method: 'merge',
      consumed: true,
    }
    const wall: Artifact = {
      type: 'wall',
      id: 'wall-1',
      segId: segment.id,
      sweepId: sweep.id,
      pathIds: [],
      edgeCutEdgeIds: [],
      faceCodeRef: codeRef,
      cmdId: 'wall-command-1',
    }
    const holeTool: Artifact = {
      type: 'sweep',
      id: 'hole-tool',
      subType: 'extrusion',
      pathId: 'hole-tool-path',
      surfaceIds: [],
      edgeIds: [],
      codeRef,
      trajectoryId: null,
      method: 'new',
      consumed: true,
    }
    const firstHole: Artifact = {
      type: 'compositeSolid',
      id: 'hole-1',
      consumed: true,
      subType: 'subtract',
      solidIds: [path.id],
      toolIds: [holeTool.id],
      codeRef,
      compositeSolidId: 'hole-2',
    }
    const secondHole: Artifact = {
      type: 'compositeSolid',
      id: 'hole-2',
      consumed: true,
      subType: 'subtract',
      solidIds: [firstHole.id],
      toolIds: [holeTool.id],
      codeRef,
      compositeSolidId: 'hole-3',
    }
    const artifactGraph: ArtifactGraph = new Map(
      [path, segment, sweep, wall, holeTool, firstHole, secondHole].map(
        (artifact) => [artifact.id, artifact]
      )
    )
    const faceArg: OpArg = {
      value: {
        type: 'TagIdentifier',
        value: 'line1',
        artifact_id: segment.id,
      },
      sourceRange: [0, 0, 0],
    }

    for (const hole of [firstHole, secondHole]) {
      const solidArg: OpArg = {
        value: { type: 'Solid', value: { artifactId: hole.id } },
        sourceRange: [0, 0, 0],
      }
      const result = retrieveFaceSelectionsFromOpArgs(
        solidArg,
        faceArg,
        artifactGraph
      )

      if (result instanceof Error) {
        throw result
      }
      expect(result.solids.graphSelections[0].artifact).toBe(hole)
      expect(result.faces.graphSelections[0].artifact).toBe(wall)
    }
  })
})
