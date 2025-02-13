import {
  assertParse,
  recast,
  initPromise,
  Identifier,
  topLevelRange,
  LiteralValue,
  Literal,
} from './wasm'
import {
  createLiteral,
  createIdentifier,
  createCallExpression,
  createObjectExpression,
  createArrayExpression,
  createPipeSubstitution,
  createVariableDeclaration,
  createPipeExpression,
  findUniqueName,
  addSketchTo,
  giveSketchFnCallTag,
  moveValueIntoNewVariable,
  sketchOnExtrudedFace,
  deleteSegmentFromPipeExpression,
  removeSingleConstraintInfo,
  deleteFromSelection,
  splitPipedProfile,
} from './modifyAst'
import { enginelessExecutor } from '../lib/testHelpers'
import { findUsesOfTagInPipe } from './queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { err } from 'lib/trap'
import { SimplifiedArgDetails } from './std/stdTypes'
import { Node } from 'wasm-lib/kcl/bindings/Node'
import { Artifact, codeRefFromRange } from './std/artifactGraph'

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
    expect(result.callee.type).toBe('Identifier')
    expect(result.callee.name).toBe('myFunc')
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
        },
        {
          type: 'Identifier',
          name: 'yo02',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
        },
        {
          type: 'Identifier',
          name: 'yo03',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
        },
        {
          type: 'Identifier',
          name: 'yo04',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
        },
        {
          type: 'Identifier',
          name: 'yo05',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
        },
        {
          type: 'Identifier',
          name: 'yo06',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
        },
        {
          type: 'Identifier',
          name: 'yo07',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
        },
        {
          type: 'Identifier',
          name: 'yo08',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
        },
        {
          type: 'Identifier',
          name: 'yo09',
          start: 0,
          end: 0,
          moduleId: 0,
          outerAttrs: [],
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
      },
      'yz'
    )
    const str = recast(result.modifiedAst)
    expect(str).toBe(`sketch001 = startSketchOn('YZ')
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
  const code = `part001 = startSketchOn('XY')
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
part001 = startSketchOn('XY')
|> startProfileAt([-1.2, 4.83], %)
|> line(end = [2.8, 0])
|> angledLine([100 + 100, 3.09], %)
|> angledLine([abc, 3.09], %)
|> angledLine([def(yo), 3.09], %)
|> angledLine([ghi(%), 3.09], %)
|> angledLine([jkl(yo) + 2, 3.09], %)
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
    expect(newCode).toContain(`angledLine([newVar, 3.09], %)`)
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
    expect(newCode).toContain(`angledLine([newVar, 3.09], %)`)
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
    expect(newCode).toContain(`angledLine([newVar, 3.09], %)`)
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
    const code = `part001 = startSketchOn('-XZ')
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
    expect(newCode).toContain(`part001 = startSketchOn('-XZ')
  |> startProfileAt([3.58, 2.06], %)
  |> line(end = [9.7, 9.19], tag = $seg01)
  |> line(end = [8.62, -9.57])
  |> close()
  |> extrude(length = 5 + 7)
sketch001 = startSketchOn(part001, seg01)`)
  })
  test('it should be able to extrude on close segments', async () => {
    const code = `part001 = startSketchOn('-XZ')
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
    expect(newCode).toContain(`part001 = startSketchOn('-XZ')
  |> startProfileAt([3.58, 2.06], %)
  |> line(end = [9.7, 9.19])
  |> line(end = [8.62, -9.57])
  |> close(tag = $seg01)
  |> extrude(length = 5 + 7)
sketch001 = startSketchOn(part001, seg01)`)
  })
  test('it should be able to extrude on start-end caps', async () => {
    const code = `part001 = startSketchOn('-XZ')
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
    expect(newCode).toContain(`part001 = startSketchOn('-XZ')
  |> startProfileAt([3.58, 2.06], %)
  |> line(end = [9.7, 9.19])
  |> line(end = [8.62, -9.57])
  |> close()
  |> extrude(length = 5 + 7)
sketch001 = startSketchOn(part001, 'END')`)
  })
  test('it should ensure that the new sketch is inserted after the extrude', async () => {
    const code = `sketch001 = startSketchOn('-XZ')
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
    const code = `part001 = startSketchOn('-XZ')
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
    expect(newCode).toBe(`part001 = startSketchOn('-XZ')
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
    ) => `part001 = startSketchOn('-XZ')
  |> startProfileAt([54.78, -95.91], %)
  |> line(end = [306.21, 198.82], tag = $b)
${!replace1 ? `  |> ${line}\n` : ''}  |> angledLine([-65, ${
      !replace1 ? 'segLen(a)' : replace1
    }], %)
  |> line(end = [306.21, 198.87])
  |> angledLine([65, ${!replace2 ? 'segAng(a)' : replace2}], %)
  |> line(end = [-963.39, -154.67])
`
    test.each([
      ['line', 'line(end = [306.21, 198.85], tag = $a)', ['365.11', '33']],
      [
        'lineTo',
        'line(endAbsolute = [306.21, 198.85], tag = $a)',
        ['110.48', '119.73'],
      ],
      ['yLine', 'yLine(198.85, %, $a)', ['198.85', '90']],
      ['xLine', 'xLine(198.85, %, $a)', ['198.85', '0']],
      ['yLineTo', 'yLineTo(198.85, %, $a)', ['95.94', '90']],
      ['xLineTo', 'xLineTo(198.85, %, $a)', ['162.14', '180']],
      [
        'angledLine',
        'angledLine({ angle: 45.5, length: 198.85 }, %, $a)',
        ['198.85', '45.5'],
      ],
      [
        'angledLineOfXLength',
        'angledLineOfXLength({ angle = 45.5, length = 198.85 }, %, $a)',
        ['283.7', '45.5'],
      ],
      [
        'angledLineOfYLength',
        'angledLineOfYLength({ angle = 45.5, length = 198.85 }, %, $a)',
        ['278.79', '45.5'],
      ],
      [
        'angledLineToX',
        'angledLineToX({ angle = 45.5, to = 198.85 }, %, $a)',
        ['231.33', '134.5'],
      ],
      [
        'angledLineToY',
        'angledLineToY({ angle = 45.5, to = 198.85 }, %, $a)',
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
      const range = topLevelRange(
        code.indexOf(lineOfInterest),
        code.indexOf(lineOfInterest) + lineOfInterest.length
      )
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
      expect(newCode).toBe(makeCode(line, replace1, replace2))
    })
  })
})

describe('Testing removeSingleConstraintInfo', () => {
  describe('with mostly object notation', () => {
    const code = `part001 = startSketchOn('-XZ')
  |> startProfileAt([0, 0], %)
  |> line(end = [3 + 0, 4 + 0])
  |> angledLine({ angle = 3 + 0, length = 3.14 + 0 }, %)
  |> line(endAbsolute = [6.14 + 0, 3.14 + 0])
  |> xLineTo(8 + 0, %)
  |> yLineTo(5 + 0, %)
  |> yLine(3.14 + 0, %, $a)
  |> xLine(3.14 + 0, %)
  |> angledLineOfXLength({ angle = 3 + 0, length = 3.14 + 0 }, %)
  |> angledLineOfYLength({ angle = 30 + 0, length = 3 + 0 }, %)
  |> angledLineToX({ angle = 12.14 + 0, to = 12 + 0 }, %)
  |> angledLineToY({ angle = 30 + 0, to = 10.14 + 0 }, %)
  |> angledLineThatIntersects({
        angle = 3.14 + 0,
        intersectTag = a,
        offset = 0 + 0
      }, %)
  |> tangentialArcTo([3.14 + 0, 13.14 + 0], %)`
    test.each([
      [' line(end = [3 + 0, 4])', 'arrayIndex', 1],
      [
        'angledLine({ angle = 3, length = 3.14 + 0 }, %)',
        'objectProperty',
        'angle',
      ],
      ['line(endAbsolute = [6.14 + 0, 3.14 + 0])', 'arrayIndex', 0],
      ['xLineTo(8, %)', '', ''],
      ['yLineTo(5, %)', '', ''],
      ['yLine(3.14, %, $a)', '', ''],
      ['xLine(3.14, %)', '', ''],
      [
        'angledLineOfXLength({ angle = 3, length = 3.14 + 0 }, %)',
        'objectProperty',
        'angle',
      ],
      [
        'angledLineOfYLength({ angle = 30 + 0, length = 3 }, %)',
        'objectProperty',
        'length',
      ],
      [
        'angledLineToX({ angle = 12.14 + 0, to = 12 }, %)',
        'objectProperty',
        'to',
      ],
      [
        'angledLineToY({ angle = 30, to = 10.14 + 0 }, %)',
        'objectProperty',
        'angle',
      ],
      [
        `angledLineThatIntersects({
       angle = 3.14 + 0,
       offset = 0,
       intersectTag = a
     }, %)`,
        'objectProperty',
        'offset',
      ],
      ['tangentialArcTo([3.14 + 0, 13.14], %)', 'arrayIndex', 1],
    ] as const)('stdlib fn: %s', async (expectedFinish, key, value) => {
      const ast = assertParse(code)

      const execState = await enginelessExecutor(ast)
      const lineOfInterest = expectedFinish.split('(')[0] + '('
      const range = topLevelRange(
        code.indexOf(lineOfInterest) + 1,
        code.indexOf(lineOfInterest) + lineOfInterest.length
      )
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
    })
  })
  describe('with array notation', () => {
    const code = `part001 = startSketchOn('-XZ')
  |> startProfileAt([0, 0], %)
  |> angledLine([3.14 + 0, 3.14 + 0], %)
  |> angledLineOfXLength([3 + 0, 3.14 + 0], %)
  |> angledLineOfYLength([30 + 0, 3 + 0], %)
  |> angledLineToX([12.14 + 0, 12 + 0], %)
  |> angledLineToY([30 + 0, 10.14 + 0], %)`
    test.each([
      ['angledLine([3, 3.14 + 0], %)', 'arrayIndex', 0],
      ['angledLineOfXLength([3, 3.14 + 0], %)', 'arrayIndex', 0],
      ['angledLineOfYLength([30 + 0, 3], %)', 'arrayIndex', 1],
      ['angledLineToX([12.14 + 0, 12], %)', 'arrayIndex', 1],
      ['angledLineToY([30, 10.14 + 0], %)', 'arrayIndex', 0],
    ])('stdlib fn: %s', async (expectedFinish, key, value) => {
      const ast = assertParse(code)

      const execState = await enginelessExecutor(ast)
      const lineOfInterest = expectedFinish.split('(')[0] + '('
      const range = topLevelRange(
        code.indexOf(lineOfInterest) + 1,
        code.indexOf(lineOfInterest) + lineOfInterest.length
      )
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
sketch003 = startSketchOn('XZ')
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
    [
      'delete extrude',
      {
        codeBefore: `sketch001 = startSketchOn('XZ')
  |> startProfileAt([3.29, 7.86], %)
  |> line(end = [2.48, 2.44])
  |> line(end = [2.66, 1.17])
  |> line(end = [3.75, 0.46])
  |> line(end = [4.99, -0.46], tag = $seg01)
  |> line(end = [-3.86, -2.73])
  |> line(end = [-17.67, 0.85])
  |> close()
const extrude001 = extrude(sketch001, length = 10)`,
        codeAfter: `sketch001 = startSketchOn('XZ')
  |> startProfileAt([3.29, 7.86], %)
  |> line(end = [2.48, 2.44])
  |> line(end = [2.66, 1.17])
  |> line(end = [3.75, 0.46])
  |> line(end = [4.99, -0.46], tag = $seg01)
  |> line(end = [-3.86, -2.73])
  |> line(end = [-17.67, 0.85])
  |> close()\n`,
        lineOfInterest: 'line(end = [2.66, 1.17])',
        type: 'wall',
      },
    ],
    [
      'delete extrude with sketch on it',
      {
        codeBefore: `myVar = 5
sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.46, 5.12], %, $tag)
  |> line(end = [0.08, myVar])
  |> line(end = [13.03, 2.02], tag = $seg01)
  |> line(end = [3.9, -7.6])
  |> line(end = [-11.18, -2.15])
  |> line(end = [5.41, -9.61])
  |> line(end = [-8.54, -2.51])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
const extrude001 = extrude(sketch001, length = 5)
sketch002 = startSketchOn(extrude001, seg01)
  |> startProfileAt([-12.55, 2.89], %)
  |> line(end = [3.02, 1.9])
  |> line(end = [1.82, -1.49], tag = $seg02)
  |> angledLine([-86, segLen(seg02)], %)
  |> line(end = [-3.97, -0.53])
  |> line(end = [0.3, 0.84])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`,
        codeAfter: `myVar = 5
sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.46, 5.12], %, $tag)
  |> line(end = [0.08, myVar])
  |> line(end = [13.03, 2.02], tag = $seg01)
  |> line(end = [3.9, -7.6])
  |> line(end = [-11.18, -2.15])
  |> line(end = [5.41, -9.61])
  |> line(end = [-8.54, -2.51])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn({
       plane = {
         origin = { x = 1, y = 2, z = 3 },
         xAxis = { x = 4, y = 5, z = 6 },
         yAxis = { x = 7, y = 8, z = 9 },
         zAxis = { x = 10, y = 11, z = 12 }
       }
     })
  |> startProfileAt([-12.55, 2.89], %)
  |> line(end = [3.02, 1.9])
  |> line(end = [1.82, -1.49], tag = $seg02)
  |> angledLine([-86, segLen(seg02)], %)
  |> line(end = [-3.97, -0.53])
  |> line(end = [0.3, 0.84])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`,
        lineOfInterest: 'line(end = [-11.18, -2.15])',
        type: 'wall',
      },
    ],
    [
      'delete extrude with sketch on it 2',
      {
        codeBefore: `myVar = 5
sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.46, 5.12], %, $tag)
  |> line(end = [0.08, myVar])
  |> line(end = [13.03, 2.02], tag = $seg01)
  |> line(end = [3.9, -7.6])
  |> line(end = [-11.18, -2.15])
  |> line(end = [5.41, -9.61])
  |> line(end = [-8.54, -2.51])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
const extrude001 = extrude(sketch001, length = 5)
sketch002 = startSketchOn(extrude001, seg01)
  |> startProfileAt([-12.55, 2.89], %)
  |> line(end = [3.02, 1.9])
  |> line(end = [1.82, -1.49], tag = $seg02)
  |> angledLine([-86, segLen(seg02)], %)
  |> line(end = [-3.97, -0.53])
  |> line(end = [0.3, 0.84])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`,
        codeAfter: `myVar = 5
sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.46, 5.12], %, $tag)
  |> line(end = [0.08, myVar])
  |> line(end = [13.03, 2.02], tag = $seg01)
  |> line(end = [3.9, -7.6])
  |> line(end = [-11.18, -2.15])
  |> line(end = [5.41, -9.61])
  |> line(end = [-8.54, -2.51])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn({
       plane = {
         origin = { x = 1, y = 2, z = 3 },
         xAxis = { x = 4, y = 5, z = 6 },
         yAxis = { x = 7, y = 8, z = 9 },
         zAxis = { x = 10, y = 11, z = 12 }
       }
     })
  |> startProfileAt([-12.55, 2.89], %)
  |> line(end = [3.02, 1.9])
  |> line(end = [1.82, -1.49], tag = $seg02)
  |> angledLine([-86, segLen(seg02)], %)
  |> line(end = [-3.97, -0.53])
  |> line(end = [0.3, 0.84])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`,
        lineOfInterest: 'startProfileAt([4.46, 5.12], %, $tag)',
        type: 'cap',
      },
    ],
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
    const codeBefore = `part001 = startSketchOn('XZ')
  |> startProfileAt([1, 2], %)
  |> line([3, 4], %)
  |> line([5, 6], %)
  |> close(%)
extrude001 = extrude(5, part001)
    `

    const expectedCodeAfter = `sketch001 = startSketchOn('XZ')
part001 = startProfileAt([1, 2], sketch001)
  |> line([3, 4], %)
  |> line([5, 6], %)
  |> close(%)
extrude001 = extrude(5, part001)
    `

    const ast = assertParse(codeBefore)

    const codeOfInterest = `startSketchOn('XZ')`
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
    const codeBefore = `sketch001 = startSketchOn('XZ')
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
