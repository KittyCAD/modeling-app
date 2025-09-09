import {
  type Artifact,
  assertParse,
  type CodeRef,
  recast,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import { addPatternCircular3D } from '@src/lang/modifyAst/pattern3D'
import { stringToKclExpression } from '@src/lib/kclHelpers'

async function getAstAndArtifactGraph(code: string) {
  const ast = assertParse(code)
  if (err(ast)) throw ast

  const { artifactGraph } = await enginelessExecutor(ast)
  return { ast, artifactGraph }
}

function createSelectionFromPathArtifact(
  artifacts: (Artifact & { codeRef: CodeRef })[]
): Selections {
  const graphSelections = artifacts.map(
    (artifact) =>
      ({
        codeRef: artifact.codeRef,
        artifact,
      }) as Selection
  )
  return {
    graphSelections,
    otherSelections: [],
  }
}

async function getAstAndSolidSelections(code: string) {
  const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
  // Filter for sweep artifacts that represent 3D solids
  const artifacts = [...artifactGraph.values()].filter(
    (a) => a.type === 'sweep'
  )
  if (artifacts.length === 0) {
    throw new Error('Sweep artifact not found in the graph')
  }
  const selections = createSelectionFromPathArtifact(artifacts)
  return { ast, selections, artifactGraph }
}

async function getKclCommandValue(value: string) {
  const result = await stringToKclExpression(value)
  if (err(result) || 'errors' in result) {
    throw new Error('Failed to create KCL expression')
  }
  return result
}

describe('Testing addPatternCircular3D', () => {
  it('should add patternCircular3d with named axis', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternCircular3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('11'),
      axis: 'X',
      center: await getKclCommandValue('[10, -20, 0]'),
      arcDegrees: await getKclCommandValue('360'),
      rotateDuplicates: true,
      useOriginal: false,
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = 11')
    expect(newCode).toContain('axis = X')
    expect(newCode).toContain('center = [10, -20, 0]')
    expect(newCode).toContain('arcDegrees = 360')
    expect(newCode).toContain('rotateDuplicates = true')
    expect(newCode).toContain('useOriginal = false')
  })

  it('should add patternCircular3d with array axis', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternCircular3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('11'),
      axis: await getKclCommandValue('[1, -1, 0]'),
      center: await getKclCommandValue('[10, -20, 0]'),
      arcDegrees: await getKclCommandValue('360'),
      rotateDuplicates: true,
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = 11')
    expect(newCode).toContain('axis = [1, -1, 0]')
    expect(newCode).toContain('center = [10, -20, 0]')
    expect(newCode).toContain('arcDegrees = 360')
    expect(newCode).toContain('rotateDuplicates = true')
  })

  it('should add patternCircular3d with minimal required parameters', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternCircular3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('5'),
      axis: 'Z',
      center: await getKclCommandValue('[0, 0, 0]'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = 5')
    expect(newCode).toContain('axis = Z')
    expect(newCode).toContain('center = [0, 0, 0]')
    expect(newCode).not.toContain('arcDegrees')
    expect(newCode).not.toContain('rotateDuplicates')
    expect(newCode).not.toContain('useOriginal')
  })

  it('should handle variable references for parameters', async () => {
    const code = `
myInstances = 8
myAxis = [0, 0, 1]
myCenter = [5, 5, 0]

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternCircular3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('myInstances'),
      axis: await getKclCommandValue('myAxis'),
      center: await getKclCommandValue('myCenter'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = myInstances')
    expect(newCode).toContain('axis = myAxis')
    expect(newCode).toContain('center = myCenter')
  })

  it('should prioritize array values over variable names when both exist', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    // Test the precedence by creating a mock axis that simulates the edge case
    const baseExpression = await getKclCommandValue('[1, 0, 0]')
    const mockAxisWithBothProperties = {
      ...baseExpression,
      variableName: 'someVariable', // This exists but should be ignored
      variableDeclarationAst: { type: 'VariableDeclaration' } as any,
      variableIdentifierAst: {
        type: 'Identifier',
        name: 'someVariable',
      } as any,
      insertIndex: 0,
      value: [1, 0, 0], // This should take precedence
    }

    const result = addPatternCircular3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('5'),
      axis: mockAxisWithBothProperties,
      center: await getKclCommandValue('[0, 0, 0]'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = 5')
    // Should use the array value, not the variable name
    expect(newCode).toContain('axis = [1, 0, 0]')
    expect(newCode).not.toContain('axis = someVariable')
    expect(newCode).toContain('center = [0, 0, 0]')
  })

  it('should create new pattern variable when selection is piped into named variable', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternCircular3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('6'),
      axis: 'Y',
      center: await getKclCommandValue('[0, 0, 0]'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = 6')
    expect(newCode).toContain('axis = Y')
    expect(newCode).toContain('center = [0, 0, 0]')
    // Should create new pattern variable referencing the named variable
    expect(newCode).toContain('exampleSketch = startSketchOn(XZ)')
    expect(newCode).toContain('|> extrude(length = 5)')
    expect(newCode).toContain('pattern001 = patternCircular3d(')
    expect(newCode).toContain('exampleSketch,') // References the original variable
  })

  it('should extend pipeline when selection is from unnamed pipeline', async () => {
    const code = `
sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [0, 0], radius = 1)

startSketchOn(XY)
  |> circle(center = [1, 1], radius = 0.5)
  |> extrude(length = 3)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternCircular3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('8'),
      axis: 'Z',
      center: await getKclCommandValue('[2, 2, 0]'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = 8')
    expect(newCode).toContain('axis = Z')
    expect(newCode).toContain('center = [2, 2, 0]')
    // Should extend the unnamed pipeline
    expect(newCode).toContain('startSketchOn(XY)')
    expect(newCode).toContain('|> extrude(length = 3)')
    expect(newCode).toContain('|> patternCircular3d(')
  })

  it('should pipe pattern when selection is from unnamed standalone expression', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternCircular3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('4'),
      axis: await getKclCommandValue('[0, 1, 0]'),
      center: await getKclCommandValue('[5, 0, 0]'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = 4')
    expect(newCode).toContain('axis = [0, 1, 0]')
    expect(newCode).toContain('center = [5, 0, 0]')
    // Should pipe directly onto the unnamed expression
    expect(newCode).toContain('extrude(exampleSketch, length = -5)')
    expect(newCode).toContain('|> patternCircular3d(')
  })

  it('should handle all optional parameters', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternCircular3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('6'),
      axis: 'Y',
      center: await getKclCommandValue('[0, 0, 0]'),
      arcDegrees: await getKclCommandValue('180'),
      rotateDuplicates: true,
      useOriginal: false,
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = 6')
    expect(newCode).toContain('axis = Y')
    expect(newCode).toContain('center = [0, 0, 0]')
    expect(newCode).toContain('arcDegrees = 180')
    expect(newCode).toContain('rotateDuplicates = true')
    expect(newCode).toContain('useOriginal = false')
  })
})
