import type { OpArg } from '@rust/kcl-lib/bindings/Operation'
import { beforeAll, describe, expect, it } from 'vitest'
import { retrieveSelectionsFromOpArg } from '@src/lang/queryAst'
import { assertParse, pathToNodeFromRustNodePath, recast } from '@src/lang/wasm'
import type { ArtifactGraph, CodeRef } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import type RustContext from '@src/lib/rustContext'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { enginelessExecutor, getKclCommandValue } from '@src/lib/testHelpers'
import { addExtrude } from '@src/lang/modifyAst/sweeps'
import { mockExecAstAndReportErrors } from '@src/lang/modelingWorkflows'

let instance: ModuleType
let rustContext: RustContext

beforeAll(async () => {
  const world = await buildTheWorldAndNoEngineConnection()
  instance = world.instance
  rustContext = world.rustContext
})

describe('retrieveSelectionsFromOpArg', () => {
  it('coalesces region boundary segment arguments back to the region path', () => {
    const codeRef: CodeRef = {
      range: [10, 20, 0],
      nodePath: { steps: [] },
      pathToNode: [['body', '']],
    }
    const artifactGraph: ArtifactGraph = new Map([
      [
        'region-path',
        {
          type: 'path',
          id: 'region-path',
          subType: 'region',
          planeId: 'plane-1',
          segIds: ['region-seg-1', 'region-seg-2'],
          consumed: true,
          trajectorySweepId: null,
          solid2dId: null,
          codeRef,
          compositeSolidId: null,
          sketchBlockId: null,
          originPathId: 'sketch-path',
          innerPathId: null,
          outerPathId: null,
          patternIds: [],
        },
      ],
      [
        'region-seg-1',
        {
          type: 'segment',
          id: 'region-seg-1',
          pathId: 'region-path',
          originalSegId: 'line-1',
          surfaceId: null,
          edgeIds: [],
          edgeCutId: null,
          codeRef: { ...codeRef, range: [30, 40, 0] },
          commonSurfaceIds: [],
        },
      ],
      [
        'region-seg-2',
        {
          type: 'segment',
          id: 'region-seg-2',
          pathId: 'region-path',
          originalSegId: 'line-2',
          surfaceId: null,
          edgeIds: [],
          edgeCutId: null,
          codeRef: { ...codeRef, range: [40, 50, 0] },
          commonSurfaceIds: [],
        },
      ],
    ])
    const opArg: OpArg = {
      sourceRange: [60, 70, 0],
      value: {
        type: 'Array',
        value: [
          { type: 'Segment', artifact_id: 'region-seg-1' },
          { type: 'Segment', artifact_id: 'region-seg-2' },
        ],
      },
    }

    const selections = retrieveSelectionsFromOpArg(opArg, artifactGraph)
    if (err(selections)) throw selections

    expect(selections.graphSelections).toHaveLength(1)
    expect(selections.graphSelections[0].artifact?.id).toBe('region-path')
    expect(selections.graphSelections[0].artifact?.type).toBe('path')
    if (selections.graphSelections[0].artifact?.type === 'path') {
      expect(selections.graphSelections[0].artifact.subType).toBe('region')
    }
  })

  it('keeps a simple sketch-solve region extrude editable as a region', async () => {
    const code = `@settings(experimentalFeatures = allow)

sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var 1.29mm, var 0.73mm], center = [var 1.03mm, var 1.01mm])
}
region001 = region(point = [1.02mm, 1.01mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5)
`
    const ast = assertParse(code, instance)
    const { artifactGraph, operations } = await enginelessExecutor(
      ast,
      rustContext
    )
    const extrude = operations.find(
      (operation) =>
        operation.type === 'StdLibCall' && operation.name === 'extrude'
    )
    if (!extrude || extrude.type !== 'StdLibCall' || !extrude.unlabeledArg) {
      throw new Error('Extrude operation not found')
    }

    const selections = retrieveSelectionsFromOpArg(
      extrude.unlabeledArg,
      artifactGraph
    )
    if (err(selections)) throw selections

    expect(selections.graphSelections).toHaveLength(1)
    expect(selections.graphSelections[0].artifact?.type).toBe('path')
    if (selections.graphSelections[0].artifact?.type === 'path') {
      expect(selections.graphSelections[0].artifact.subType).toBe('region')
    }

    const length = await getKclCommandValue('6', instance, rustContext)
    const result = addExtrude({
      ast,
      artifactGraph,
      sketches: selections,
      length,
      nodeToEdit: pathToNodeFromRustNodePath(extrude.nodePath),
      wasmInstance: instance,
    })
    if (err(result)) throw result

    const nextCode = recast(result.modifiedAst, instance)
    expect(nextCode).toContain('extrude001 = extrude(region001, length = 6)')
    expect(nextCode).not.toContain('extrude([sketch001.circle1')
    const error = await mockExecAstAndReportErrors(
      result.modifiedAst,
      rustContext
    )
    expect(error).toBeUndefined()
  })

  it('keeps an OpenCascade-executed sketch-solve region extrude editable as a region', async () => {
    const code = `@settings(experimentalFeatures = allow)

sketch001 = sketch(on = YZ) {
  circle1 = circle(start = [var 1.29mm, var 0.73mm], center = [var 1.03mm, var 1.01mm])
}
region001 = region(point = [1.02mm, 1.01mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5)
`
    const ast = assertParse(code, instance)
    const { artifactGraph, operations } = await rustContext.execute(ast, {
      settings: { modeling: { engine: 'open_cascade' } },
    })
    const extrude = operations.find(
      (operation) =>
        operation.type === 'StdLibCall' && operation.name === 'extrude'
    )
    if (!extrude || extrude.type !== 'StdLibCall' || !extrude.unlabeledArg) {
      throw new Error('Extrude operation not found')
    }

    const selections = retrieveSelectionsFromOpArg(
      extrude.unlabeledArg,
      artifactGraph
    )
    if (err(selections)) throw selections

    expect(selections.graphSelections).toHaveLength(1)
    expect(selections.graphSelections[0].artifact?.type).toBe('path')
    if (selections.graphSelections[0].artifact?.type === 'path') {
      expect(selections.graphSelections[0].artifact.subType).toBe('region')
    }

    const length = await getKclCommandValue('6', instance, rustContext)
    const result = addExtrude({
      ast,
      artifactGraph,
      sketches: selections,
      length,
      nodeToEdit: pathToNodeFromRustNodePath(extrude.nodePath),
      wasmInstance: instance,
    })
    if (err(result)) throw result

    const nextCode = recast(result.modifiedAst, instance)
    expect(nextCode).toContain('extrude001 = extrude(region001, length = 6)')
    expect(nextCode).not.toContain('extrude([sketch001.circle1')
    const error = await mockExecAstAndReportErrors(
      result.modifiedAst,
      rustContext
    )
    expect(error).toBeUndefined()
  })
})
