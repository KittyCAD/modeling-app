import { assertParse, recast } from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { addExtrude } from '@src/lang/modifyAst/sweeps'
import { stringToKclExpression } from '@src/lib/kclHelpers'

async function getAstAndSketchSelections(code: string) {
  const ast = assertParse(code)
  if (err(ast)) {
    throw new Error('Error while parsing code')
  }
  const { artifactGraph } = await enginelessExecutor(ast)
  const artifact = artifactGraph.values().find((a) => a.type === 'path')
  if (!artifact) {
    throw new Error('Artifact not found in the graph')
  }
  const sketches: Selections = {
    graphSelections: [
      {
        codeRef: artifact.codeRef,
        artifact,
      },
    ],
    otherSelections: [],
  }
  return { ast, sketches }
}

async function getKclCommandValue(value: string) {
    const result = await stringToKclExpression(value)
    if (err(result) || 'errors' in result) {
      throw new Error(`Couldn't create kcl expression`)
    }

    return result
}

describe('Testing addExtrude', () => {
  it('should push an extrude call in pipe if selection was in variable-less pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
    const length = await getKclCommandValue('1')
    const result = addExtrude({ ast, sketches, length })
    if (err(result)) {
      return { reason: 'Error while adding extrude' }
    }
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`|> extrude(length = 1)`)
  })

  it('should push a variable extrude call if selection was in variable profile', async () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
    const length = await getKclCommandValue('2')
    const result = addExtrude({ ast, sketches, length })
    if (err(result)) {
      return { reason: 'Error while adding extrude' }
    }
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`extrude001 = extrude(profile001, length = 2)`)
  })

  it('should push an extrude call with variable if selection was in variable pipe', async () => {
    const code = `profile001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
`
    const { ast, sketches } = await getAstAndSketchSelections(code)
    const length = await getKclCommandValue('3')
    const result = addExtrude({ ast, sketches, length })
    if (err(result)) {
      return { reason: 'Error while adding extrude' }
    }
    const newCode = recast(result.modifiedAst)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`extrude001 = extrude(profile001, length = 3)`)
  })
})
