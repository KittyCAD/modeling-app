import { resolveEdgeSelectionContext } from '@src/lang/modifyAst/tagManagement'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import type { Artifact, ArtifactGraph, SourceRange } from '@src/lang/wasm'
import { assertParse } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { expect, it } from 'vitest'

it('resolves an internal cloned sweep to its composite body expression', async () => {
  const { instance, engineCommandManager } =
    await buildTheWorldAndNoEngineConnection()
  const code = `source = 0
clonedComposite = clone(source)`
  const ast = assertParse(code, instance)
  const sourceRange = [
    code.indexOf('0'),
    code.indexOf('0') + 1,
    0,
  ] as SourceRange
  const cloneRange = [
    code.indexOf('clone(source)'),
    code.length,
    0,
  ] as SourceRange
  const sourceCodeRef = {
    ...codeRefFromRange(sourceRange, ast),
    nodePath: { steps: [] },
  }
  const cloneCodeRef = {
    ...codeRefFromRange(cloneRange, ast),
    nodePath: { steps: [] },
  }
  const sourceSweep: Extract<Artifact, { type: 'sweep' }> = {
    type: 'sweep',
    id: 'source-sweep',
    subType: 'extrusion',
    pathId: 'source-path',
    surfaceIds: [],
    edgeIds: [],
    codeRef: sourceCodeRef,
    trajectoryId: null,
    method: 'new',
    consumed: true,
  }
  const selectedSweep: Extract<Artifact, { type: 'sweep' }> = {
    ...sourceSweep,
    id: 'cloned-sweep-a',
    pathId: 'cloned-path-a',
    codeRef: cloneCodeRef,
    sourceSweepId: sourceSweep.id,
    consumed: false,
  }
  const siblingSweep: Extract<Artifact, { type: 'sweep' }> = {
    ...selectedSweep,
    id: 'cloned-sweep-b',
    pathId: 'cloned-path-b',
  }
  const selectedPath: Extract<Artifact, { type: 'path' }> = {
    type: 'path',
    id: selectedSweep.pathId!,
    subType: 'sketch',
    planeId: 'plane',
    segIds: ['cloned-segment'],
    consumed: true,
    sweepId: selectedSweep.id,
    trajectorySweepId: null,
    codeRef: cloneCodeRef,
    compositeSolidId: 'cloned-composite',
  }
  const clonedComposite: Extract<Artifact, { type: 'compositeSolid' }> = {
    type: 'compositeSolid',
    id: 'cloned-composite',
    consumed: false,
    subType: 'union',
    solidIds: [selectedSweep.id, siblingSweep.id],
    toolIds: [],
    codeRef: cloneCodeRef,
  }
  const sourceSegment: Extract<Artifact, { type: 'segment' }> = {
    type: 'segment',
    id: 'source-segment',
    pathId: 'source-path',
    edgeIds: [],
    commonSurfaceIds: [],
    codeRef: sourceCodeRef,
  }
  const selectedSegment: Extract<Artifact, { type: 'segment' }> = {
    ...sourceSegment,
    id: 'cloned-segment',
    pathId: selectedPath.id,
    sourceSegmentId: sourceSegment.id,
    codeRef: cloneCodeRef,
  }
  const artifacts: Artifact[] = [
    sourceSweep,
    selectedSweep,
    siblingSweep,
    selectedPath,
    clonedComposite,
    sourceSegment,
    selectedSegment,
  ]
  const artifactGraph: ArtifactGraph = new Map(
    artifacts.map((artifact) => [artifact.id, artifact])
  )

  try {
    const context = resolveEdgeSelectionContext(
      ast,
      { artifact: selectedSegment, codeRef: cloneCodeRef },
      artifactGraph,
      instance
    )
    if (err(context)) throw context

    expect(context.selectedBodyExpr).toMatchObject({
      type: 'Name',
      name: { name: 'clonedComposite' },
    })
  } finally {
    engineCommandManager.tearDown()
  }
})
