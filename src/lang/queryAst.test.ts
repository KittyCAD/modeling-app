import type { Name } from '@rust/kcl-lib/bindings/Name'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'

import { ARG_END_ABSOLUTE } from '@src/lang/constants'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createPipeSubstitution,
} from '@src/lang/create'
import {
  doesSceneHaveExtrudedSketch,
  doesSceneHaveSweepableSketch,
  findAllPreviousVariables,
  findOperationPlaneArtifact,
  findUsesOfTagInPipe,
  getNodeFromPath,
  getSelectedPlaneId,
  getSelectedPlaneAsNode,
  getVariableExprsFromSelection,
  hasSketchPipeBeenExtruded,
  isCursorInFunctionDefinition,
  isNodeSafeToReplace,
  isOffsetPlane,
  retrieveSelectionsFromOpArg,
  traverse,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import { addCallExpressionsToPipe, addCloseToPipe } from '@src/lang/std/sketch'
import { topLevelRange } from '@src/lang/util'
import type { Identifier, PathToNode } from '@src/lang/wasm'
import { assertParse, recast } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import type { Selections, Selection } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { Plane } from '@rust/kcl-lib/bindings/Artifact'

beforeAll(async () => {
  await initPromise
})

describe('findAllPreviousVariables', () => {
  it('should find all previous variables', async () => {
    const code = `baseThick = 1
armAngle = 60

baseThickHalf = baseThick / 2
halfArmAngle = armAngle / 2

arrExpShouldNotBeIncluded = [1, 2, 3]
objExpShouldNotBeIncluded = { a = 1, b = 2, c = 3 }

part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> yLine(endAbsolute = 1)
  |> xLine(length = 3.84) // selection-range-7ish-before-this

variableBelowShouldNotBeIncluded = 3
`
    const rangeStart = code.indexOf('// selection-range-7ish-before-this') - 7
    expect(rangeStart).toBeGreaterThanOrEqual(0)
    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast)

    const { variables, bodyPath, insertIndex } = findAllPreviousVariables(
      ast,
      execState.variables,
      topLevelRange(rangeStart, rangeStart)
    )
    const defaultTy = {
      type: 'Default',
      angle: {
        type: 'Degrees',
      },
      len: {
        type: 'Mm',
      },
    }
    expect(variables).toEqual([
      {
        key: 'baseThick',
        value: 1,
        ty: defaultTy,
      },
      {
        key: 'armAngle',
        value: 60,
        ty: defaultTy,
      },
      {
        key: 'baseThickHalf',
        value: 0.5,
        ty: defaultTy,
      },
      {
        key: 'halfArmAngle',
        value: 30,
        ty: defaultTy,
      },
      // no arrExpShouldNotBeIncluded, variableBelowShouldNotBeIncluded etc
    ])
    // there are 4 number variables and 2 non-number variables before the sketch var
    // ∴ the insert index should be 6
    expect(insertIndex).toEqual(6)
    expect(bodyPath).toEqual([['body', '']])
  })
})

describe('testing argIsNotIdentifier', () => {
  const code = `part001 = startSketchOn(XY)
|> startProfile(at = [-1.2, 4.83])
|> line(%, end = [2.8, 0])
|> angledLine(angle = 100 + 100, length = 3.09)
|> angledLine(angle = abc, length = 3.09)
|> angledLine(angle = def('yo'), length = 3.09)
|> angledLine(angle = ghi(%), length = 3.09)
|> angledLine(angle = jkl('yo') + 2, length = 3.09)
yo = 5 + 6
yo2 = hmm([identifierGuy + 5])`
  it('find a safe binaryExpression', () => {
    const ast = assertParse(code)
    const rangeStart = code.indexOf('100 + 100') + 2
    expect(rangeStart).toBeGreaterThanOrEqual(0)
    const result = isNodeSafeToReplace(
      ast,
      topLevelRange(rangeStart, rangeStart)
    )
    if (err(result)) throw result
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('BinaryExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe('100 + 100')
    const replaced = result.replacer(structuredClone(ast), 'replaceName')
    if (err(replaced)) throw replaced
    const outCode = recast(replaced.modifiedAst)
    expect(outCode).toContain(`angledLine(angle = replaceName, length = 3.09)`)
  })
  it('find a safe Identifier', () => {
    const ast = assertParse(code)
    const rangeStart = code.indexOf('abc')
    expect(rangeStart).toBeGreaterThanOrEqual(0)
    const result = isNodeSafeToReplace(
      ast,
      topLevelRange(rangeStart, rangeStart)
    )
    if (err(result)) throw result
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('Name')
    expect(code.slice(result.value.start, result.value.end)).toBe('abc')
  })
  it('find a safe CallExpressionKw', () => {
    const ast = assertParse(code)
    const rangeStart = code.indexOf('def')
    expect(rangeStart).toBeGreaterThanOrEqual(0)
    const result = isNodeSafeToReplace(
      ast,
      topLevelRange(rangeStart, rangeStart)
    )
    if (err(result)) throw result
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('CallExpressionKw')
    expect(code.slice(result.value.start, result.value.end)).toBe("def('yo')")
    const replaced = result.replacer(structuredClone(ast), 'replaceName')
    if (err(replaced)) throw replaced
    const outCode = recast(replaced.modifiedAst)
    expect(outCode).toContain(`angledLine(angle = replaceName, length = 3.09)`)
  })
  it('find an UNsafe CallExpressionKw, as it has a PipeSubstitution', () => {
    const ast = assertParse(code)
    const rangeStart = code.indexOf('ghi')
    expect(rangeStart).toBeGreaterThanOrEqual(0)
    const range = topLevelRange(rangeStart, rangeStart)
    const result = isNodeSafeToReplace(ast, range)
    if (err(result)) throw result
    expect(result.isSafe).toBe(false)
    expect(result.value?.type).toBe('CallExpressionKw')
    expect(code.slice(result.value.start, result.value.end)).toBe('ghi(%)')
  })
  it('find an UNsafe Identifier, as it is a callee', () => {
    const ast = assertParse(code)
    // TODO:
    // This should really work even without the % being explicitly set here,
    // because the unlabeled arg will default to %. However, the `isNodeSafeToReplacePath`
    // function doesn't yet check for this (because it cannot differentiate between
    // a function that relies on this default unlabeled arg, and a function with no unlabeled arg)
    const rangeStart = code.indexOf('line(%, end = [2.8,')
    expect(rangeStart).toBeGreaterThanOrEqual(0)
    const result = isNodeSafeToReplace(
      ast,
      topLevelRange(rangeStart, rangeStart)
    )
    if (err(result)) throw result
    expect(result.isSafe).toBe(false)
    expect(result.value?.type).toBe('CallExpressionKw')
    expect(code.slice(result.value.start, result.value.end)).toBe(
      'line(%, end = [2.8, 0])'
    )
  })
  it("find a safe BinaryExpression that's assigned to a variable", () => {
    const ast = assertParse(code)
    const rangeStart = code.indexOf('5 + 6') + 1
    expect(rangeStart).toBeGreaterThanOrEqual(0)
    const result = isNodeSafeToReplace(
      ast,
      topLevelRange(rangeStart, rangeStart)
    )
    if (err(result)) throw result
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('BinaryExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe('5 + 6')
    const replaced = result.replacer(structuredClone(ast), 'replaceName')
    if (err(replaced)) throw replaced
    const outCode = recast(replaced.modifiedAst)
    expect(outCode).toContain(`yo = replaceName`)
  })
  it('find a safe BinaryExpression that has a CallExpression within', () => {
    const ast = assertParse(code)
    const rangeStart = code.indexOf('jkl') + 1
    expect(rangeStart).toBeGreaterThanOrEqual(0)
    const result = isNodeSafeToReplace(
      ast,
      topLevelRange(rangeStart, rangeStart)
    )
    if (err(result)) throw result
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('BinaryExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe(
      "jkl('yo') + 2"
    )
    const replaced = result.replacer(structuredClone(ast), 'replaceName')
    if (err(replaced)) throw replaced
    const { modifiedAst } = replaced
    const outCode = recast(modifiedAst)
    expect(outCode).toContain(`angledLine(angle = replaceName, length = 3.09)`)
  })
  it('find a safe BinaryExpression within a CallExpressionKw', () => {
    const ast = assertParse(code)
    const rangeStart = code.indexOf('identifierGuy') + 1
    expect(rangeStart).toBeGreaterThanOrEqual(0)
    const result = isNodeSafeToReplace(
      ast,
      topLevelRange(rangeStart, rangeStart)
    )
    if (err(result)) throw result

    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('BinaryExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe(
      'identifierGuy + 5'
    )
    const replaced = result.replacer(structuredClone(ast), 'replaceName')
    if (err(replaced)) throw replaced
    const { modifiedAst } = replaced
    const outCode = recast(modifiedAst)
    expect(outCode).toContain(`yo2 = hmm([replaceName])`)
  })
})

describe('testing getNodePathFromSourceRange', () => {
  const code = `part001 = startSketchOn(XY)
  |> startProfile(at = [0.39, -0.05])
  |> line(end = [0.94, 2.61])
  |> line(end = [-0.21, -1.4])`
  it('finds the second line when cursor is put at the end', () => {
    const searchLn = `line(end = [0.94, 2.61])`
    const sourceIndex = code.indexOf(searchLn) + searchLn.length
    const ast = assertParse(code)

    const result = getNodePathFromSourceRange(
      ast,
      topLevelRange(sourceIndex, sourceIndex)
    )
    expect(result).toEqual([
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', ''],
      ['body', 'PipeExpression'],
      [2, 'index'],
    ])
  })
  it('finds the last line when cursor is put at the end', () => {
    const searchLn = `line(end = [-0.21, -1.4])`
    const sourceIndex = code.indexOf(searchLn) + searchLn.length
    const ast = assertParse(code)

    const result = getNodePathFromSourceRange(
      ast,
      topLevelRange(sourceIndex, sourceIndex)
    )
    const expected = [
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', ''],
      ['body', 'PipeExpression'],
      [3, 'index'],
    ]
    expect(result).toEqual(expected)
    // expect similar result for start of line
    const startSourceIndex = code.indexOf(searchLn)
    const startResult = getNodePathFromSourceRange(
      ast,
      topLevelRange(startSourceIndex, startSourceIndex)
    )
    expect(startResult).toEqual([...expected, ['callee', 'CallExpressionKw']])
    // expect similar result when whole line is selected
    const selectWholeThing = getNodePathFromSourceRange(
      ast,
      topLevelRange(startSourceIndex, sourceIndex)
    )
    expect(selectWholeThing).toEqual(expected)
  })

  it('finds the node in if-else condition', () => {
    const code = `y = 0
    x = if x > y {
      x + 1
    } else {
      y
    }`
    const searchLn = `x > y`
    const sourceIndex = code.indexOf(searchLn)
    const ast = assertParse(code)

    const result = getNodePathFromSourceRange(
      ast,
      topLevelRange(sourceIndex, sourceIndex)
    )
    expect(result).toEqual([
      ['body', ''],
      [1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', ''],
      ['cond', 'IfExpression'],
      ['left', 'BinaryExpression'],
    ])
    const _node = getNodeFromPath<Name>(ast, result)
    if (err(_node)) throw _node
    expect(_node.node.type).toEqual('Name')
    expect(_node.node.name.name).toEqual('x')
  })

  it('finds the node in if-else then', () => {
    const code = `y = 0
    x = if x > y {
      x + 1
    } else {
      y
    }`
    const searchLn = `x + 1`
    const sourceIndex = code.indexOf(searchLn)
    const ast = assertParse(code)

    const result = getNodePathFromSourceRange(
      ast,
      topLevelRange(sourceIndex, sourceIndex)
    )
    expect(result).toEqual([
      ['body', ''],
      [1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', ''],
      ['then_val', 'IfExpression'],
      ['body', 'IfExpression'],
      [0, 'index'],
      ['expression', 'ExpressionStatement'],
      ['left', 'BinaryExpression'],
    ])
    const _node = getNodeFromPath<Name>(ast, result)
    if (err(_node)) throw _node
    expect(_node.node.type).toEqual('Name')
    expect(_node.node.name.name).toEqual('x')
  })

  it('finds the node in import statement item', () => {
    const code = `import foo, bar as baz from 'thing.kcl'`
    const searchLn = `bar`
    const sourceIndex = code.indexOf(searchLn)
    const ast = assertParse(code)

    const result = getNodePathFromSourceRange(
      ast,
      topLevelRange(sourceIndex, sourceIndex)
    )
    expect(result).toEqual([
      ['body', ''],
      [0, 'index'],
      ['selector', 'ImportStatement'],
      ['items', 'ImportSelector'],
      [1, 'index'],
      ['name', 'ImportItem'],
    ])
    const _node = getNodeFromPath<Identifier>(ast, result)
    if (err(_node)) throw _node
    expect(_node.node.type).toEqual('Identifier')
    expect(_node.node.name).toEqual('bar')
  })
})

describe('Testing findUsesOfTagInPipe', () => {
  const exampleCode = `part001 = startSketchOn(-XZ)
|> startProfile(at = [68.12, 156.65])
|> line(end = [306.21, 198.82])
|> line(end = [306.21, 198.85], tag = $seg01)
|> angledLine(angle = -65, length = segLen(seg01))
|> line(end = [306.21, 198.87])
|> angledLine(angle = 65, length = segLen(seg01))`
  it('finds the current segment', async () => {
    const ast = assertParse(exampleCode)

    const lineOfInterest = `198.85], tag = $seg01`
    const characterIndex =
      exampleCode.indexOf(lineOfInterest) + lineOfInterest.length
    expect(characterIndex).toBeGreaterThanOrEqual(0)
    const pathToNode = getNodePathFromSourceRange(
      ast,
      topLevelRange(characterIndex, characterIndex)
    )
    const result = findUsesOfTagInPipe(ast, pathToNode)
    expect(result).toHaveLength(2)
    result.forEach((range) => {
      expect(exampleCode.slice(range[0], range[1])).toContain('segLen')
    })
  })
  it('find no tag if line has no tag', () => {
    const ast = assertParse(exampleCode)

    const lineOfInterest = `line(end = [306.21, 198.82])`
    const characterIndex =
      exampleCode.indexOf(lineOfInterest) + lineOfInterest.length
    const pathToNode = getNodePathFromSourceRange(
      ast,
      topLevelRange(characterIndex, characterIndex)
    )
    const result = findUsesOfTagInPipe(ast, pathToNode)
    expect(result).toHaveLength(0)
  })
})

describe('Testing hasSketchPipeBeenExtruded', () => {
  const exampleCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [3.29, 7.86])
  |> line(end = [2.48, 2.44])
  |> line(end = [2.66, 1.17])
  |> line(end = [3.75, 0.46])
  |> line(end = [4.99, -0.46], tag = $seg01)
  |> line(end = [3.3, -2.12])
  |> line(end = [2.16, -3.33])
  |> line(end = [0.85, -3.08])
  |> line(end = [-0.18, -3.36])
  |> line(end = [-3.86, -2.73])
  |> line(end = [-17.67, 0.85])
  |> close()
extrude001 = extrude(sketch001, length = 10)
sketch002 = startSketchOn(extrude001, face = seg01)
  |> startProfile(at = [-12.94, 6.6])
  |> line(end = [2.45, -0.2])
  |> line(end = [-2, -1.25])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch003 = startSketchOn(extrude001, face = 'END')
  |> startProfile(at = [8.14, 2.8])
  |> line(end = [-1.24, 4.39])
  |> line(end = [3.79, 1.91])
  |> line(end = [1.77, -2.95])
  |> line(end = [3.12, 1.74])
  |> line(end = [1.91, -4.09])
  |> line(end = [-5.6, -2.75])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 3.14)
`
  it('identifies sketch001 pipe as extruded (extrusion after pipe)', async () => {
    const ast = assertParse(exampleCode)
    const lineOfInterest = `line(end = [4.99, -0.46], tag = $seg01)`
    const characterIndex =
      exampleCode.indexOf(lineOfInterest) + lineOfInterest.length
    const extruded = hasSketchPipeBeenExtruded(
      {
        codeRef: codeRefFromRange(
          topLevelRange(characterIndex, characterIndex),
          ast
        ),
      },
      ast
    )
    expect(extruded).toBeTruthy()
  })
  it('identifies sketch002 pipe as not extruded', async () => {
    const ast = assertParse(exampleCode)
    const lineOfInterest = `line(end = [2.45, -0.2])`
    const characterIndex =
      exampleCode.indexOf(lineOfInterest) + lineOfInterest.length
    const extruded = hasSketchPipeBeenExtruded(
      {
        codeRef: codeRefFromRange(
          topLevelRange(characterIndex, characterIndex),
          ast
        ),
      },
      ast
    )
    expect(extruded).toBeFalsy()
  })
  it('identifies sketch003 pipe as extruded (extrusion within pipe)', async () => {
    const ast = assertParse(exampleCode)
    const lineOfInterest = `|> line(end = [3.12, 1.74])`
    const characterIndex =
      exampleCode.indexOf(lineOfInterest) + lineOfInterest.length
    const extruded = hasSketchPipeBeenExtruded(
      {
        codeRef: codeRefFromRange(
          topLevelRange(characterIndex, characterIndex),
          ast
        ),
      },
      ast
    )
    expect(extruded).toBeTruthy()
  })
})

describe('Testing doesSceneHaveSweepableSketch', () => {
  it('finds sketch001 pipe to be extruded', async () => {
    const exampleCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [3.29, 7.86])
  |> line(end = [2.48, 2.44])
  |> line(end = [-3.86, -2.73])
  |> line(end = [-17.67, 0.85])
  |> close()
extrude001 = extrude(sketch001, length = 10)
sketch002 = startSketchOn(extrude001, face = $seg01)
  |> startProfile(at = [-12.94, 6.6])
  |> line(end = [2.45, -0.2])
  |> line(end = [-2, -1.25])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`
    const ast = assertParse(exampleCode)
    const extrudable = doesSceneHaveSweepableSketch(ast)
    expect(extrudable).toBeTruthy()
  })
  it('finds sketch001 and sketch002 pipes to be lofted', async () => {
    const exampleCode = `sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
plane001 = offsetPlane(XZ, offset = 2)
sketch002 = startSketchOn(plane001)
  |> circle(center = [0, 0], radius = 3)
`
    const ast = assertParse(exampleCode)
    const extrudable = doesSceneHaveSweepableSketch(ast, 2)
    expect(extrudable).toBeTruthy()
  })
  it('should recognize that sketch001 has been extruded', async () => {
    const exampleCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [3.29, 7.86])
  |> line(end = [2.48, 2.44])
  |> line(end = [-3.86, -2.73])
  |> line(end = [-17.67, 0.85])
  |> close()
extrude001 = extrude(sketch001, length = 10)
`
    const ast = assertParse(exampleCode)
    const extrudable = doesSceneHaveSweepableSketch(ast)
    expect(extrudable).toBeFalsy()
  })
})

describe('Testing doesSceneHaveExtrudedSketch', () => {
  it('finds extruded sketch as variable', async () => {
    const exampleCode = `sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
extrude001 = extrude(sketch001, length = 1)
`
    const ast = assertParse(exampleCode)
    if (err(ast)) throw ast
    const extrudable = doesSceneHaveExtrudedSketch(ast)
    expect(extrudable).toBeTruthy()
  })
  it('finds extruded sketch in pipe', async () => {
    const exampleCode = `extrude001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
`
    const ast = assertParse(exampleCode)
    if (err(ast)) throw ast
    const extrudable = doesSceneHaveExtrudedSketch(ast)
    expect(extrudable).toBeTruthy()
  })
  it('finds no extrusion with sketch only', async () => {
    const exampleCode = `extrude001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
`
    const ast = assertParse(exampleCode)
    if (err(ast)) throw ast
    const extrudable = doesSceneHaveExtrudedSketch(ast)
    expect(extrudable).toBeFalsy()
  })
})

describe('Testing traverse and pathToNode', () => {
  it.each([
    ['basic', '2.73'],
    [
      'very nested, array, object, callExpression, array, memberExpression',
      'yo',
    ],
  ])('testing %s', async (_testName, literalOfInterest) => {
    const code = `myVar = 5
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [3.29, 7.86])
  |> line(end = [2.48, 2.44])
  |> line(end = [-3.86, -2.73])
  |> line(end = [-17.67, 0.85])
  |> close()
bing = { yo = 55 }
myNestedVar = [
  {
  prop =   line(end = [bing.yo, 21], tag = sketch001)
}
]
  `
    const ast = assertParse(code)
    let pathToNode: PathToNode = []
    traverse(ast, {
      enter: (node, path) => {
        if (
          node.type === 'Literal' &&
          String((node as any).value.value) === literalOfInterest
        ) {
          pathToNode = path
        } else if (
          node.type === 'Identifier' &&
          literalOfInterest.includes(node.name)
        ) {
          pathToNode = path
        }
      },
    })

    const literalIndex = code.indexOf(literalOfInterest)
    const pathToNode2 = getNodePathFromSourceRange(
      ast,
      topLevelRange(literalIndex + 2, literalIndex + 2)
    )
    expect(pathToNode).toEqual(pathToNode2)
  })
})

describe('Testing specific sketch getNodeFromPath workflow', () => {
  it('should parse the code', () => {
    const openSketch = `sketch001 = startSketchOn(XZ)
|> startProfile(at = [0.02, 0.22])
|> xLine(length = 0.39)
|> line([0.02, -0.17])
|> yLine(length = -0.15)
|> line([-0.21, -0.02])
|> xLine(length = -0.15)
|> line([-0.02, 0.21])
|> line([-0.08, 0.05])`
    const ast = assertParse(openSketch)
    expect(ast.start).toEqual(0)
    expect(ast.end).toEqual(231)
  })
  it('should find the location to add new lineTo', () => {
    const openSketch = `sketch001 = startSketchOn(XZ)
|> startProfile(at = [0.02, 0.22])
|> xLine(length = 0.39)
|> line([0.02, -0.17])
|> yLine(length = -0.15)
|> line([-0.21, -0.02])
|> xLine(length = -0.15)
|> line([-0.02, 0.21])
|> line([-0.08, 0.05])`
    const ast = assertParse(openSketch)

    const sketchSnippet = `startProfile(at = [0.02, 0.22])`
    const sketchRange = topLevelRange(
      openSketch.indexOf(sketchSnippet),
      openSketch.indexOf(sketchSnippet) + sketchSnippet.length
    )
    const sketchPathToNode = getNodePathFromSourceRange(ast, sketchRange)
    const modifiedAst = addCallExpressionsToPipe({
      node: ast,
      variables: {},
      pathToNode: sketchPathToNode,
      expressions: [
        createCallExpressionStdLibKw('line', null, [
          createLabeledArg(
            ARG_END_ABSOLUTE,
            createArrayExpression([
              createCallExpressionStdLibKw(
                'profileStartX',
                createPipeSubstitution(),
                []
              ),
              createCallExpressionStdLibKw(
                'profileStartY',
                createPipeSubstitution(),
                []
              ),
            ])
          ),
        ]),
      ],
    })
    if (err(modifiedAst)) throw modifiedAst
    const recasted = recast(modifiedAst)
    const expectedCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0.02, 0.22])
  |> xLine(length = 0.39)
  |> line([0.02, -0.17])
  |> yLine(length = -0.15)
  |> line([-0.21, -0.02])
  |> xLine(length = -0.15)
  |> line([-0.02, 0.21])
  |> line([-0.08, 0.05])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
`
    expect(recasted).toEqual(expectedCode)
  })
  it('it should find the location to add close', () => {
    const openSketch = `sketch001 = startSketchOn(XZ)
|> startProfile(at = [0.02, 0.22])
|> xLine(length = 0.39)
|> line([0.02, -0.17])
|> yLine(length = -0.15)
|> line([-0.21, -0.02])
|> xLine(length = -0.15)
|> line([-0.02, 0.21])
|> line([-0.08, 0.05])
|> lineTo([profileStartX(%), profileStartY(%)])
`
    const ast = assertParse(openSketch)
    const sketchSnippet = `startProfile(at = [0.02, 0.22])`
    const sketchRange = topLevelRange(
      openSketch.indexOf(sketchSnippet),
      openSketch.indexOf(sketchSnippet) + sketchSnippet.length
    )
    const sketchPathToNode = getNodePathFromSourceRange(ast, sketchRange)
    const modifiedAst = addCloseToPipe({
      node: ast,
      variables: {},
      pathToNode: sketchPathToNode,
    })

    if (err(modifiedAst)) throw modifiedAst
    const recasted = recast(modifiedAst)
    const expectedCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0.02, 0.22])
  |> xLine(length = 0.39)
  |> line([0.02, -0.17])
  |> yLine(length = -0.15)
  |> line([-0.21, -0.02])
  |> xLine(length = -0.15)
  |> line([-0.02, 0.21])
  |> line([-0.08, 0.05])
  |> lineTo([profileStartX(%), profileStartY(%)])
  |> close()
`
    expect(recasted).toEqual(expectedCode)
  })
  it('regression: it not freak out while getting a node, but the nodeToPath is wrong/stale', () => {
    const ast: Node<Program> = JSON.parse(
      `{"body":[{"type":"VariableDeclaration","declaration":{"type":"VariableDeclarator","id":{"type":"Identifier","name":"gear","start":52,"end":56,"commentStart":52},"init":{"type":"FunctionExpression","params":[{"type":"Parameter","identifier":{"type":"Identifier","name":"nTeeth","start":57,"end":63,"commentStart":57}},{"type":"Parameter","identifier":{"type":"Identifier","name":"module","start":65,"end":71,"commentStart":65}},{"type":"Parameter","identifier":{"type":"Identifier","name":"pressureAngle","start":73,"end":86,"commentStart":73}},{"type":"Parameter","identifier":{"type":"Identifier","name":"profileShift","start":88,"end":100,"commentStart":88}}],"body":{"body":[],"start":103,"end":103,"commentStart":103},"start":56,"end":105,"commentStart":56},"start":52,"end":105,"commentStart":52},"kind":"fn","start":49,"end":105,"commentStart":46},{"type":"VariableDeclaration","declaration":{"type":"VariableDeclarator","id":{"type":"Identifier","name":"nTeeth","start":107,"end":113,"commentStart":107},"init":{"type":"Literal","value":{"value":1,"suffix":"None"},"raw":"1","start":114,"end":115,"commentStart":114},"start":107,"end":115,"commentStart":107},"kind":"const","start":107,"end":115,"commentStart":105},{"type":"VariableDeclaration","declaration":{"type":"VariableDeclarator","id":{"type":"Identifier","name":"module","start":116,"end":122,"commentStart":116},"init":{"type":"Literal","value":{"value":32,"suffix":"None"},"raw":"32","start":125,"end":127,"commentStart":125},"start":116,"end":127,"commentStart":116},"kind":"const","start":116,"end":127,"commentStart":116},{"type":"VariableDeclaration","declaration":{"type":"VariableDeclarator","id":{"type":"Identifier","name":"pressureAngle","start":128,"end":141,"commentStart":128},"init":{"type":"Literal","value":{"value":17,"suffix":"None"},"raw":"17","start":142,"end":144,"commentStart":142},"start":128,"end":144,"commentStart":128},"kind":"const","start":128,"end":144,"commentStart":128},{"type":"VariableDeclaration","declaration":{"type":"VariableDeclarator","id":{"type":"Identifier","name":"profileShift","start":145,"end":157,"commentStart":145},"init":{"type":"Literal","value":{"value":12,"suffix":"None"},"raw":"12","start":158,"end":160,"commentStart":158},"start":145,"end":160,"commentStart":145},"kind":"const","start":145,"end":160,"commentStart":145},{"type":"VariableDeclaration","declaration":{"type":"VariableDeclarator","id":{"type":"Identifier","name":"g","start":161,"end":162,"commentStart":161},"init":{"type":"CallExpressionKw","callee":{"type":"Name","name":{"type":"Identifier","name":"gear","start":165,"end":169,"commentStart":165},"path":[],"abs_path":false,"start":165,"end":169,"commentStart":165},"unlabeled":null,"arguments":[{"type":"LabeledArg","label":{"type":"Identifier","name":"nTeeth","start":170,"end":176,"commentStart":170},"arg":{"type":"Name","name":{"type":"Identifier","name":"nTeeth","start":177,"end":183,"commentStart":177},"path":[],"abs_path":false,"start":177,"end":183,"commentStart":177}},{"type":"LabeledArg","label":null,"arg":{"type":"Name","name":{"type":"Identifier","name":"module","start":185,"end":191,"commentStart":185},"path":[],"abs_path":false,"start":185,"end":191,"commentStart":185}},{"type":"LabeledArg","label":null,"arg":{"type":"Name","name":{"type":"Identifier","name":"pressureAngle","start":193,"end":206,"commentStart":193},"path":[],"abs_path":false,"start":193,"end":206,"commentStart":193}},{"type":"LabeledArg","label":null,"arg":{"type":"Name","name":{"type":"Identifier","name":"profileShift","start":208,"end":220,"commentStart":208},"path":[],"abs_path":false,"start":208,"end":220,"commentStart":208}}],"start":165,"end":221,"commentStart":165},"start":161,"end":221,"commentStart":161},"kind":"const","start":161,"end":221,"commentStart":161}],"nonCodeMeta":{"nonCodeNodes":{"0":[{"type":"NonCodeNode","value":{"type":"newLine"},"start":105,"end":107,"commentStart":105}]},"startNodes":[{"type":"NonCodeNode","value":{"type":"newLine"},"start":46,"end":49,"commentStart":46}]},"innerAttrs":[{"type":"Annotation","name":{"type":"Identifier","name":"settings","start":14,"end":22,"commentStart":14},"properties":[{"type":"ObjectProperty","key":{"type":"Identifier","name":"defaultLengthUnit","start":23,"end":40,"commentStart":23},"value":{"type":"Name","name":{"type":"Identifier","name":"mm","start":43,"end":45,"commentStart":43},"path":[],"abs_path":false,"start":43,"end":45,"commentStart":43},"start":23,"end":45,"commentStart":23}],"start":13,"end":46,"preComments":["// Set Units"],"commentStart":0}],"start":0,"end":222,"commentStart":0}`
    )

    const selectionRange: Selection = {
      codeRef: {
        range: [176, 176, 0],
        pathToNode: [
          ['body', ''],
          [5, 'index'],
          ['declaration', 'VariableDeclaration'],
          ['init', ''],
          // this doesn't exist as the first argument is a labeled one
          ['unlabeled', 'unlabeled first arg'],
        ],
      },
    }
    const result = isCursorInFunctionDefinition(ast, selectionRange)
    expect(result).toEqual(false)
  })
})

describe('Testing findOperationArtifact', () => {
  it('should find the correct artifact for a given operation', async () => {
    const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [10, 10])
  |> line(end = [0, 10])
  |> close()
plane001 = offsetPlane(YZ, offset = 10)
part001 = startSketchOn(plane001)
  |> startProfile(at = [0, 0])
  |> line(end = [5, 0])
  |> line(end = [5, 5])
  |> line(end = [0, 5])
  |> close()
`

    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast, false)
    const { operations, artifactGraph } = execState

    expect(operations).toBeTruthy()
    expect(operations.length).toBeGreaterThan(0)

    // Find an offsetPlane operation
    const offsetPlaneOp = operations.find(
      (op) => op.type === 'StdLibCall' && op.name === 'offsetPlane'
    )
    expect(offsetPlaneOp).toBeTruthy()

    if (offsetPlaneOp && isOffsetPlane(offsetPlaneOp)) {
      const artifact = findOperationPlaneArtifact(offsetPlaneOp, artifactGraph)

      expect(artifact).toBeTruthy()
      expect(artifact?.type).toBe('plane')

      const artifactNodePath = JSON.stringify(
        (artifact as Plane)?.codeRef?.nodePath
      )
      const operationNodePath = JSON.stringify(offsetPlaneOp.nodePath)
      expect(artifactNodePath).toBe(operationNodePath)
    }
  })
})

describe('Testing getSelectedPlaneId', () => {
  it('should return the id of the selected default plane', () => {
    const selections: Selections = {
      otherSelections: [
        {
          name: 'XY', // actually, this is lowercase during runtime ("xy")!
          id: 'default-plane-xy-id',
        },
      ],
      graphSelections: [],
    }

    const result = getSelectedPlaneId(selections)
    expect(result).toBe('default-plane-xy-id')
  })

  it('should return the id of the selected offset plane', () => {
    const selections: Selections = {
      otherSelections: [],
      graphSelections: [
        {
          artifact: {
            type: 'plane' as const,
            id: 'offset-plane-id',
            pathIds: [],
            codeRef: {
              nodePath: {
                steps: [],
              },
              range: [0, 10, 0] as [number, number, number],
              pathToNode: [
                ['body', ''],
                [0, 'index'],
              ] as PathToNode,
            },
          },
          codeRef: {
            range: [0, 10, 0] as [number, number, number],
            pathToNode: [
              ['body', ''],
              [0, 'index'],
            ] as PathToNode,
          },
        },
      ],
    }

    const result = getSelectedPlaneId(selections)
    expect(result).toBe('offset-plane-id')
  })

  it('should prioritize default plane over offset plane when both are selected', () => {
    const mockPlaneArtifact = {
      type: 'plane' as const,
      id: 'offset-plane-id',
      pathIds: [],
      codeRef: {
        range: [0, 10, 0] as [number, number, number],
        nodePath: { steps: [] },
        pathToNode: [
          ['body', ''],
          [0, 'index'],
        ] as PathToNode,
      },
    }

    const selections: Selections = {
      otherSelections: [
        {
          name: 'XY',
          id: 'default-plane-xy-id',
        },
      ],
      graphSelections: [
        {
          artifact: mockPlaneArtifact,
          codeRef: {
            range: [0, 10, 0] as [number, number, number],
            pathToNode: [
              ['body', ''],
              [0, 'index'],
            ] as PathToNode,
          },
        },
      ],
    }

    const result = getSelectedPlaneId(selections)
    expect(result).toBe('default-plane-xy-id')
  })

  it('should return null when no plane is selected', () => {
    const selections: Selections = {
      otherSelections: ['x-axis'],
      graphSelections: [
        {
          artifact: {
            type: 'startSketchOnFace' as const,
            id: 'segment-id',
            faceId: 'face-id',
            codeRef: {
              range: [0, 10, 0] as [number, number, number],
              nodePath: { steps: [] },
              pathToNode: [
                ['body', ''],
                [0, 'index'],
              ] as PathToNode,
            },
          },
          codeRef: {
            range: [0, 10, 0] as [number, number, number],
            pathToNode: [
              ['body', ''],
              [0, 'index'],
            ] as PathToNode,
          },
        },
      ],
    }

    const result = getSelectedPlaneId(selections)
    expect(result).toBeNull()
  })

  it('should return null when selection is empty', () => {
    const selections: Selections = {
      otherSelections: [],
      graphSelections: [],
    }

    const result = getSelectedPlaneId(selections)
    expect(result).toBeNull()
  })
})

describe('Testing getSelectedPlaneAsNode', () => {
  it('should return a Node<Literal> for default plane selection', async () => {
    const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [10, 10])
  |> line(end = [0, 10])
  |> close()
plane001 = offsetPlane(YZ, offset = 10)
`

    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast, false)
    const { variables } = execState

    const selections: Selections = {
      otherSelections: [
        {
          name: 'XY',
          id: 'default-plane-xy-id',
        },
      ],
      graphSelections: [],
    }

    const result = getSelectedPlaneAsNode(selections, variables)
    expect(result).toBeTruthy()
    expect(result?.type).toBe('Literal')
    if (result?.type !== 'Literal') {
      // To make TypeScript happy
      throw new Error('Expected result to be a Literal node')
    }

    expect(result?.value).toBe('XY')
  })
})

describe('Testing getVariableExprsFromSelection', () => {
  it('should find the variable expr in a simple profile selection', async () => {
    const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
`
    const ast = assertParse(circleProfileInVar)
    const { artifactGraph } = await enginelessExecutor(ast)
    const artifact = [...artifactGraph.values()].find((a) => a.type === 'path')
    if (!artifact) {
      throw new Error('Artifact not found in the graph')
    }
    const selections: Selections = {
      graphSelections: [
        {
          codeRef: artifact.codeRef,
          artifact,
        },
      ],
      otherSelections: [],
    }
    const vars = getVariableExprsFromSelection(selections, ast)
    if (err(vars)) throw vars

    expect(vars.exprs).toHaveLength(1)
    if (vars.exprs[0].type !== 'Name') {
      throw new Error(`Expected Name, got ${vars.exprs[0].type}`)
    }

    expect(vars.exprs[0].name.name).toEqual('profile001')
    expect(vars.pathIfPipe).toBeUndefined()
  })

  // Test for https://github.com/KittyCAD/modeling-app/issues/7669
  it('should find only one variable expr for two selections pointing to the same variable', async () => {
    const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
`
    const ast = assertParse(circleProfileInVar)
    const { artifactGraph } = await enginelessExecutor(ast)
    const artifact = [...artifactGraph.values()].find((a) => a.type === 'path')
    if (!artifact) {
      throw new Error('Artifact not found in the graph')
    }
    const selections: Selections = {
      graphSelections: [
        {
          codeRef: artifact.codeRef,
          artifact,
        },
        {
          codeRef: artifact.codeRef,
          artifact,
        }, // duplicate selection
      ],
      otherSelections: [],
    }
    const vars = getVariableExprsFromSelection(selections, ast)
    if (err(vars)) throw vars
    expect(vars.exprs).toHaveLength(1)
  })

  it('should return the pipe substitution symbol in a variable-less simple profile selection', async () => {
    const circleProfileInVar = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
`
    const ast = assertParse(circleProfileInVar)
    const { artifactGraph } = await enginelessExecutor(ast)
    const artifact = [...artifactGraph.values()].find((a) => a.type === 'path')
    if (!artifact) {
      throw new Error('Artifact not found in the graph')
    }
    const selections: Selections = {
      graphSelections: [
        {
          codeRef: artifact.codeRef,
          artifact,
        },
      ],
      otherSelections: [],
    }
    const vars = getVariableExprsFromSelection(selections, ast)
    if (err(vars)) throw vars

    expect(vars.exprs).toHaveLength(1)
    expect(vars.exprs[0].type).toEqual('PipeSubstitution')

    expect(vars.pathIfPipe).toBeDefined()
    expect(vars.pathIfPipe).toEqual([
      ['body', ''],
      [0, 'index'],
      ['expression', 'ExpressionStatement'],
      ['body', 'PipeExpression'],
      [1, 'index'],
    ])
  })

  it('should find the variable exprs in a multi profile selection ', async () => {
    const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
profile002 = circle(sketch001, center = [2, 2], radius = 1)
`
    const ast = assertParse(circleProfileInVar)
    const { artifactGraph } = await enginelessExecutor(ast)
    const artifacts = [...artifactGraph.values()].filter(
      (a) => a.type === 'path'
    )
    if (!artifacts || artifacts.length !== 2) {
      throw new Error('Artifact not found in the graph')
    }
    const selections: Selections = {
      graphSelections: artifacts.map((artifact) => {
        return {
          codeRef: artifact.codeRef,
          artifact,
        }
      }),
      otherSelections: [],
    }
    const vars = getVariableExprsFromSelection(selections, ast)
    if (err(vars)) throw vars

    expect(vars.exprs).toHaveLength(2)
    if (vars.exprs[0].type !== 'Name') {
      throw new Error(`Expected Name, got ${vars.exprs[0].type}`)
    }

    if (vars.exprs[1].type !== 'Name') {
      throw new Error(`Expected Name, got ${vars.exprs[1].type}`)
    }

    expect(vars.exprs[0].name.name).toEqual('profile001')
    expect(vars.exprs[1].name.name).toEqual('profile002')
    expect(vars.pathIfPipe).toBeUndefined()
  })

  it('should return the pipe substitution symbol and a variable name in a complex multi profile selection', async () => {
    const circleProfileInVar = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
profile002 = circle(sketch001, center = [2, 2], radius = 1)
`
    const ast = assertParse(circleProfileInVar)
    const { artifactGraph } = await enginelessExecutor(ast)
    const artifacts = [...artifactGraph.values()].filter(
      (a) => a.type === 'path'
    )
    if (!artifacts || artifacts.length !== 2) {
      throw new Error('Artifact not found in the graph')
    }
    const selections: Selections = {
      graphSelections: artifacts.map((artifact) => {
        return {
          codeRef: artifact.codeRef,
          artifact,
        }
      }),
      otherSelections: [],
    }
    const vars = getVariableExprsFromSelection(selections, ast)
    if (err(vars)) throw vars

    expect(vars.exprs).toHaveLength(2)
    if (vars.exprs[0].type !== 'PipeSubstitution') {
      throw new Error(`Expected PipeSubstitution, got ${vars.exprs[0].type}`)
    }

    if (vars.exprs[1].type !== 'Name') {
      throw new Error(`Expected Name, got ${vars.exprs[1].type}`)
    }

    expect(vars.exprs[1].name.name).toEqual('profile002')

    expect(vars.pathIfPipe).toBeDefined()
    expect(vars.pathIfPipe).toEqual([
      ['body', ''],
      [0, 'index'],
      ['expression', 'ExpressionStatement'],
      ['body', 'PipeExpression'],
      [1, 'index'],
    ])
  })

  it('should find the extrude variable expr on profile selection with child look up flag', async () => {
    const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
`
    const ast = assertParse(circleProfileInVar)
    const { artifactGraph } = await enginelessExecutor(ast)
    const artifact = [...artifactGraph.values()].find((a) => a.type === 'path')
    if (!artifact) {
      throw new Error('Artifact not found in the graph')
    }
    const selections: Selections = {
      graphSelections: [
        {
          codeRef: artifact.codeRef,
          artifact,
        },
      ],
      otherSelections: [],
    }
    const nodeToEdit = undefined // no node to edit, just want the variable exprs
    const lastChildLookup = true // we want to look up the child of the profile variable
    const vars = getVariableExprsFromSelection(
      selections,
      ast,
      nodeToEdit,
      lastChildLookup,
      artifactGraph
    )
    if (err(vars)) throw vars

    expect(vars.exprs).toHaveLength(1)
    if (vars.exprs[0].type !== 'Name') {
      throw new Error(`Expected Name, got ${vars.exprs[0].type}`)
    }

    expect(vars.exprs[0].name.name).toEqual('extrude001')
    expect(vars.pathIfPipe).toBeUndefined()
  })
})

describe('Testing retrieveSelectionsFromOpArg', () => {
  it('should find the profile selection from simple extrude op', async () => {
    const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
`
    const ast = assertParse(circleProfileInVar)
    const { artifactGraph, operations } = await enginelessExecutor(ast)
    const op = operations.find(
      (o) => o.type === 'StdLibCall' && o.name === 'extrude'
    )
    if (!op || op.type !== 'StdLibCall' || !op.unlabeledArg) {
      throw new Error('Extrude operation not found')
    }

    const selections = retrieveSelectionsFromOpArg(
      op.unlabeledArg,
      artifactGraph
    )
    if (err(selections)) throw selections
    expect(selections.graphSelections).toHaveLength(1)
    const selection = selections.graphSelections[0]
    if (!selection.artifact) {
      throw new Error('Artifact not found in the selection')
    }
    expect(selection.artifact.type).toEqual('path')
  })

  it('should find two profile selections from multi-profile revolve op', async () => {
    const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [3, 0], radius = 1)
profile002 = circle(sketch001, center = [6, 0], radius = 1)
revolve001 = revolve([profile001, profile002], axis = X, angle = 180)
`
    const ast = assertParse(circleProfileInVar)
    const { artifactGraph, operations } = await enginelessExecutor(ast)
    const op = operations.find(
      (o) => o.type === 'StdLibCall' && o.name === 'revolve'
    )
    if (!op || op.type !== 'StdLibCall' || !op.unlabeledArg) {
      throw new Error('Revolve operation not found')
    }

    const selections = retrieveSelectionsFromOpArg(
      op.unlabeledArg,
      artifactGraph
    )
    if (err(selections)) throw selections
    expect(selections.graphSelections).toHaveLength(2)
    if (
      !selections.graphSelections[0].artifact ||
      !selections.graphSelections[1].artifact
    ) {
      throw new Error('Artifact not found in the selection')
    }
    expect(selections.graphSelections[0].artifact.type).toEqual('path')
    expect(selections.graphSelections[1].artifact.type).toEqual('path')
  })

  it('should find the solids selection from a variable-less transform call', async () => {
    const redExtrusion = `sketch001 = startSketchOn(XZ)
profile001 = circle(
  sketch001,
  center = [0, 0],
  radius = 100
)
extrude001 = extrude(profile001, length = 100)
appearance(extrude001, color = '#FF0000')`
    const ast = assertParse(redExtrusion)
    const { artifactGraph, operations } = await enginelessExecutor(ast)
    const op = operations.find(
      (o) => o.type === 'StdLibCall' && o.name === 'appearance'
    )
    if (!op || op.type !== 'StdLibCall' || !op.unlabeledArg) {
      throw new Error('Appearance operation not found')
    }

    const selections = retrieveSelectionsFromOpArg(
      op.unlabeledArg,
      artifactGraph
    )
    if (err(selections)) throw selections
    expect(selections.graphSelections).toHaveLength(1)
    const selection = selections.graphSelections[0]
    if (!selection.artifact) {
      throw new Error('Artifact not found in the selection')
    }
    expect(selection.artifact.type).toEqual('sweep')
  })
})
