import {
  addPatternCircular3D,
  addPatternLinear3D,
} from '@src/lang/modifyAst/pattern3D'
import {
  type Artifact,
  type CodeRef,
  assertParse,
  recast,
} from '@src/lang/wasm'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'

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

  it('should handle decimal values for all parameters', async () => {
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
      instances: await getKclCommandValue('2.5'),
      axis: await getKclCommandValue('[1, -1, 0.5]'),
      center: await getKclCommandValue('[7.5, 3.2, 0]'),
      arcDegrees: await getKclCommandValue('180.5'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = 2.5')
    expect(newCode).toContain('axis = [1, -1, 0.5]')
    expect(newCode).toContain('center = [7.5, 3.2, 0]')
    expect(newCode).toContain('arcDegrees = 180.5')
  })

  it('should handle mathematical expressions for parameters', async () => {
    const code = `
myCount = 10
mySpacing = 5
myOffset = 3
myAngle = 90

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
      instances: await getKclCommandValue('myCount - myOffset'),
      axis: await getKclCommandValue('[mySpacing * 2, 0, 1]'),
      center: await getKclCommandValue('[mySpacing + myOffset, 0, 0]'),
      arcDegrees: await getKclCommandValue('myAngle * 2'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternCircular3d(')
    expect(newCode).toContain('instances = myCount - myOffset')
    expect(newCode).toContain('axis = [mySpacing * 2, 0, 1]')
    expect(newCode).toContain('center = [mySpacing + myOffset, 0, 0]')
    expect(newCode).toContain('arcDegrees = myAngle * 2')
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
})

describe('Testing addPatternLinear3D', () => {
  it('should add patternLinear3d with named axis', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('7'),
      distance: await getKclCommandValue('6'),
      axis: 'X',
      useOriginal: false,
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = 7')
    expect(newCode).toContain('axis = X')
    expect(newCode).toContain('distance = 6')
    expect(newCode).toContain('useOriginal = false')
  })

  it('should add patternLinear3d with array axis', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('5'),
      distance: await getKclCommandValue('10'),
      axis: await getKclCommandValue('[1, 0, 1]'),
      useOriginal: true,
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = 5')
    expect(newCode).toContain('axis = [1, 0, 1]')
    expect(newCode).toContain('distance = 10')
    expect(newCode).toContain('useOriginal = true')
  })

  it('should add patternLinear3d with minimal required parameters', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('3'),
      distance: await getKclCommandValue('4'),
      axis: 'Y',
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = 3')
    expect(newCode).toContain('axis = Y')
    expect(newCode).toContain('distance = 4')
    expect(newCode).not.toContain('useOriginal')
  })

  it('should handle all optional parameters', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('6'),
      distance: await getKclCommandValue('8'),
      axis: 'Y',
      useOriginal: true,
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = 6')
    expect(newCode).toContain('axis = Y')
    expect(newCode).toContain('distance = 8')
    expect(newCode).toContain('useOriginal = true')
  })

  it('should handle variable references for parameters', async () => {
    const code = `
myInstances = 8
myAxis = [0, 0, 1]
myDistance = 12

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('myInstances'),
      distance: await getKclCommandValue('myDistance'),
      axis: await getKclCommandValue('myAxis'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = myInstances')
    expect(newCode).toContain('axis = myAxis')
    expect(newCode).toContain('distance = myDistance')
  })

  it('should handle decimal values for all parameters', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('2.5'),
      distance: await getKclCommandValue('7.5'),
      axis: await getKclCommandValue('[1, -1, 0.5]'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = 2.5')
    expect(newCode).toContain('axis = [1, -1, 0.5]')
    expect(newCode).toContain('distance = 7.5')
  })

  it('should handle mathematical expressions for parameters', async () => {
    const code = `
myCount = 10
mySpacing = 5
myOffset = 3

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('myCount - myOffset'),
      distance: await getKclCommandValue('mySpacing + myOffset'),
      axis: await getKclCommandValue('[mySpacing * 2, 0, 1]'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = myCount - myOffset')
    expect(newCode).toContain('axis = [mySpacing * 2, 0, 1]')
    expect(newCode).toContain('distance = mySpacing + myOffset')
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

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('5'),
      distance: await getKclCommandValue('8'),
      axis: mockAxisWithBothProperties,
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = 5')
    // Should use the array value, not the variable name
    expect(newCode).toContain('axis = [1, 0, 0]')
    expect(newCode).not.toContain('axis = someVariable')
    expect(newCode).toContain('distance = 8')
  })

  it('should create new pattern variable when selection is piped into named variable', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('6'),
      distance: await getKclCommandValue('3'),
      axis: 'Y',
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = 6')
    expect(newCode).toContain('axis = Y')
    expect(newCode).toContain('distance = 3')
    // Should create new pattern variable referencing the named variable
    expect(newCode).toContain('exampleSketch = startSketchOn(XZ)')
    expect(newCode).toContain('|> extrude(length = 5)')
    expect(newCode).toContain('pattern001 = patternLinear3d(')
    expect(newCode).toContain('exampleSketch,') // References the original variable
  })

  it('should extend pipeline when selection is from unnamed pipeline', async () => {
    const code = `
sketch001 = startSketchOn(XZ)

startSketchOn(XY)
  |> circle(center = [1, 1], radius = 0.5)
  |> extrude(length = 3)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('4'),
      distance: await getKclCommandValue('2'),
      axis: 'Z',
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = 4')
    expect(newCode).toContain('axis = Z')
    expect(newCode).toContain('distance = 2')
    // Should extend the unnamed pipeline
    expect(newCode).toContain('startSketchOn(XY)')
    expect(newCode).toContain('|> extrude(length = 3)')
    expect(newCode).toContain('|> patternLinear3d(')
  })

  it('should pipe pattern when selection is from unnamed standalone expression', async () => {
    const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

extrude(exampleSketch, length = -5)
`

    const { ast, selections, artifactGraph } =
      await getAstAndSolidSelections(code)

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: selections,
      instances: await getKclCommandValue('3'),
      distance: await getKclCommandValue('5'),
      axis: await getKclCommandValue('[0, 1, 0]'),
    })

    if (err(result)) {
      throw result
    }

    const { modifiedAst } = result
    const newCode = recast(modifiedAst)

    expect(newCode).toContain('patternLinear3d(')
    expect(newCode).toContain('instances = 3')
    expect(newCode).toContain('axis = [0, 1, 0]')
    expect(newCode).toContain('distance = 5')
    // Should pipe directly onto the unnamed expression
    expect(newCode).toContain('extrude(exampleSketch, length = -5)')
    expect(newCode).toContain('|> patternLinear3d(')
  })
})
