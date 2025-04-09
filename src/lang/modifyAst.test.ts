import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createArrayExpression,
  createCallExpression,
  createIdentifier,
  createLiteral,
  createObjectExpression,
  createPipeExpression,
  createPipeSubstitution,
  createVariableDeclaration,
  findUniqueName,
  giveSketchFnCallTag,
} from '@src/lang/create'
import {
  addSketchTo,
  deleteFromSelection,
  deleteSegmentFromPipeExpression,
  moveValueIntoNewVariable,
  removeSingleConstraintInfo,
  sketchOnExtrudedFace,
  splitPipedProfile,
} from '@src/lang/modifyAst'
import { findUsesOfTagInPipe } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import type { Artifact } from '@src/lang/std/artifactGraph'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import type { InputArgKeys, SimplifiedArgDetails } from '@src/lang/std/stdTypes'
import { topLevelRange } from '@src/lang/util'
import type { Identifier, Literal, LiteralValue } from '@src/lang/wasm'
import { assertParse, initPromise, recast } from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'

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
    const lit: LiteralValue = { value: 5, suffix: 'Mm' }
    const result = createLiteral(lit)
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
describe('Testing createCallExpression', () => {
  it('should create a call expression', () => {
    const result = createCallExpression('myFunc', [createLiteral(5)])
    expect(result.type).toBe('CallExpression')
    expect(result.callee.type).toBe('Name')
    expect(result.callee.name.name).toBe('myFunc')
    expect(result.arguments[0].type).toBe('Literal')
    expect((result.arguments[0] as any).value.value).toBe(5)
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
  |> startProfileAt('default', %)
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
|> startProfileAt([0, 0], %)
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
  const fn = (fnName: string) => `fn ${fnName} = (x) => {
  return x
}
`
  const code = `${fn('def')}${fn('jkl')}${fn('hmm')}
fn ghi = (x) => {
    return 2
}
const abc = 3
const identifierGuy = 5
yo = 5 + 6
part001 = startSketchOn(XY)
|> startProfileAt([-1.2, 4.83], %)
|> line(end = [2.8, 0])
|> angledLine(angle = 100 + 100, length = 3.09)
|> angledLine(angle = abc, length = 3.09)
|> angledLine(angle = def(yo), length = 3.09)
|> angledLine(angle = ghi(%), length = 3.09)
|> angledLine(angle = jkl(yo) + 2, length = 3.09)
yo2 = hmm([identifierGuy + 5])`
  it('should move a binary expression into a new variable', async () => {
    const ast = assertParse(code)
    const execState = await enginelessExecutor(ast)
    const startIndex = code.indexOf('100 + 100') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      execState.variables,
      topLevelRange(startIndex, startIndex),
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`newVar = 100 + 100`)
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
    expect(newCode).toContain(`newVar = jkl(yo) + 2`)
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
  |> startProfileAt([3.58, 2.06], %)
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
      extrudePathToNode
    )
    if (err(extruded)) throw extruded
    const { modifiedAst } = extruded

    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`part001 = startSketchOn(-XZ)
  |> startProfileAt([3.58, 2.06], %)
  |> line(end = [9.7, 9.19], tag = $seg01)
  |> line(end = [8.62, -9.57])
  |> close()
  |> extrude(length = 5 + 7)
sketch001 = startSketchOn(part001, seg01)`)
  })
  test('it should be able to extrude on close segments', async () => {
    const code = `part001 = startSketchOn(-XZ)
  |> startProfileAt([3.58, 2.06], %)
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
      extrudePathToNode
    )
    if (err(extruded)) throw extruded
    const { modifiedAst } = extruded

    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`part001 = startSketchOn(-XZ)
  |> startProfileAt([3.58, 2.06], %)
  |> line(end = [9.7, 9.19])
  |> line(end = [8.62, -9.57])
  |> close(tag = $seg01)
  |> extrude(length = 5 + 7)
sketch001 = startSketchOn(part001, seg01)`)
  })
  test('it should be able to extrude on start-end caps', async () => {
    const code = `part001 = startSketchOn(-XZ)
  |> startProfileAt([3.58, 2.06], %)
  |> line(end = [9.7, 9.19])
  |> line(end = [8.62, -9.57])
  |> close()
  |> extrude(length = 5 + 7)`
    const ast = assertParse(code)
    const sketchSnippet = `startProfileAt([3.58, 2.06], %)`
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
      { type: 'cap', subType: 'end' }
    )
    if (err(extruded)) throw extruded
    const { modifiedAst } = extruded

    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`part001 = startSketchOn(-XZ)
  |> startProfileAt([3.58, 2.06], %)
  |> line(end = [9.7, 9.19])
  |> line(end = [8.62, -9.57])
  |> close()
  |> extrude(length = 5 + 7)
sketch001 = startSketchOn(part001, 'END')`)
  })
  test('it should ensure that the new sketch is inserted after the extrude', async () => {
    const code = `sketch001 = startSketchOn(-XZ)
    |> startProfileAt([3.29, 7.86], %)
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
      extrudePathToNode
    )
    if (err(updatedAst)) throw updatedAst
    const newCode = recast(updatedAst.modifiedAst)
    expect(newCode).toContain(`part001 = extrude(sketch001, length = 5 + 7)
sketch002 = startSketchOn(part001, seg01)`)
  })
})

describe('Testing deleteSegmentFromPipeExpression', () => {
  it('Should delete a segment withOUT any dependent segments', async () => {
    const code = `part001 = startSketchOn(-XZ)
  |> startProfileAt([54.78, -95.91], %)
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
      pathToNode
    )
    if (err(modifiedAst)) throw modifiedAst
    const newCode = recast(modifiedAst)
    expect(newCode).toBe(`part001 = startSketchOn(-XZ)
  |> startProfileAt([54.78, -95.91], %)
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
  |> startProfileAt([54.78, -95.91], %)
  |> line(end = [306.21, 198.82], tag = $b)
${!replace1 ? `  |> ${line}\n` : ''}  |> angledLine(angle = -65, length = ${
      !replace1 ? 'segLen(a)' : replace1
    })
  |> line(end = [306.21, 198.87])
  |> angledLine(angle = 65, length = ${!replace2 ? 'segAng(a)' : replace2})
  |> line(end = [-963.39, -154.67])
`
    test.each([
      ['line', 'line(end = [306.21, 198.85], tag = $a)', ['365.11', '33']],
      [
        'lineTo',
        'line(endAbsolute = [306.21, 198.85], tag = $a)',
        ['110.48', '119.73'],
      ],
      ['yLine', 'yLine(length = 198.85, tag = $a)', ['198.85', '90']],
      ['xLine', 'xLine(length = 198.85, tag = $a)', ['198.85', '0']],
      ['yLineTo', 'yLine(endAbsolute = 198.85, tag = $a)', ['95.94', '90']],
      ['xLineTo', 'xLine(endAbsolute = 198.85, tag = $a)', ['162.14', '180']],
      [
        'angledLine',
        'angledLine(angle = 45.5, length = 198.85, tag = $a)',
        ['198.85', '45.5'],
      ],
      [
        'angledLine',
        'angledLine(angle = 45.5, lengthX = 198.85, tag = $a)',
        ['283.7', '45.5'],
      ],
      [
        'angledLine',
        'angledLine(angle = 45.5, lengthY = 198.85, tag = $a)',
        ['278.79', '45.5'],
      ],
      [
        'angledLine',
        'angledLine(angle = 45.5, endAbsoluteX = 198.85, tag = $a)',
        ['231.33', '134.5'],
      ],
      [
        'angledLine',
        'angledLine(angle = 45.5, endAbsoluteY = 198.85, tag = $a)',
        ['134.51', '45.5'],
      ],
      [
        'angledLineThatIntersects',
        `angledLineThatIntersects({ angle = 45.5, intersectTag = b, offset = 198.85 }, %, $a)`,
        ['918.4', '45.5'],
      ],
    ])(`%s`, async (_, line, [replace1, replace2]) => {
      const code = makeCode(line)
      const ast = assertParse(code)
      const execState = await enginelessExecutor(ast)
      const lineOfInterest = line
      const start = code.indexOf(lineOfInterest)
      const range = topLevelRange(start, start + lineOfInterest.length)
      const pathToNode = getNodePathFromSourceRange(ast, range)
      const dependentSegments = findUsesOfTagInPipe(ast, pathToNode)
      const modifiedAst = deleteSegmentFromPipeExpression(
        dependentSegments,
        ast,
        execState.variables,
        code,
        pathToNode
      )
      if (err(modifiedAst)) throw modifiedAst
      const newCode = recast(modifiedAst)
      const expected = makeCode(line, replace1, replace2)
      // .replace('/*a*/ ', '')
      // .replace('/*b*/ ', '')
      expect(newCode).toBe(expected)
    })
  })
})

describe('Testing removeSingleConstraintInfo', () => {
  describe('with mostly object notation', () => {
    const code = `part001 = startSketchOn(-XZ)
  |> startProfileAt([0, 0], %)
  |> line(end = [3 + 0, 4 + 0])
  |> /*0*/ angledLine(angle = 3 + 0, length = 3.14 + 0)
  |> line(endAbsolute = [6.14 + 0, 3.14 + 0])
  |> xLine(/*xAbs*/ endAbsolute = 8 + 0)
  |> yLine(/*yAbs*/ endAbsolute = 5 + 0)
  |> yLine(/*yRel*/ length = 3.14 + 0, tag = $a)
  |> xLine(/*xRel*/ length = 3.14 + 0)
  |> /*1*/ angledLine(angle = 3 + 0, lengthX = 3.14 + 0)
  |> /*2*/ angledLine(angle = 30 + 0, lengthY = 3 + 0)
  |> /*3*/ angledLine(angle = 12.14 + 0, endAbsoluteX =  12 + 0)
  |> /*4*/ angledLine(angle = 30 + 0, endAbsoluteY =  10.14 + 0)
  |> angledLineThatIntersects({
        angle = 3.14 + 0,
        intersectTag = a,
        offset = 0 + 0
      }, %)
  |> tangentialArcTo([3.14 + 0, 13.14 + 0], %)`
    test.each([
      [' line(end = [3 + 0, 4])', 'arrayIndex', 1, ''],
      [
        '/*0*/ angledLine(angle = 3, length = 3.14 + 0)',
        'labeledArg',
        'angle',
        '',
      ],
      ['line(endAbsolute = [6.14 + 0, 3.14 + 0])', 'arrayIndex', 0, ''],
      ['xLine(endAbsolute = 8)', '', '', '/*xAbs*/'],
      ['yLine(endAbsolute = 5)', '', '', '/*yAbs*/'],
      ['yLine(length = 3.14, tag = $a)', '', '', '/*yRel*/'],
      ['xLine(length = 3.14)', '', '', '/*xRel*/'],
      [
        '/*1*/ angledLine(angle = 3, lengthX = 3.14 + 0)',
        'labeledArg',
        'angle',
        '',
      ],
      [
        '/*2*/ angledLine(angle = 30 + 0, lengthY = 3)',
        'labeledArg',
        'length',
        '',
      ],
      [
        '/*3*/ angledLine(angle = 12.14 + 0, endAbsoluteX = 12)',
        'labeledArg',
        'endAbsoluteX',
        '',
      ],
      [
        '/*4*/ angledLine(angle = 30, endAbsoluteY = 10.14 + 0)',
        'labeledArg',
        'angle',
        '',
      ],
      [
        `angledLineThatIntersects({
       angle = 3.14 + 0,
       offset = 0,
       intersectTag = a
     }, %)`,
        'objectProperty',
        'offset',
        '',
      ],
      ['tangentialArcTo([3.14 + 0, 13.14], %)', 'arrayIndex', 1, ''],
    ] as const)(
      'stdlib fn: %s',
      async (expectedFinish, key, value, commentLabel) => {
        const ast = assertParse(code)

        const execState = await enginelessExecutor(ast)
        const lineOfInterest =
          commentLabel.length > 0
            ? expectedFinish.split(commentLabel)[0]
            : expectedFinish.split('(')[0] + '('
        const start = code.indexOf(lineOfInterest)
        const range = topLevelRange(start + 1, start + lineOfInterest.length)
        const pathToNode = getNodePathFromSourceRange(ast, range)
        let argPosition: SimplifiedArgDetails
        if (key === 'arrayIndex' && typeof value === 'number') {
          argPosition = {
            type: 'arrayItem',
            index: value === 0 ? 0 : 1,
          }
        } else if (key === 'objectProperty' && typeof value === 'string') {
          argPosition = {
            type: 'objectProperty',
            key: value,
          }
        } else if (key === '') {
          argPosition = {
            type: 'singleValue',
          }
        } else if (key === 'labeledArg') {
          argPosition = {
            type: 'labeledArg',
            key: value,
          }
        } else {
          throw new Error('argPosition is undefined')
        }
        const mod = removeSingleConstraintInfo(
          pathToNode,
          argPosition,
          ast,
          execState.variables
        )
        if (!mod) return new Error('mod is undefined')
        const recastCode = recast(mod.modifiedAst)
        expect(recastCode).toContain(expectedFinish)
      }
    )
  })
  describe('with array notation', () => {
    const code = `part001 = startSketchOn(-XZ)
  |> startProfileAt([0, 0], %)
  |> /*0*/ angledLine(angle = 3.14 + 0, length = 3.14 + 0)
  |> /*1*/ angledLine(angle = 3 + 0, lengthX = 3.14 + 0)
  |> /*2*/ angledLine(angle = 30 + 0, lengthY = 3 + 0)
  |> /*3*/ angledLine(angle = 12.14 + 0, endAbsoluteX = 12 + 0)
  |> /*4*/ angledLine(angle = 30 + 0, endAbsoluteY = 10.14 + 0)`
    const ang: InputArgKeys = 'angle'
    test.each([
      ['/*0*/ angledLine(angle = 3, length = 3.14 + 0)', 'labeledArg', ang],
      [
        '/*1*/ angledLine(angle = 3, lengthX = 3.14 + 0)',
        'labeledArg',
        'angle',
      ],
      [
        '/*2*/ angledLine(angle = 30 + 0, lengthY = 3)',
        'labeledArg',
        'lengthY',
      ],
      [
        '/*3*/ angledLine(angle = 12.14 + 0, endAbsoluteX = 12)',
        'labeledArg',
        'endAbsoluteX',
      ],
      [
        '/*4*/ angledLine(angle = 30, endAbsoluteY = 10.14 + 0)',
        'labeledArg',
        'angle',
      ],
    ])('stdlib fn: %s', async (expectedFinish, key, value) => {
      const ast = assertParse(code)

      const execState = await enginelessExecutor(ast)
      const lineOfInterest = expectedFinish.split('(')[0] + '('
      const start = code.indexOf(lineOfInterest)
      expect(start).toBeGreaterThanOrEqual(0)
      const range = topLevelRange(start + 1, start + lineOfInterest.length)
      let argPosition: SimplifiedArgDetails
      if (key === 'arrayIndex' && typeof value === 'number') {
        argPosition = {
          type: 'arrayItem',
          index: value === 0 ? 0 : 1,
        }
        // } else if (key === 'objectProperty' && typeof value === 'string') {
        //   argPosition = {
        //     type: 'objectProperty',
        //     key: value,
        //   }
      } else if (key === 'labeledArg') {
        argPosition = {
          type: 'labeledArg',
          key: value as InputArgKeys,
        }
      } else {
        throw new Error('argPosition is undefined')
      }
      const pathToNode = getNodePathFromSourceRange(ast, range)
      const mod = removeSingleConstraintInfo(
        pathToNode,
        argPosition,
        ast,
        execState.variables
      )
      if (!mod) return new Error('mod is undefined')
      const recastCode = recast(mod.modifiedAst)
      expect(recastCode).toContain(expectedFinish)
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
  |> startProfileAt([3.82, 13.6], %)
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
    //   |> startProfileAt([3.29, 7.86], %)
    //   |> line(end = [2.48, 2.44])
    //   |> line(end = [2.66, 1.17])
    //   |> line(end = [3.75, 0.46])
    //   |> line(end = [4.99, -0.46], tag = $seg01)
    //   |> line(end = [-3.86, -2.73])
    //   |> line(end = [-17.67, 0.85])
    //   |> close()
    // const extrude001 = extrude(sketch001, length = 10)`,
    //         codeAfter: `sketch001 = startSketchOn(XZ)
    //   |> startProfileAt([3.29, 7.86], %)
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
    //   |> startProfileAt([4.46, 5.12], %, $tag)
    //   |> line(end = [0.08, myVar])
    //   |> line(end = [13.03, 2.02], tag = $seg01)
    //   |> line(end = [3.9, -7.6])
    //   |> line(end = [-11.18, -2.15])
    //   |> line(end = [5.41, -9.61])
    //   |> line(end = [-8.54, -2.51])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // const extrude001 = extrude(sketch001, length = 5)
    // sketch002 = startSketchOn(extrude001, seg01)
    //   |> startProfileAt([-12.55, 2.89], %)
    //   |> line(end = [3.02, 1.9])
    //   |> line(end = [1.82, -1.49], tag = $seg02)
    //   |> angledLine(angle = -86, length = segLen(seg02))
    //   |> line(end = [-3.97, -0.53])
    //   |> line(end = [0.3, 0.84])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()`,
    //         codeAfter: `myVar = 5
    // sketch001 = startSketchOn(XZ)
    //   |> startProfileAt([4.46, 5.12], %, $tag)
    //   |> line(end = [0.08, myVar])
    //   |> line(end = [13.03, 2.02], tag = $seg01)
    //   |> line(end = [3.9, -7.6])
    //   |> line(end = [-11.18, -2.15])
    //   |> line(end = [5.41, -9.61])
    //   |> line(end = [-8.54, -2.51])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // sketch002 = startSketchOn({
    //        plane = {
    //          origin = { x = 1, y = 2, z = 3 },
    //          xAxis = { x = 4, y = 5, z = 6 },
    //          yAxis = { x = 7, y = 8, z = 9 },
    //          zAxis = { x = 10, y = 11, z = 12 }
    //        }
    //      })
    //   |> startProfileAt([-12.55, 2.89], %)
    //   |> line(end = [3.02, 1.9])
    //   |> line(end = [1.82, -1.49], tag = $seg02)
    //   |> angledLine(angle = -86, length = segLen(seg02))
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
    //   |> startProfileAt([4.46, 5.12], %, $tag)
    //   |> line(end = [0.08, myVar])
    //   |> line(end = [13.03, 2.02], tag = $seg01)
    //   |> line(end = [3.9, -7.6])
    //   |> line(end = [-11.18, -2.15])
    //   |> line(end = [5.41, -9.61])
    //   |> line(end = [-8.54, -2.51])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // const extrude001 = extrude(sketch001, length = 5)
    // sketch002 = startSketchOn(extrude001, seg01)
    //   |> startProfileAt([-12.55, 2.89], %)
    //   |> line(end = [3.02, 1.9])
    //   |> line(end = [1.82, -1.49], tag = $seg02)
    //   |> angledLine(angle = -86, length = segLen(seg02))
    //   |> line(end = [-3.97, -0.53])
    //   |> line(end = [0.3, 0.84])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()`,
    //         codeAfter: `myVar = 5
    // sketch001 = startSketchOn(XZ)
    //   |> startProfileAt([4.46, 5.12], %, $tag)
    //   |> line(end = [0.08, myVar])
    //   |> line(end = [13.03, 2.02], tag = $seg01)
    //   |> line(end = [3.9, -7.6])
    //   |> line(end = [-11.18, -2.15])
    //   |> line(end = [5.41, -9.61])
    //   |> line(end = [-8.54, -2.51])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // sketch002 = startSketchOn({
    //        plane = {
    //          origin = { x = 1, y = 2, z = 3 },
    //          xAxis = { x = 4, y = 5, z = 6 },
    //          yAxis = { x = 7, y = 8, z = 9 },
    //          zAxis = { x = 10, y = 11, z = 12 }
    //        }
    //      })
    //   |> startProfileAt([-12.55, 2.89], %)
    //   |> line(end = [3.02, 1.9])
    //   |> line(end = [1.82, -1.49], tag = $seg02)
    //   |> angledLine(angle = -86, length = segLen(seg02))
    //   |> line(end = [-3.97, -0.53])
    //   |> line(end = [0.3, 0.84])
    //   |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    //   |> close()
    // `,
    //         lineOfInterest: 'startProfileAt([4.46, 5.12], %, $tag)',
    //         type: 'cap',
    //       },
    //     ],
  ] as const
  test.each(cases)(
    '%s',
    async (name, { codeBefore, codeAfter, lineOfInterest, type }) => {
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
  |> startProfileAt([1, 2], %)
  // comment 2
  |> line([3, 4], %)
  |> line([5, 6], %)
  |> close(%)
// comment 3
extrude001 = extrude(5, part001)
    `

    const expectedCodeAfter = `// comment 1
sketch001 = startSketchOn(XZ)
part001 = startProfileAt([1, 2], sketch001)
  // comment 2
  |> line([3, 4], %)
  |> line([5, 6], %)
  |> close(%)
// comment 3
extrude001 = extrude(5, part001)
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
part001 = startProfileAt([1, 2], sketch001)
  |> line([3, 4], %)
  |> line([5, 6], %)
  |> close(%)
extrude001 = extrude(5, part001)
    `

    const ast = assertParse(codeBefore)

    const codeOfInterest = `startProfileAt([1, 2], sketch001)`
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
