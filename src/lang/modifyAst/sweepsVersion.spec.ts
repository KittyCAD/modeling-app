import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { addSweep } from '@src/lang/modifyAst/sweeps'
import { assertParse, recast } from '@src/lang/wasm'
import {
  createSelectionFromArtifacts,
  enginelessExecutor,
  getKclCommandValue,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it } from 'vitest'

describe('addSweep version', () => {
  const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])`

  async function setupSweep(sourceCode = code) {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const ast = assertParse(sourceCode, instance)
    if (err(ast)) throw ast

    const { artifactGraph } = await enginelessExecutor(ast, rustContext)
    const paths = [...artifactGraph.values()].filter(
      (artifact) => artifact.type === 'path'
    )
    expect(paths).toHaveLength(2)

    return {
      ast,
      artifactGraph,
      instance,
      rustContext,
      sketches: createSelectionFromArtifacts([paths[0]], artifactGraph),
      path: createSelectionFromArtifacts([paths[1]], artifactGraph),
    }
  }

  it('forces version 2 when no version is provided', async () => {
    const { ast, artifactGraph, sketches, path, instance } = await setupSweep()
    const result = addSweep({
      ast,
      artifactGraph,
      sketches,
      path,
      wasmInstance: instance,
    })
    if (err(result)) throw result

    expect(recast(result.modifiedAst, instance)).toContain(
      'sweep001 = sweep(profile001, path = profile002, version = 2)'
    )
  })

  it('preserves an explicit version', async () => {
    const { ast, artifactGraph, sketches, path, instance, rustContext } =
      await setupSweep()
    const version = await getKclCommandValue('1', instance, rustContext)
    const result = addSweep({
      ast,
      artifactGraph,
      sketches,
      path,
      version,
      wasmInstance: instance,
    })
    if (err(result)) throw result

    expect(recast(result.modifiedAst, instance)).toContain(
      'sweep001 = sweep(profile001, path = profile002, version = 1)'
    )
  })

  it('does not add version 2 when editing old sweep code without version', async () => {
    const oldSweepCode = `${code}
sweep001 = sweep(profile001, path = profile002)`
    const { ast, artifactGraph, sketches, path, instance } =
      await setupSweep(oldSweepCode)
    const result = addSweep({
      ast,
      artifactGraph,
      sketches,
      path,
      nodeToEdit: createPathToNodeForLastVariable(ast),
      wasmInstance: instance,
    })
    if (err(result)) throw result

    const newCode = recast(result.modifiedAst, instance)
    expect(newCode).toContain('sweep001 = sweep(profile001, path = profile002)')
    expect(newCode).not.toContain('version = 2')
  })
})
