import {
  addIntersect,
  addSplit,
  addSubtract,
  addUnion,
} from '@src/lang/modifyAst/boolean'
import { assertParse, recast } from '@src/lang/wasm'
import {
  createSelectionFromArtifacts,
  enginelessExecutor,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLibCommands', () => ({
  STD_LIB_COMMANDS: {},
}))

describe('boolean operations on distinct variable-less pipes', () => {
  it.each(['union', 'intersect', 'subtract', 'split'] as const)(
    'keeps both selected bodies when creating %s',
    async (operation) => {
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const code = `@settings(experimentalFeatures = allow)

startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2)
startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2)`
      const ast = assertParse(code, instance)
      const { artifactGraph } = await enginelessExecutor(ast, rustContext)
      const sweeps = [...artifactGraph.values()].filter(
        (artifact) => artifact.type === 'sweep'
      )
      expect(sweeps).toHaveLength(2)

      const first = createSelectionFromArtifacts([sweeps[0]], artifactGraph)
      const second = createSelectionFromArtifacts([sweeps[1]], artifactGraph)
      const both = createSelectionFromArtifacts(sweeps, artifactGraph)
      const result =
        operation === 'union'
          ? addUnion({
              ast,
              artifactGraph,
              solids: both,
              wasmInstance: instance,
            })
          : operation === 'intersect'
            ? addIntersect({
                ast,
                artifactGraph,
                solids: both,
                wasmInstance: instance,
              })
            : operation === 'subtract'
              ? addSubtract({
                  ast,
                  artifactGraph,
                  solids: first,
                  tools: second,
                  wasmInstance: instance,
                })
              : addSplit({
                  ast,
                  artifactGraph,
                  targets: first,
                  tools: second,
                  wasmInstance: instance,
                })
      if (err(result)) {
        throw result
      }

      const output = recast(result.modifiedAst, instance)
      expect(output).toContain('solid001 = startSketchOn(XY)')
      expect(output).toContain('solid002 = startSketchOn(XZ)')
      if (operation === 'union' || operation === 'intersect') {
        expect(output).toContain(
          `solid003 = ${operation}([solid001, solid002])`
        )
      } else if (operation === 'subtract') {
        expect(output).toContain(
          'solid003 = subtract(solid001, tools = solid002)'
        )
      } else {
        expect(output).toContain('split001 = split(solid001, tools = solid002)')
      }
      const execution = await enginelessExecutor(
        result.modifiedAst,
        rustContext
      )
      expect(execution.issues).toEqual([])
    }
  )

  it.each(['subtract', 'split'] as const)(
    'materializes a variable-less %s tool for its labeled argument',
    async (operation) => {
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const code = `@settings(experimentalFeatures = allow)

sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 2)
extrude001 = extrude(profile001, length = 2)
startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2)`
      const ast = assertParse(code, instance)
      const { artifactGraph } = await enginelessExecutor(ast, rustContext)
      const sweeps = [...artifactGraph.values()].filter(
        (artifact) => artifact.type === 'sweep'
      )
      expect(sweeps).toHaveLength(2)
      const targets = createSelectionFromArtifacts([sweeps[0]], artifactGraph)
      const tools = createSelectionFromArtifacts([sweeps[1]], artifactGraph)

      const result =
        operation === 'subtract'
          ? addSubtract({
              ast,
              artifactGraph,
              solids: targets,
              tools,
              wasmInstance: instance,
            })
          : addSplit({
              ast,
              artifactGraph,
              targets,
              tools,
              wasmInstance: instance,
            })
      if (err(result)) {
        throw result
      }

      const output = recast(result.modifiedAst, instance)
      expect(output).toContain('solid001 = startSketchOn(XZ)')
      expect(output).toContain(
        operation === 'subtract'
          ? 'solid002 = subtract(extrude001, tools = solid001)'
          : 'split001 = split(extrude001, tools = solid001)'
      )
      const execution = await enginelessExecutor(
        result.modifiedAst,
        rustContext
      )
      expect(execution.issues).toEqual([])
    }
  )

  it('still rejects one variable-less body selected as both target and tool', async () => {
    const { instance, rustContext } = await buildTheWorldAndNoEngineConnection()
    const code = `@settings(experimentalFeatures = allow)

startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2)`
    const ast = assertParse(code, instance)
    const { artifactGraph } = await enginelessExecutor(ast, rustContext)
    const sweep = [...artifactGraph.values()].find(
      (artifact) => artifact.type === 'sweep'
    )
    if (!sweep) {
      throw new Error('Expected a sweep')
    }
    const selection = createSelectionFromArtifacts([sweep], artifactGraph)

    const result = addSubtract({
      ast,
      artifactGraph,
      solids: selection,
      tools: selection,
      wasmInstance: instance,
    })

    expect(result).toEqual(
      new Error(
        'The same body cannot be used more than once in a Boolean operation. Please check your selections.'
      )
    )
  })

  it.each(['subtract', 'split'] as const)(
    'preserves the existing in-pipe %s path for a variable-less target',
    async (operation) => {
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const code = `@settings(experimentalFeatures = allow)

sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 2)
extrude001 = extrude(profile001, length = 2)
startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2)`
      const ast = assertParse(code, instance)
      const { artifactGraph } = await enginelessExecutor(ast, rustContext)
      const sweeps = [...artifactGraph.values()].filter(
        (artifact) => artifact.type === 'sweep'
      )
      expect(sweeps).toHaveLength(2)
      const tools = createSelectionFromArtifacts([sweeps[0]], artifactGraph)
      const targets = createSelectionFromArtifacts([sweeps[1]], artifactGraph)

      const result =
        operation === 'subtract'
          ? addSubtract({
              ast,
              artifactGraph,
              solids: targets,
              tools,
              wasmInstance: instance,
            })
          : addSplit({
              ast,
              artifactGraph,
              targets,
              tools,
              wasmInstance: instance,
            })
      if (err(result)) {
        throw result
      }

      const output = recast(result.modifiedAst, instance)
      expect(output).toContain(
        `  |> extrude(length = 2)\n  |> ${operation}(tools = extrude001)`
      )
      expect(output).not.toContain('solid001 = startSketchOn(XZ)')
      const execution = await enginelessExecutor(
        result.modifiedAst,
        rustContext
      )
      expect(execution.issues).toEqual([])
    }
  )
})
