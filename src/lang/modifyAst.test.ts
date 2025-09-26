import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createObjectExpression,
  createPipeExpression,
  createPipeSubstitution,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import {
  addSketchTo,
  createPathToNodeForLastVariable,
  createVariableExpressionsArray,
  deleteSegmentFromPipeExpression,
  moveValueIntoNewVariable,
  setCallInAst,
  sketchOnExtrudedFace,
  splitPipedProfile,
} from '@src/lang/modifyAst'
import { deleteFromSelection } from '@src/lang/modifyAst/deleteFromSelection'
import { giveSketchFnCallTag } from '@src/lang/modifyAst/giveSketchFnCallTag'
import {
  findUsesOfTagInPipe,
  getNodeFromPath,
  getVariableExprsFromSelection,
} from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact } from '@src/lang/std/artifactGraph'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'
import type { Identifier, Literal } from '@src/lang/wasm'
import { assertParse, recast } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import type { Selections } from '@src/lib/selections'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import {
  addTagForSketchOnFace,
  getConstraintInfoKw,
} from '@src/lang/std/sketch'

beforeAll(async () => {
  await initPromise
})

describe('Testing createLiteral', () => {
  it('should create a literal number without units', () => {
    const result = createLiteral(5)
    expect(result.type).toBe('Literal')
    expect((result as any).value.value).toBe(5)
    expect((result as any).value.suffix).toBe('None')
    expect((result as Literal).raw).toBe('5')
  })
  it('should create a literal number with units', () => {
    const result = createLiteral(5, 'Mm')
    expect(result.type).toBe('Literal')
    expect((result as any).value.value).toBe(5)
    expect((result as any).value.suffix).toBe('Mm')
    expect((result as Literal).raw).toBe('5mm')
  })
  it('should create a literal boolean', () => {
    const result = createLiteral(false)
    expect(result.type).toBe('Literal')
    expect((result as Literal).value).toBe(false)
    expect((result as Literal).raw).toBe('false')
  })
})
describe('Testing createIdentifier', () => {
  it('should create an identifier', () => {
    const result = createIdentifier('myVar')
    expect(result.type).toBe('Identifier')
    expect(result.name).toBe('myVar')
  })
})
describe('Testing createObjectExpression', () => {
  it('should create an object expression', () => {
    const result = createObjectExpression({
      myProp: createLiteral(5),
    })
    expect(result.type).toBe('ObjectExpression')
    expect(result.properties[0].type).toBe('ObjectProperty')
    expect(result.properties[0].key.name).toBe('myProp')
    expect(result.properties[0].value.type).toBe('Literal')
    expect((result.properties[0].value as any).value.value).toBe(5)
  })
})
describe('Testing createArrayExpression', () => {
  it('should create an array expression', () => {
    const result = createArrayExpression([createLiteral(5)])
    expect(result.type).toBe('ArrayExpression')
    expect(result.elements[0].type).toBe('Literal')
    expect((result.elements[0] as any).value.value).toBe(5)
  })
})
describe('Testing createPipeSubstitution', () => {
  it('should create a pipe substitution', () => {
    const result = createPipeSubstitution()
    expect(result.type).toBe('PipeSubstitution')
  })
})
describe('Testing createVariableDeclaration', () => {
  it('should create a variable declaration', () => {
    const result = createVariableDeclaration('myVar', createLiteral(5))
    expect(result.type).toBe('VariableDeclaration')
    expect(result.declaration.type).toBe('VariableDeclarator')
    expect(result.declaration.id.type).toBe('Identifier')
    expect(result.declaration.id.name).toBe('myVar')
    expect(result.declaration.init.type).toBe('Literal')
    expect((result.declaration.init as any).value.value).toBe(5)
  })
})
describe('Testing createPipeExpression', () => {
  it('should create a pipe expression', () => {
    const result = createPipeExpression([createLiteral(5)])
    expect(result.type).toBe('PipeExpression')
    expect(result.body[0].type).toBe('Literal')
    expect((result.body[0] as any).value.value).toBe(5)
  })
})

describe('Testing findUniqueName', () => {
  it('should find a unique name', () => {
    const result = findUniqueName(
      JSON.stringify([
        {
          type: 'Identifier',
          name: 'yo01',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
          preComments: [],
          commentStart: 0,
        },
        {
          type: 'Identifier',
          name: 'yo02',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
          preComments: [],
          commentStart: 0,
        },
        {
          type: 'Identifier',
          name: 'yo03',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
          preComments: [],
          commentStart: 0,
        },
        {
          type: 'Identifier',
          name: 'yo04',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
          preComments: [],
          commentStart: 0,
        },
        {
          type: 'Identifier',
          name: 'yo05',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
          preComments: [],
          commentStart: 0,
        },
        {
          type: 'Identifier',
          name: 'yo06',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
          preComments: [],
          commentStart: 0,
        },
        {
          type: 'Identifier',
          name: 'yo07',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
          preComments: [],
          commentStart: 0,
        },
        {
          type: 'Identifier',
          name: 'yo08',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
          preComments: [],
          commentStart: 0,
        },
        {
          type: 'Identifier',
          name: 'yo09',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
          preComments: [],
          commentStart: 0,
        },
      ] satisfies Node<Identifier>[]),
      'yo',
      2
    )
    expect(result).toBe('yo10')
  })
})
describe('Testing addSketchTo', () => {
  it('should add a sketch to a program', () => {
    const result = addSketchTo(
      {
        body: [],
        shebang: null,
        start: 0,
        end: 0,
        moduleId: 0,
        nonCodeMeta: { nonCodeNodes: {}, startNodes: [] },
        innerAttrs: [],
        outerAttrs: [],
        preComments: [],
        commentStart: 0,
      },
      'yz'
    )
    const str = recast(result.modifiedAst)
    expect(str).toBe(`sketch001 = startSketchOn(YZ)
  |> startProfile(at = 'default')
  |> line(end = 'default')
`)
  })
})

function giveSketchFnCallTagTestHelper(
  code: string,
  searchStr: string
): { tag: string; newCode: string; isTagExisting: boolean } {
  // giveSketchFnCallTag inputs and outputs an ast, which is very verbose for testing
  // this wrapper changes the input and output to code
  // making it more of an integration test, but easier to read the test intention is the goal
  const ast = assertParse(code)
  const start = code.indexOf(searchStr)
  const range = topLevelRange(start, start + searchStr.length)
  const sketchRes = giveSketchFnCallTag(ast, range)
  if (err(sketchRes)) throw sketchRes
  const { modifiedAst, tag, isTagExisting } = sketchRes
  const newCode = recast(modifiedAst)
  if (err(newCode)) throw newCode
  return { tag, newCode, isTagExisting }
}

describe('Testing giveSketchFnCallTag', () => {
  const code = `part001 = startSketchOn(XY)
|> startProfile(at = [0, 0])
|> line(end = [-2.57, -0.13])
|> line(end = [0, 0.83])
|> line(end = [0.82, 0.34])`
  it('Should add tag to a sketch function call', () => {
    const { newCode, tag, isTagExisting } = giveSketchFnCallTagTestHelper(
      code,
      'line(end = [0, 0.83])'
    )
    expect(newCode).toContain('line(end = [0, 0.83], tag = $seg01)')
    expect(tag).toBe('seg01')
    expect(isTagExisting).toBe(false)
  })
  it('Should create a unique tag if seg01 already exists', () => {
    let _code = code.replace(
      'line(end = [-2.57, -0.13])',
      'line(end = [-2.57, -0.13], tag = $seg01)'
    )
    const { newCode, tag, isTagExisting } = giveSketchFnCallTagTestHelper(
      _code,
      'line(end = [0, 0.83])'
    )
    expect(newCode).toContain('line(end = [0, 0.83], tag = $seg02)')
    expect(tag).toBe('seg02')
    expect(isTagExisting).toBe(false)
  })
  it('Should return existing tag if it already exists', () => {
    const lineButWithTag = 'line(end = [-2.57, -0.13], tag = $butts)'
    let _code = code.replace('line(end = [-2.57, -0.13])', lineButWithTag)
    const { newCode, tag, isTagExisting } = giveSketchFnCallTagTestHelper(
      _code,
      lineButWithTag
    )
    expect(newCode).toContain(lineButWithTag) // no change
    expect(tag).toBe('butts')
    expect(isTagExisting).toBe(true)
  })
})

describe('Testing moveValueIntoNewVariable', () => {
  const fn = (fnName: string) => `fn ${fnName} (@x) {
  return x
}
`
  const code = `${fn('def')}${fn('jkl')}${fn('hmm')}
fn ghi(@x) {
    return 2deg
}
abc = 3deg
identifierGuy = 5
yo = 5deg + 6deg
part001 = startSketchOn(XY)
|> startProfile(at = [-1.2, 4.83])
|> line(end = [2.8, 0])
|> angledLine(angle = 100deg + 100deg, length = 3.09)
|> angledLine(angle = abc, length = 3.09)
|> angledLine(angle = def(yo), length = 3.09)
|> angledLine(angle = ghi(%), length = 3.09)
|> angledLine(angle = jkl(yo) + 2deg, length = 3.09)
yo2 = hmm([identifierGuy + 5])`
  it('should move a binary expression into a new variable', async () => {
    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast)
    const startIndex = code.indexOf('100deg + 100deg') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      execState.variables,
      topLevelRange(startIndex, startIndex),
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`newVar = 100deg + 100deg`)
    expect(newCode).toContain(`angledLine(angle = newVar, length = 3.09)`)
  })
  it('should move a value into a new variable', async () => {
    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast)
    const startIndex = code.indexOf('2.8') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      execState.variables,
      topLevelRange(startIndex, startIndex),
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`newVar = 2.8`)
    expect(newCode).toContain(`line(end = [newVar, 0])`)
  })
  it('should move a callExpression into a new variable', async () => {
    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast)
    const startIndex = code.indexOf('def(')
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      execState.variables,
      topLevelRange(startIndex, startIndex),
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`newVar = def(yo)`)
    expect(newCode).toContain(`angledLine(angle = newVar, length = 3.09)`)
  })
  it('should move a binary expression with call expression into a new variable', async () => {
    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast)
    const startIndex = code.indexOf('jkl(') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      execState.variables,
      topLevelRange(startIndex, startIndex),
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`newVar = jkl(yo) + 2deg`)
    expect(newCode).toContain(`angledLine(angle = newVar, length = 3.09)`)
  })
  it('should move a identifier into a new variable', async () => {
    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast)
    const startIndex = code.indexOf('identifierGuy +') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      execState.variables,
      topLevelRange(startIndex, startIndex),
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`newVar = identifierGuy + 5`)
    expect(newCode).toContain(`yo2 = hmm([newVar])`)
  })
})

describe('testing sketchOnExtrudedFace', () => {
  test('it should be able to extrude on regular segments', async () => {
    const code = `part001 = startSketchOn(-XZ)
  |> startProfile(at = [3.58, 2.06])
  |> line(end = [9.7, 9.19])
  |> line(end = [8.62, -9.57])
  |> close()
  |> extrude(length = 5 + 7)`
    const ast = assertParse(code)

    const segmentSnippet = `line(end = [9.7, 9.19])`
    const segmentRange = topLevelRange(
      code.indexOf(segmentSnippet),
      code.indexOf(segmentSnippet) + segmentSnippet.length
    )
    const segmentPathToNode = getNodePathFromSourceRange(ast, segmentRange)
    const extrudeSnippet = `extrude(length = 5 + 7)`
    const extrudeRange = topLevelRange(
      code.indexOf(extrudeSnippet),
      code.indexOf(extrudeSnippet) + extrudeSnippet.length
    )
    const extrudePathToNode = getNodePathFromSourceRange(ast, extrudeRange)

    const extruded = sketchOnExtrudedFace(
      ast,
      segmentPathToNode,
      extrudePathToNode,
      addTagForSketchOnFace
    )
    if (err(extruded)) throw extruded
    const { modifiedAst } = extruded

    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`part001 = startSketchOn(-XZ)
  |> startProfile(at = [3.58, 2.06])
  |> line(end = [9.7, 9.19], tag = $seg01)
  |> line(end = [8.62, -9.57])
  |> close()
  |> extrude(length = 5 + 7)
sketch001 = startSketchOn(part001, face = seg01)`)
  })
  test('it should be able to extrude on close segments', async () => {
    const code = `part001 = startSketchOn(-XZ)
  |> startProfile(at = [3.58, 2.06])
  |> line(end = [9.7, 9.19])
  |> line(end = [8.62, -9.57])
  |> close()
  |> extrude(length = 5 + 7)`
    const ast = assertParse(code)
    const segmentSnippet = `close()`
    const segmentRange = topLevelRange(
      code.indexOf(segmentSnippet),
      code.indexOf(segmentSnippet) + segmentSnippet.length
    )
    const segmentPathToNode = getNodePathFromSourceRange(ast, segmentRange)
    const extrudeSnippet = `extrude(length = 5 + 7)`
    const extrudeRange = topLevelRange(
      code.indexOf(extrudeSnippet),
      code.indexOf(extrudeSnippet) + extrudeSnippet.length
    )
    const extrudePathToNode = getNodePathFromSourceRange(ast, extrudeRange)

    const extruded = sketchOnExtrudedFace(
      ast,
      segmentPathToNode,
      extrudePathToNode,
      addTagForSketchOnFace
    )
    if (err(extruded)) throw extruded
    const { modifiedAst } = extruded

    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`part001 = startSketchOn(-XZ)
  |> startProfile(at = [3.58, 2.06])
  |> line(end = [9.7, 9.19])
  |> line(end = [8.62, -9.57])
  |> close(tag = $seg01)
  |> extrude(length = 5 + 7)
sketch001 = startSketchOn(part001, face = seg01)`)
  })
  test('it should be able to extrude on start-end caps', async () => {
    const code = `part001 = startSketchOn(-XZ)
  |> startProfile(at = [3.58, 2.06])
  |> line(end = [9.7, 9.19])
  |> line(end = [8.62, -9.57])
  |> close()
  |> extrude(length = 5 + 7)`
    const ast = assertParse(code)
    const sketchSnippet = `startProfile(at = [3.58, 2.06])`
    const sketchRange = topLevelRange(
      code.indexOf(sketchSnippet),
      code.indexOf(sketchSnippet) + sketchSnippet.length
    )
    const sketchPathToNode = getNodePathFromSourceRange(ast, sketchRange)
    const extrudeSnippet = `extrude(length = 5 + 7)`
    const extrudeRange = topLevelRange(
      code.indexOf(extrudeSnippet),
      code.indexOf(extrudeSnippet) + extrudeSnippet.length
    )
    const extrudePathToNode = getNodePathFromSourceRange(ast, extrudeRange)

    const extruded = sketchOnExtrudedFace(
      ast,
      sketchPathToNode,
      extrudePathToNode,
      addTagForSketchOnFace,
      { type: 'cap', subType: 'end' }
    )
    if (err(extruded)) throw extruded
    const { modifiedAst } = extruded

    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`part001 = startSketchOn(-XZ)
  |> startProfile(at = [3.58, 2.06])
  |> line(end = [9.7, 9.19])
  |> line(end = [8.62, -9.57])
  |> close()
  |> extrude(length = 5 + 7)
sketch001 = startSketchOn(part001, face = END)`)
  })
  test('it should ensure that the new sketch is inserted after the extrude', async () => {
    const code = `sketch001 = startSketchOn(-XZ)
    |> startProfile(at = [3.29, 7.86])
    |> line(end = [2.48, 2.44])
    |> line(end = [2.66, 1.17])
    |> line(end = [3.75, 0.46])
    |> line(end = [4.99, -0.46])
    |> line(end = [3.3, -2.12])
    |> line(end = [2.16, -3.33])
    |> line(end = [0.85, -3.08])
    |> line(end = [-0.18, -3.36])
    |> line(end = [-3.86, -2.73])
    |> line(end = [-17.67, 0.85])
    |> close()
    part001 = extrude(sketch001, length = 5 + 7)`
    const ast = assertParse(code)
    const segmentSnippet = `line(end = [4.99, -0.46])`
    const segmentRange = topLevelRange(
      code.indexOf(segmentSnippet),
      code.indexOf(segmentSnippet) + segmentSnippet.length
    )
    const segmentPathToNode = getNodePathFromSourceRange(ast, segmentRange)
    const extrudeSnippet = `extrude(sketch001, length = 5 + 7)`
    const extrudeRange = topLevelRange(
      code.indexOf(extrudeSnippet),
      code.indexOf(extrudeSnippet) + extrudeSnippet.length
    )
    const extrudePathToNode = getNodePathFromSourceRange(ast, extrudeRange)

    const updatedAst = sketchOnExtrudedFace(
      ast,
      segmentPathToNode,
      extrudePathToNode,
      addTagForSketchOnFace
    )
    if (err(updatedAst)) throw updatedAst
    const newCode = recast(updatedAst.modifiedAst)
    expect(newCode).toContain(`part001 = extrude(sketch001, length = 5 + 7)
sketch002 = startSketchOn(part001, face = seg01)`)
  })
})

describe('Testing deleteSegmentFromPipeExpression', () => {
  it('Should delete a segment withOUT any dependent segments', async () => {
    const code = `part001 = startSketchOn(-XZ)
  |> startProfile(at = [54.78, -95.91])
  |> line(end = [306.21, 198.82])
  |> line(end = [306.21, 198.85], tag = $a)
  |> line(end = [306.21, 198.87])`
    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast)
    const lineOfInterest = 'line(end = [306.21, 198.85], tag = $a)'
    const range = topLevelRange(
      code.indexOf(lineOfInterest),
      code.indexOf(lineOfInterest) + lineOfInterest.length
    )
    const pathToNode = getNodePathFromSourceRange(ast, range)
    const modifiedAst = deleteSegmentFromPipeExpression(
      [],
      ast,
      execState.variables,
      code,
      pathToNode,
      getConstraintInfoKw
    )
    if (err(modifiedAst)) throw modifiedAst
    const newCode = recast(modifiedAst)
    expect(newCode).toBe(`part001 = startSketchOn(-XZ)
  |> startProfile(at = [54.78, -95.91])
  |> line(end = [306.21, 198.82])
  |> line(end = [306.21, 198.87])
`)
  })
  describe('Should delete a segment WITH any dependent segments, unconstraining the dependent parts', () => {
    const makeCode = (
      line: string,
      replace1 = '',
      replace2 = ''
    ) => `part001 = startSketchOn(-XZ)
  |> startProfile(at = [54.78, -95.91])
  |> line(end = [306.21, 198.82], tag = $b)
${!replace1 ? `  |> ${line}\n` : ''}  |> angledLine(angle = -65deg, length = ${
      !replace1 ? 'segLen(a)' : replace1
    })
  |> line(end = [306.21, 198.87])
  |> angledLine(angle = ${!replace2 ? 'segAng(a)' : replace2}, length = 300)
  |> line(end = [-963.39, -154.67])
`
    test.each([
      ['line', 'line(end = [306.21, 198.85], tag = $a)', ['365.11', '33deg']],
      [
        'lineTo',
        'line(endAbsolute = [306.21, 198.85], tag = $a)',
        ['110.48', '120deg'],
      ],
      ['yLine', 'yLine(length = 198.85, tag = $a)', ['198.85', '90deg']],
      ['xLine', 'xLine(length = 198.85, tag = $a)', ['198.85', '0deg']],
      ['yLineTo', 'yLine(endAbsolute = 198.85, tag = $a)', ['95.94', '90deg']],
      [
        'xLineTo',
        'xLine(endAbsolute = 198.85, tag = $a)',
        ['162.14', '180deg'],
      ],
      [
        'angledLine',
        'angledLine(angle = 45.5deg, length = 198.85, tag = $a)',
        ['198.85', '46deg'],
      ],
      [
        'angledLine',
        'angledLine(angle = 45.5deg, lengthX = 198.85, tag = $a)',
        ['283.7', '46deg'],
      ],
      [
        'angledLine',
        'angledLine(angle = 45.5deg, lengthY = 198.85, tag = $a)',
        ['278.79', '46deg'],
      ],
      [
        'angledLine',
        'angledLine(angle = 45.5deg, endAbsoluteX = 198.85, tag = $a)',
        ['231.33', '-134deg'],
      ],
      [
        'angledLine',
        'angledLine(angle = 45.5deg, endAbsoluteY = 198.85, tag = $a)',
        ['134.51', '46deg'],
      ],
      [
        'angledLineThatIntersects',
        `angledLineThatIntersects(angle = 45.5deg, intersectTag = b, offset = 198.85, tag = $a)`,
        ['918.4', '46deg'],
      ],
    ])(`%s`, async (_, line, [replace1, replace2]) => {
      const code = makeCode(line)
      const ast = assertParse(code)
      const execState = await enginelessExecutor(ast)
      const lineOfInterest = line
      const start = code.indexOf(lineOfInterest)
      expect(start).toBeGreaterThanOrEqual(0)
      const range = topLevelRange(start, start + lineOfInterest.length)
      const pathToNode = getNodePathFromSourceRange(ast, range)
      const dependentSegments = findUsesOfTagInPipe(ast, pathToNode)
      const modifiedAst = deleteSegmentFromPipeExpression(
        dependentSegments,
        ast,
        execState.variables,
        code,
        pathToNode,
        getConstraintInfoKw
      )
      if (err(modifiedAst)) throw modifiedAst
      const newCode = recast(modifiedAst)
      const expected = makeCode(line, replace1, replace2)
      expect(newCode).toBe(expected)
    })
  })
})

describe('Testing deleteFromSelection', () => {
  const cases = [
    [
      'basicCase',
      {
        codeBefore: `myVar = 5
sketch003 = startSketchOn(XZ)
  |> startProfile(at = [3.82, 13.6])
  |> line(end = [-2.94, 2.7])
  |> line(end = [7.7, 0.16])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`,
        codeAfter: `myVar = 5\n`,
        lineOfInterest: 'line(end = [-2.94, 2.7])',
        type: 'segment',
      },
    ],
    // TODO FIXME, similar to fix me in e2e/playwright/testing-selections.spec.ts
    // also related to deleting, deleting in general probably is due for a refactor
    //     [
    //       'delete extrude',
    //       {
    //         codeBefore: `sketch001 = startSketchOn(XZ)
    //   |> startProfile(at = [3.29, 7.86])
    //   |> line(end = [2.48, 2.44])
    //   |> line(end = [2.66, 1.17])
    //   |> line(end = [3.75, 0.46])
    //   |> line(end = [4.99, -0.46], tag = $seg01)
    //   |> line(end = [-3.86, -2.73])
    //   |> line(end = [-17.67, 0.85])
    //   |> close()
    // extrude001 = extrude(sketch001, length = 10)`,
    //         codeAfter: `sketch001 = startSketchOn(XZ)
    //   |> startProfile(at = [3.29, 7.86])
    //   |> line(end = [2.48, 2.44])
    //   |> line(end = [2.66, 1.17])
    //   |> line(end = [3.75, 0.46])
    //   |> line(end = [4.99, -0.46], tag = $seg01)
    //   |> line(end = [-3.86, -2.73])
    //   |> line(end = [-17.67, 0.85])
    //   |> close()\n`,
    //         lineOfInterest: 'line(end = [2.66, 1.17])',
    //         type: 'wall',
    //       },
    //     ],
    //     [
    //       'delete extrude with sketch on it',
    //       {
    //         codeBefore: `myVar = 5
    // sketch001 = startSketchOn(XZ)
    //   |> startProfile(at = [4.46, 5.12], tag = $tag)
    //   |> line(end = [0.08, myVar])
    //   |> line(end = [13.03, 2.02], tag = $seg01)
    //   |> line(end = [3.9, -7.6])
    //   |> line(end = [-11.18, -2.15])
    //   |> line(end = [5.41, -9.61])
    //   |> line(end = [-8.54, -2.51])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // extrude001 = extrude(sketch001, length = 5)
    // sketch002 = startSketchOn(extrude001, face = seg01)
    //   |> startProfile(at = [-12.55, 2.89])
    //   |> line(end = [3.02, 1.9])
    //   |> line(end = [1.82, -1.49], tag = $seg02)
    //   |> angledLine(angle = -86deg, length = segLen(seg02))
    //   |> line(end = [-3.97, -0.53])
    //   |> line(end = [0.3, 0.84])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()`,
    //         codeAfter: `myVar = 5
    // sketch001 = startSketchOn(XZ)
    //   |> startProfile(at = [4.46, 5.12], tag = $tag)
    //   |> line(end = [0.08, myVar])
    //   |> line(end = [13.03, 2.02], tag = $seg01)
    //   |> line(end = [3.9, -7.6])
    //   |> line(end = [-11.18, -2.15])
    //   |> line(end = [5.41, -9.61])
    //   |> line(end = [-8.54, -2.51])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // sketch002 = startSketchOn({
    //          origin = { x = 1, y = 2, z = 3 },
    //          xAxis = { x = 4, y = 5, z = 6 },
    //          yAxis = { x = 7, y = 8, z = 9 },
    //          zAxis = { x = 10, y = 11, z = 12 }
    //      })
    //   |> startProfile(at = [-12.55, 2.89])
    //   |> line(end = [3.02, 1.9])
    //   |> line(end = [1.82, -1.49], tag = $seg02)
    //   |> angledLine(angle = -86deg, length = segLen(seg02))
    //   |> line(end = [-3.97, -0.53])
    //   |> line(end = [0.3, 0.84])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // `,
    //         lineOfInterest: 'line(end = [-11.18, -2.15])',
    //         type: 'wall',
    //       },
    //     ],
    //     [
    //       'delete extrude with sketch on it 2',
    //       {
    //         codeBefore: `myVar = 5
    // sketch001 = startSketchOn(XZ)
    //   |> startProfile(at = [4.46, 5.12], tag = $tag)
    //   |> line(end = [0.08, myVar])
    //   |> line(end = [13.03, 2.02], tag = $seg01)
    //   |> line(end = [3.9, -7.6])
    //   |> line(end = [-11.18, -2.15])
    //   |> line(end = [5.41, -9.61])
    //   |> line(end = [-8.54, -2.51])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // extrude001 = extrude(sketch001, length = 5)
    // sketch002 = startSketchOn(extrude001, face = seg01)
    //   |> startProfile(at = [-12.55, 2.89])
    //   |> line(end = [3.02, 1.9])
    //   |> line(end = [1.82, -1.49], tag = $seg02)
    //   |> angledLine(angle = -86deg, length = segLen(seg02))
    //   |> line(end = [-3.97, -0.53])
    //   |> line(end = [0.3, 0.84])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()`,
    //         codeAfter: `myVar = 5
    // sketch001 = startSketchOn(XZ)
    //   |> startProfile(at = [4.46, 5.12], tag = $tag)
    //   |> line(end = [0.08, myVar])
    //   |> line(end = [13.03, 2.02], tag = $seg01)
    //   |> line(end = [3.9, -7.6])
    //   |> line(end = [-11.18, -2.15])
    //   |> line(end = [5.41, -9.61])
    //   |> line(end = [-8.54, -2.51])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // sketch002 = startSketchOn({
    //          origin = { x = 1, y = 2, z = 3 },
    //          xAxis = { x = 4, y = 5, z = 6 },
    //          yAxis = { x = 7, y = 8, z = 9 },
    //          zAxis = { x = 10, y = 11, z = 12 }
    //      })
    //   |> startProfile(at = [-12.55, 2.89])
    //   |> line(end = [3.02, 1.9])
    //   |> line(end = [1.82, -1.49], tag = $seg02)
    //   |> angledLine(angle = -86deg, length = segLen(seg02))
    //   |> line(end = [-3.97, -0.53])
    //   |> line(end = [0.3, 0.84])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // `,
    //         lineOfInterest: 'startProfile(at = [4.46, 5.12], tag = $tag)',
    //         type: 'cap',
    //       },
    //     ],
  ] as const
  test.each(cases)(
    '%s',
    async (_name, { codeBefore, codeAfter, lineOfInterest, type }) => {
      // const lineOfInterest = 'line(end = [-2.94, 2.7])'
      const ast = assertParse(codeBefore)
      const execState = await enginelessExecutor(ast)

      // deleteFromSelection
      const range = topLevelRange(
        codeBefore.indexOf(lineOfInterest),
        codeBefore.indexOf(lineOfInterest) + lineOfInterest.length
      )
      const artifact = { type } as Artifact
      const newAst = await deleteFromSelection(
        ast,
        {
          codeRef: codeRefFromRange(range, ast),
          artifact,
        },
        execState.variables,
        execState.artifactGraph,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return {
            origin: { x: 1, y: 2, z: 3 },
            x_axis: { x: 4, y: 5, z: 6 },
            y_axis: { x: 7, y: 8, z: 9 },
            z_axis: { x: 10, y: 11, z: 12 },
          }
        }
      )
      if (err(newAst)) throw newAst
      const newCode = recast(newAst)
      expect(newCode).toBe(codeAfter)
    }
  )
})

describe('Testing splitPipedProfile', () => {
  it('should split the pipe expression correctly', () => {
    const codeBefore = `// comment 1
    part001 = startSketchOn(XZ)
  |> startProfile(at = [1, 2])
  // comment 2
  |> line(end = [3, 4])
  |> line(end = [5, 6])
  |> close(%)
// comment 3
extrude001 = extrude(part001, length = 5)
    `

    const expectedCodeAfter = `// comment 1
sketch001 = startSketchOn(XZ)
part001 = startProfile(sketch001, at = [1, 2])
  // comment 2
  |> line(end = [3, 4])
  |> line(end = [5, 6])
  |> close(%)
// comment 3
extrude001 = extrude(part001, length = 5)
    `

    const ast = assertParse(codeBefore)

    const codeOfInterest = `startSketchOn(XZ)`
    const range: [number, number, number] = [
      codeBefore.indexOf(codeOfInterest),
      codeBefore.indexOf(codeOfInterest) + codeOfInterest.length,
      0,
    ]
    const pathToPipe = getNodePathFromSourceRange(ast, range)

    const result = splitPipedProfile(ast, pathToPipe)

    if (err(result)) throw result

    const newCode = recast(result.modifiedAst)
    if (err(newCode)) throw newCode
    expect(newCode.trim()).toBe(expectedCodeAfter.trim())
  })
  it('should return error for already split pipe', () => {
    const codeBefore = `sketch001 = startSketchOn(XZ)
part001 = startProfile(sketch001, at = [1, 2])
  |> line(end = [3, 4])
  |> line(end = [5, 6])
  |> close(%)
extrude001 = extrude(part001, length = 5)
    `

    const ast = assertParse(codeBefore)

    const codeOfInterest = `startProfile(sketch001, at = [1, 2])`
    const range: [number, number, number] = [
      codeBefore.indexOf(codeOfInterest),
      codeBefore.indexOf(codeOfInterest) + codeOfInterest.length,
      0,
    ]
    const pathToPipe = getNodePathFromSourceRange(ast, range)

    const result = splitPipedProfile(ast, pathToPipe)
    expect(result instanceof Error).toBe(true)
  })
})

describe('Testing createVariableExpressionsArray', () => {
  it('should return null for any number of pipe substitutions', () => {
    const onePipe = [createPipeSubstitution()]
    const twoPipes = [createPipeSubstitution(), createPipeSubstitution()]
    const threePipes = [
      createPipeSubstitution(),
      createPipeSubstitution(),
      createPipeSubstitution(),
    ]
    expect(createVariableExpressionsArray(onePipe)).toBeNull()
    expect(createVariableExpressionsArray(twoPipes)).toBeNull()
    expect(createVariableExpressionsArray(threePipes)).toBeNull()
  })

  it('should create a variable expressions for one variable', () => {
    const oneVariableName = [createLocalName('var1')]
    const expr = createVariableExpressionsArray(oneVariableName)
    if (expr?.type !== 'Name') {
      throw new Error(`Expected Literal type, got ${expr?.type}`)
    }

    expect(expr.name.name).toBe('var1')
  })

  it('should create an array of variable expressions for two variables', () => {
    const twoVariableNames = [createLocalName('var1'), createLocalName('var2')]
    const exprs = createVariableExpressionsArray(twoVariableNames)
    if (exprs?.type !== 'ArrayExpression') {
      throw new Error('Expected ArrayExpression type')
    }

    expect(exprs.elements).toHaveLength(2)
    if (
      exprs.elements[0].type !== 'Name' ||
      exprs.elements[1].type !== 'Name'
    ) {
      throw new Error(
        `Expected elements to be of type Name, got ${exprs.elements[0].type} and ${exprs.elements[1].type}`
      )
    }
    expect(exprs.elements[0].name.name).toBe('var1')
    expect(exprs.elements[1].name.name).toBe('var2')
  })

  // This would catch the issue at https://github.com/KittyCAD/modeling-app/issues/7669
  // TODO: add uniqueness check to function to get this test to pass and bring boolean ops up to speed
  // it('should create one expr if the array of variable names are the same', () => {
  //   const twoVariableNames = [createLocalName('var1'), createLocalName('var1')]
  //   const expr = createVariableExpressionsArray(twoVariableNames)
  //   if (expr?.type !== 'Name') {
  //     throw new Error(`Expected Literal type, got ${expr?.type}`)
  //   }

  //   expect(expr.name.name).toBe('var1')
  // })

  it('should create an array of variable expressions for one variable and a pipe', () => {
    const oneVarOnePipe = [createPipeSubstitution(), createLocalName('var1')]
    const exprs = createVariableExpressionsArray(oneVarOnePipe)
    if (exprs?.type !== 'ArrayExpression') {
      throw new Error('Expected ArrayExpression type')
    }

    expect(exprs.elements).toHaveLength(2)
    expect(exprs.elements[0].type).toBe('PipeSubstitution')
    if (exprs.elements[1].type !== 'Name') {
      throw new Error(
        `Expected elements[1] to be of type Name, got ${exprs.elements[1].type}`
      )
    }

    expect(exprs.elements[1].name.name).toBe('var1')
  })
})

describe('Testing createPathToNodeForLastVariable', () => {
  it('should create a path to the last variable in the array', () => {
    const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 5)
`
    const ast = assertParse(circleProfileInVar)
    const path = createPathToNodeForLastVariable(ast, false)
    expect(path.length).toEqual(4)

    // Verify we can get the right node
    const node = getNodeFromPath<any>(ast, path)
    if (err(node)) {
      throw node
    }
    // With the expected range
    const startOfExtrudeIndex = circleProfileInVar.indexOf('extrude(')
    expect(node.node.start).toEqual(startOfExtrudeIndex)
    expect(node.node.end).toEqual(circleProfileInVar.length - 1)
  })

  it('should create a path to the first kwarg in the last expression', () => {
    const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 123)
`
    const ast = assertParse(circleProfileInVar)
    const path = createPathToNodeForLastVariable(ast, true)
    expect(path.length).toEqual(7)

    // Verify we can get the right node
    const node = getNodeFromPath<any>(ast, path)
    if (err(node)) {
      throw node
    }
    // With the expected range
    const startOfKwargIndex = circleProfileInVar.indexOf('123')
    expect(node.node.start).toEqual(startOfKwargIndex)
    expect(node.node.end).toEqual(startOfKwargIndex + 3)
  })
})

describe('Testing setCallInAst', () => {
  it('should push an extrude call with variable on variable profile', () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
`
    const ast = assertParse(code)
    const exprs = createVariableExpressionsArray([
      createLocalName('profile001'),
    ])
    const call = createCallExpressionStdLibKw('extrude', exprs, [
      createLabeledArg('length', createLiteral(5)),
    ])
    const pathToNode = setCallInAst({ ast, call, variableIfNewDecl: 'extrude' })
    if (err(pathToNode)) {
      throw pathToNode
    }
    const newCode = recast(ast)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`extrude001 = extrude(profile001, length = 5)`)
  })

  it('should push an extrude call in pipe is selection was in variable-less pipe', async () => {
    const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
`
    const ast = assertParse(code)
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
    const exprs = createVariableExpressionsArray(vars.exprs)
    const call = createCallExpressionStdLibKw('extrude', exprs, [
      createLabeledArg('length', createLiteral(5)),
    ])
    const pathToNode = setCallInAst({
      ast,
      call,
      pathIfNewPipe: vars.pathIfPipe,
    })
    if (err(pathToNode)) {
      throw pathToNode
    }
    const newCode = recast(ast)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`|> extrude(length = 5)`)
  })

  it('should push an extrude call with variable if selection was in variable pipe', async () => {
    const code = `profile001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
`
    const ast = assertParse(code)
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
    const exprs = createVariableExpressionsArray(vars.exprs)
    const call = createCallExpressionStdLibKw('extrude', exprs, [
      createLabeledArg('length', createLiteral(5)),
    ])
    const pathToNode = setCallInAst({
      ast,
      call,
      pathIfNewPipe: vars.pathIfPipe,
      variableIfNewDecl: 'extrude',
    })
    if (err(pathToNode)) {
      throw pathToNode
    }
    const newCode = recast(ast)
    expect(newCode).toContain(code)
    expect(newCode).toContain(`extrude001 = extrude(profile001, length = 5)`)
  })
})
