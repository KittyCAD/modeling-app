import { parse, recast, initPromise, Identifier } from './wasm'
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
} from './modifyAst'
import { enginelessExecutor } from '../lib/testHelpers'
import { findUsesOfTagInPipe, getNodePathFromSourceRange } from './queryAst'
import { err } from 'lib/trap'
import { SimplifiedArgDetails } from './std/stdTypes'

beforeAll(async () => {
  await initPromise
})

describe('Testing createLiteral', () => {
  it('should create a literal', () => {
    const result = createLiteral(5)
    expect(result.type).toBe('Literal')
    expect(result.value).toBe(5)
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
    expect((result.arguments[0] as any).value).toBe(5)
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
    expect((result.properties[0].value as any).value).toBe(5)
  })
})
describe('Testing createArrayExpression', () => {
  it('should create an array expression', () => {
    const result = createArrayExpression([createLiteral(5)])
    expect(result.type).toBe('ArrayExpression')
    expect(result.elements[0].type).toBe('Literal')
    expect((result.elements[0] as any).value).toBe(5)
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
    expect(result.declarations[0].type).toBe('VariableDeclarator')
    expect(result.declarations[0].id.type).toBe('Identifier')
    expect(result.declarations[0].id.name).toBe('myVar')
    expect(result.declarations[0].init.type).toBe('Literal')
    expect((result.declarations[0].init as any).value).toBe(5)
  })
})
describe('Testing createPipeExpression', () => {
  it('should create a pipe expression', () => {
    const result = createPipeExpression([createLiteral(5)])
    expect(result.type).toBe('PipeExpression')
    expect(result.body[0].type).toBe('Literal')
    expect((result.body[0] as any).value).toBe(5)
  })
})

describe('Testing findUniqueName', () => {
  it('should find a unique name', () => {
    const result = findUniqueName(
      JSON.stringify([
        { type: 'Identifier', name: 'yo01', start: 0, end: 0, digest: null },
        { type: 'Identifier', name: 'yo02', start: 0, end: 0, digest: null },
        { type: 'Identifier', name: 'yo03', start: 0, end: 0, digest: null },
        { type: 'Identifier', name: 'yo04', start: 0, end: 0, digest: null },
        { type: 'Identifier', name: 'yo05', start: 0, end: 0, digest: null },
        { type: 'Identifier', name: 'yo06', start: 0, end: 0, digest: null },
        { type: 'Identifier', name: 'yo07', start: 0, end: 0, digest: null },
        { type: 'Identifier', name: 'yo08', start: 0, end: 0, digest: null },
        { type: 'Identifier', name: 'yo09', start: 0, end: 0, digest: null },
      ] satisfies Identifier[]),
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
        start: 0,
        end: 0,
        nonCodeMeta: { nonCodeNodes: {}, start: [], digest: null },
        digest: null,
      },
      'yz'
    )
    const str = recast(result.modifiedAst)
    expect(str).toBe(`const sketch001 = startSketchOn('YZ')
  |> startProfileAt('default', %)
  |> line('default', %)
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
  const ast = parse(code)
  if (err(ast)) throw ast
  const start = code.indexOf(searchStr)
  const range: [number, number] = [start, start + searchStr.length]
  const sketchRes = giveSketchFnCallTag(ast, range)
  if (err(sketchRes)) throw sketchRes
  const { modifiedAst, tag, isTagExisting } = sketchRes
  const newCode = recast(modifiedAst)
  if (err(newCode)) throw newCode
  return { tag, newCode, isTagExisting }
}

describe('Testing giveSketchFnCallTag', () => {
  const code = `const part001 = startSketchOn('XY')
|> startProfileAt([0, 0], %)
|> line([-2.57, -0.13], %)
|> line([0, 0.83], %)
|> line([0.82, 0.34], %)`
  it('Should add tag to a sketch function call', () => {
    const { newCode, tag, isTagExisting } = giveSketchFnCallTagTestHelper(
      code,
      'line([0, 0.83], %)'
    )
    expect(newCode).toContain('line([0, 0.83], %, $seg01)')
    expect(tag).toBe('seg01')
    expect(isTagExisting).toBe(false)
  })
  it('Should create a unique tag if seg01 already exists', () => {
    let _code = code.replace(
      'line([-2.57, -0.13], %)',
      'line([-2.57, -0.13], %, $seg01)'
    )
    const { newCode, tag, isTagExisting } = giveSketchFnCallTagTestHelper(
      _code,
      'line([0, 0.83], %)'
    )
    expect(newCode).toContain('line([0, 0.83], %, $seg02)')
    expect(tag).toBe('seg02')
    expect(isTagExisting).toBe(false)
  })
  it('Should return existing tag if it already exists', () => {
    const lineButWithTag = 'line([-2.57, -0.13], %, $butts)'
    let _code = code.replace('line([-2.57, -0.13], %)', lineButWithTag)
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
const yo = 5 + 6
const part001 = startSketchOn('XY')
|> startProfileAt([-1.2, 4.83], %)
|> line([2.8, 0], %)
|> angledLine([100 + 100, 3.09], %)
|> angledLine([abc, 3.09], %)
|> angledLine([def(yo), 3.09], %)
|> angledLine([ghi(%), 3.09], %)
|> angledLine([jkl(yo) + 2, 3.09], %)
const yo2 = hmm([identifierGuy + 5])`
  it('should move a binary expression into a new variable', async () => {
    const ast = parse(code)
    if (err(ast)) throw ast
    const programMemory = await enginelessExecutor(ast)
    const startIndex = code.indexOf('100 + 100') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      programMemory,
      [startIndex, startIndex],
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const newVar = 100 + 100`)
    expect(newCode).toContain(`angledLine([newVar, 3.09], %)`)
  })
  it('should move a value into a new variable', async () => {
    const ast = parse(code)
    if (err(ast)) throw ast
    const programMemory = await enginelessExecutor(ast)
    const startIndex = code.indexOf('2.8') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      programMemory,
      [startIndex, startIndex],
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const newVar = 2.8`)
    expect(newCode).toContain(`line([newVar, 0], %)`)
  })
  it('should move a callExpression into a new variable', async () => {
    const ast = parse(code)
    if (err(ast)) throw ast
    const programMemory = await enginelessExecutor(ast)
    const startIndex = code.indexOf('def(')
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      programMemory,
      [startIndex, startIndex],
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const newVar = def(yo)`)
    expect(newCode).toContain(`angledLine([newVar, 3.09], %)`)
  })
  it('should move a binary expression with call expression into a new variable', async () => {
    const ast = parse(code)
    if (err(ast)) throw ast
    const programMemory = await enginelessExecutor(ast)
    const startIndex = code.indexOf('jkl(') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      programMemory,
      [startIndex, startIndex],
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const newVar = jkl(yo) + 2`)
    expect(newCode).toContain(`angledLine([newVar, 3.09], %)`)
  })
  it('should move a identifier into a new variable', async () => {
    const ast = parse(code)
    if (err(ast)) throw ast
    const programMemory = await enginelessExecutor(ast)
    const startIndex = code.indexOf('identifierGuy +') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      programMemory,
      [startIndex, startIndex],
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const newVar = identifierGuy + 5`)
    expect(newCode).toContain(`const yo2 = hmm([newVar])`)
  })
})

describe('testing sketchOnExtrudedFace', () => {
  test('it should be able to extrude on regular segments', async () => {
    const code = `const part001 = startSketchOn('-XZ')
  |> startProfileAt([3.58, 2.06], %)
  |> line([9.7, 9.19], %)
  |> line([8.62, -9.57], %)
  |> close(%)
  |> extrude(5 + 7, %)`
    const ast = parse(code)
    if (err(ast)) throw ast

    const segmentSnippet = `line([9.7, 9.19], %)`
    const segmentRange: [number, number] = [
      code.indexOf(segmentSnippet),
      code.indexOf(segmentSnippet) + segmentSnippet.length,
    ]
    const segmentPathToNode = getNodePathFromSourceRange(ast, segmentRange)
    const extrudeSnippet = `extrude(5 + 7, %)`
    const extrudeRange: [number, number] = [
      code.indexOf(extrudeSnippet),
      code.indexOf(extrudeSnippet) + extrudeSnippet.length,
    ]
    const extrudePathToNode = getNodePathFromSourceRange(ast, extrudeRange)

    const extruded = sketchOnExtrudedFace(
      ast,
      segmentPathToNode,
      extrudePathToNode
    )
    if (err(extruded)) throw extruded
    const { modifiedAst } = extruded

    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const part001 = startSketchOn('-XZ')
  |> startProfileAt([3.58, 2.06], %)
  |> line([9.7, 9.19], %, $seg01)
  |> line([8.62, -9.57], %)
  |> close(%)
  |> extrude(5 + 7, %)
const sketch001 = startSketchOn(part001, seg01)`)
  })
  test('it should be able to extrude on close segments', async () => {
    const code = `const part001 = startSketchOn('-XZ')
  |> startProfileAt([3.58, 2.06], %)
  |> line([9.7, 9.19], %)
  |> line([8.62, -9.57], %)
  |> close(%)
  |> extrude(5 + 7, %)`
    const ast = parse(code)
    if (err(ast)) throw ast
    const segmentSnippet = `close(%)`
    const segmentRange: [number, number] = [
      code.indexOf(segmentSnippet),
      code.indexOf(segmentSnippet) + segmentSnippet.length,
    ]
    const segmentPathToNode = getNodePathFromSourceRange(ast, segmentRange)
    const extrudeSnippet = `extrude(5 + 7, %)`
    const extrudeRange: [number, number] = [
      code.indexOf(extrudeSnippet),
      code.indexOf(extrudeSnippet) + extrudeSnippet.length,
    ]
    const extrudePathToNode = getNodePathFromSourceRange(ast, extrudeRange)

    const extruded = sketchOnExtrudedFace(
      ast,
      segmentPathToNode,
      extrudePathToNode
    )
    if (err(extruded)) throw extruded
    const { modifiedAst } = extruded

    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const part001 = startSketchOn('-XZ')
  |> startProfileAt([3.58, 2.06], %)
  |> line([9.7, 9.19], %)
  |> line([8.62, -9.57], %)
  |> close(%, $seg01)
  |> extrude(5 + 7, %)
const sketch001 = startSketchOn(part001, seg01)`)
  })
  test('it should be able to extrude on start-end caps', async () => {
    const code = `const part001 = startSketchOn('-XZ')
  |> startProfileAt([3.58, 2.06], %)
  |> line([9.7, 9.19], %)
  |> line([8.62, -9.57], %)
  |> close(%)
  |> extrude(5 + 7, %)`
    const ast = parse(code)
    if (err(ast)) throw ast
    const sketchSnippet = `startProfileAt([3.58, 2.06], %)`
    const sketchRange: [number, number] = [
      code.indexOf(sketchSnippet),
      code.indexOf(sketchSnippet) + sketchSnippet.length,
    ]
    const sketchPathToNode = getNodePathFromSourceRange(ast, sketchRange)
    const extrudeSnippet = `extrude(5 + 7, %)`
    const extrudeRange: [number, number] = [
      code.indexOf(extrudeSnippet),
      code.indexOf(extrudeSnippet) + extrudeSnippet.length,
    ]
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
    expect(newCode).toContain(`const part001 = startSketchOn('-XZ')
  |> startProfileAt([3.58, 2.06], %)
  |> line([9.7, 9.19], %)
  |> line([8.62, -9.57], %)
  |> close(%)
  |> extrude(5 + 7, %)
const sketch001 = startSketchOn(part001, 'END')`)
  })
  test('it should ensure that the new sketch is inserted after the extrude', async () => {
    const code = `const sketch001 = startSketchOn('-XZ')
    |> startProfileAt([3.29, 7.86], %)
    |> line([2.48, 2.44], %)
    |> line([2.66, 1.17], %)
    |> line([3.75, 0.46], %)
    |> line([4.99, -0.46], %)
    |> line([3.3, -2.12], %)
    |> line([2.16, -3.33], %)
    |> line([0.85, -3.08], %)
    |> line([-0.18, -3.36], %)
    |> line([-3.86, -2.73], %)
    |> line([-17.67, 0.85], %)
    |> close(%)
    const part001 = extrude(5 + 7, sketch001)`
    const ast = parse(code)
    if (err(ast)) throw ast
    const segmentSnippet = `line([4.99, -0.46], %)`
    const segmentRange: [number, number] = [
      code.indexOf(segmentSnippet),
      code.indexOf(segmentSnippet) + segmentSnippet.length,
    ]
    const segmentPathToNode = getNodePathFromSourceRange(ast, segmentRange)
    const extrudeSnippet = `extrude(5 + 7, sketch001)`
    const extrudeRange: [number, number] = [
      code.indexOf(extrudeSnippet),
      code.indexOf(extrudeSnippet) + extrudeSnippet.length,
    ]
    const extrudePathToNode = getNodePathFromSourceRange(ast, extrudeRange)

    const updatedAst = sketchOnExtrudedFace(
      ast,
      segmentPathToNode,
      extrudePathToNode
    )
    if (err(updatedAst)) throw updatedAst
    const newCode = recast(updatedAst.modifiedAst)
    expect(newCode).toContain(`const part001 = extrude(5 + 7, sketch001)
const sketch002 = startSketchOn(part001, seg01)`)
  })
})

describe('Testing deleteSegmentFromPipeExpression', () => {
  it('Should delete a segment withOUT any dependent segments', async () => {
    const code = `const part001 = startSketchOn('-XZ')
  |> startProfileAt([54.78, -95.91], %)
  |> line([306.21, 198.82], %)
  |> line([306.21, 198.85], %, $a)
  |> line([306.21, 198.87], %)`
    const ast = parse(code)
    if (err(ast)) throw ast
    const programMemory = await enginelessExecutor(ast)
    const lineOfInterest = 'line([306.21, 198.85], %, $a)'
    const range: [number, number] = [
      code.indexOf(lineOfInterest),
      code.indexOf(lineOfInterest) + lineOfInterest.length,
    ]
    const pathToNode = getNodePathFromSourceRange(ast, range)
    const modifiedAst = deleteSegmentFromPipeExpression(
      [],
      ast,
      programMemory,
      code,
      pathToNode
    )
    if (err(modifiedAst)) throw modifiedAst
    const newCode = recast(modifiedAst)
    expect(newCode).toBe(`const part001 = startSketchOn('-XZ')
  |> startProfileAt([54.78, -95.91], %)
  |> line([306.21, 198.82], %)
  |> line([306.21, 198.87], %)
`)
  })
  describe('Should delete a segment WITH any dependent segments, unconstraining the dependent parts', () => {
    const makeCode = (
      line: string,
      replace1 = '',
      replace2 = ''
    ) => `const part001 = startSketchOn('-XZ')
  |> startProfileAt([54.78, -95.91], %)
  |> line([306.21, 198.82], %, $b)
${!replace1 ? `  |> ${line}\n` : ''}  |> angledLine([-65, ${
      !replace1 ? 'segLen(a)' : replace1
    }], %)
  |> line([306.21, 198.87], %)
  |> angledLine([65, ${!replace2 ? 'segAng(a)' : replace2}], %)
  |> line([-963.39, -154.67], %)
`
    test.each([
      ['line', 'line([306.21, 198.85], %, $a)', ['365.11', '33']],
      ['lineTo', 'lineTo([306.21, 198.85], %, $a)', ['110.48', '119.73']],
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
        'angledLineOfXLength({ angle: 45.5, length: 198.85 }, %, $a)',
        ['283.7', '45.5'],
      ],
      [
        'angledLineOfYLength',
        'angledLineOfYLength({ angle: 45.5, length: 198.85 }, %, $a)',
        ['278.79', '45.5'],
      ],
      [
        'angledLineToX',
        'angledLineToX({ angle: 45.5, to: 198.85 }, %, $a)',
        ['231.33', '134.5'],
      ],
      [
        'angledLineToY',
        'angledLineToY({ angle: 45.5, to: 198.85 }, %, $a)',
        ['134.51', '45.5'],
      ],
      [
        'angledLineThatIntersects',
        `angledLineThatIntersects({ angle: 45.5, intersectTag: b, offset: 198.85 }, %, $a)`,
        ['918.4', '45.5'],
      ],
    ])(`%s`, async (_, line, [replace1, replace2]) => {
      const code = makeCode(line)
      const ast = parse(code)
      if (err(ast)) throw ast
      const programMemory = await enginelessExecutor(ast)
      const lineOfInterest = line
      const range: [number, number] = [
        code.indexOf(lineOfInterest),
        code.indexOf(lineOfInterest) + lineOfInterest.length,
      ]
      const pathToNode = getNodePathFromSourceRange(ast, range)
      const dependentSegments = findUsesOfTagInPipe(ast, pathToNode)
      const modifiedAst = deleteSegmentFromPipeExpression(
        dependentSegments,
        ast,
        programMemory,
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
    const code = `const part001 = startSketchOn('-XZ')
  |> startProfileAt([0, 0], %)
  |> line([3 + 0, 4 + 0], %)
  |> angledLine({ angle: 3 + 0, length: 3.14 + 0 }, %)
  |> lineTo([6.14 + 0, 3.14 + 0], %)
  |> xLineTo(8 + 0, %)
  |> yLineTo(5 + 0, %)
  |> yLine(3.14 + 0, %, $a)
  |> xLine(3.14 + 0, %)
  |> angledLineOfXLength({ angle: 3 + 0, length: 3.14 + 0 }, %)
  |> angledLineOfYLength({ angle: 30 + 0, length: 3 + 0 }, %)
  |> angledLineToX({ angle: 12.14 + 0, to: 12 + 0 }, %)
  |> angledLineToY({ angle: 30 + 0, to: 10.14 + 0 }, %)
  |> angledLineThatIntersects({
        angle: 3.14 + 0,
        intersectTag: a,
        offset: 0 + 0
      }, %)
  |> tangentialArcTo([3.14 + 0, 13.14 + 0], %)`
    test.each([
      [' line([3 + 0, 4], %)', 'arrayIndex', 1],
      [
        'angledLine({ angle: 3, length: 3.14 + 0 }, %)',
        'objectProperty',
        'angle',
      ],
      ['lineTo([6.14, 3.14 + 0], %)', 'arrayIndex', 0],
      ['xLineTo(8, %)', '', ''],
      ['yLineTo(5, %)', '', ''],
      ['yLine(3.14, %, $a)', '', ''],
      ['xLine(3.14, %)', '', ''],
      [
        'angledLineOfXLength({ angle: 3, length: 3.14 + 0 }, %)',
        'objectProperty',
        'angle',
      ],
      [
        'angledLineOfYLength({ angle: 30 + 0, length: 3 }, %)',
        'objectProperty',
        'length',
      ],
      [
        'angledLineToX({ angle: 12.14 + 0, to: 12 }, %)',
        'objectProperty',
        'to',
      ],
      [
        'angledLineToY({ angle: 30, to: 10.14 + 0 }, %)',
        'objectProperty',
        'angle',
      ],
      [
        `angledLineThatIntersects({
       angle: 3.14 + 0,
       offset: 0,
       intersectTag: a
     }, %)`,
        'objectProperty',
        'offset',
      ],
      ['tangentialArcTo([3.14 + 0, 13.14], %)', 'arrayIndex', 1],
    ] as const)('stdlib fn: %s', async (expectedFinish, key, value) => {
      const ast = parse(code)
      if (err(ast)) throw ast

      const programMemory = await enginelessExecutor(ast)
      const lineOfInterest = expectedFinish.split('(')[0] + '('
      const range: [number, number] = [
        code.indexOf(lineOfInterest) + 1,
        code.indexOf(lineOfInterest) + lineOfInterest.length,
      ]
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
        programMemory
      )
      if (!mod) return new Error('mod is undefined')
      const recastCode = recast(mod.modifiedAst)
      expect(recastCode).toContain(expectedFinish)
    })
  })
  describe('with array notation', () => {
    const code = `const part001 = startSketchOn('-XZ')
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
      const ast = parse(code)
      if (err(ast)) throw ast

      const programMemory = await enginelessExecutor(ast)
      const lineOfInterest = expectedFinish.split('(')[0] + '('
      const range: [number, number] = [
        code.indexOf(lineOfInterest) + 1,
        code.indexOf(lineOfInterest) + lineOfInterest.length,
      ]
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
        programMemory
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
        codeBefore: `const myVar = 5
const sketch003 = startSketchOn('XZ')
  |> startProfileAt([3.82, 13.6], %)
  |> line([-2.94, 2.7], %)
  |> line([7.7, 0.16], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`,
        codeAfter: `const myVar = 5\n`,
        lineOfInterest: 'line([-2.94, 2.7], %)',
        type: 'default',
      },
    ],
    [
      'delete extrude',
      {
        codeBefore: `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([3.29, 7.86], %)
  |> line([2.48, 2.44], %)
  |> line([2.66, 1.17], %)
  |> line([3.75, 0.46], %)
  |> line([4.99, -0.46], %, $seg01)
  |> line([-3.86, -2.73], %)
  |> line([-17.67, 0.85], %)
  |> close(%)
const extrude001 = extrude(10, sketch001)`,
        codeAfter: `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([3.29, 7.86], %)
  |> line([2.48, 2.44], %)
  |> line([2.66, 1.17], %)
  |> line([3.75, 0.46], %)
  |> line([4.99, -0.46], %, $seg01)
  |> line([-3.86, -2.73], %)
  |> line([-17.67, 0.85], %)
  |> close(%)\n`,
        lineOfInterest: 'line([2.66, 1.17], %)',
        type: 'extrude-wall',
      },
    ],
    [
      'delete extrude with sketch on it',
      {
        codeBefore: `const myVar = 5
const sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.46, 5.12], %, $tag)
  |> line([0.08, myVar], %)
  |> line([13.03, 2.02], %, $seg01)
  |> line([3.9, -7.6], %)
  |> line([-11.18, -2.15], %)
  |> line([5.41, -9.61], %)
  |> line([-8.54, -2.51], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(5, sketch001)
const sketch002 = startSketchOn(extrude001, seg01)
  |> startProfileAt([-12.55, 2.89], %)
  |> line([3.02, 1.9], %)
  |> line([1.82, -1.49], %, $seg02)
  |> angledLine([-86, segLen(seg02)], %)
  |> line([-3.97, -0.53], %)
  |> line([0.3, 0.84], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`,
        codeAfter: `const myVar = 5
const sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.46, 5.12], %, $tag)
  |> line([0.08, myVar], %)
  |> line([13.03, 2.02], %, $seg01)
  |> line([3.9, -7.6], %)
  |> line([-11.18, -2.15], %)
  |> line([5.41, -9.61], %)
  |> line([-8.54, -2.51], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const sketch002 = startSketchOn({
       plane: {
         origin: { x: 1, y: 2, z: 3 },
         x_axis: { x: 4, y: 5, z: 6 },
         y_axis: { x: 7, y: 8, z: 9 },
         z_axis: { x: 10, y: 11, z: 12 }
       }
     })
  |> startProfileAt([-12.55, 2.89], %)
  |> line([3.02, 1.9], %)
  |> line([1.82, -1.49], %, $seg02)
  |> angledLine([-86, segLen(seg02)], %)
  |> line([-3.97, -0.53], %)
  |> line([0.3, 0.84], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
`,
        lineOfInterest: 'line([-11.18, -2.15], %)',
        type: 'extrude-wall',
      },
    ],
    [
      'delete extrude with sketch on it',
      {
        codeBefore: `const myVar = 5
const sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.46, 5.12], %, $tag)
  |> line([0.08, myVar], %)
  |> line([13.03, 2.02], %, $seg01)
  |> line([3.9, -7.6], %)
  |> line([-11.18, -2.15], %)
  |> line([5.41, -9.61], %)
  |> line([-8.54, -2.51], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(5, sketch001)
const sketch002 = startSketchOn(extrude001, seg01)
  |> startProfileAt([-12.55, 2.89], %)
  |> line([3.02, 1.9], %)
  |> line([1.82, -1.49], %, $seg02)
  |> angledLine([-86, segLen(seg02)], %)
  |> line([-3.97, -0.53], %)
  |> line([0.3, 0.84], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`,
        codeAfter: `const myVar = 5
const sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.46, 5.12], %, $tag)
  |> line([0.08, myVar], %)
  |> line([13.03, 2.02], %, $seg01)
  |> line([3.9, -7.6], %)
  |> line([-11.18, -2.15], %)
  |> line([5.41, -9.61], %)
  |> line([-8.54, -2.51], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const sketch002 = startSketchOn({
       plane: {
         origin: { x: 1, y: 2, z: 3 },
         x_axis: { x: 4, y: 5, z: 6 },
         y_axis: { x: 7, y: 8, z: 9 },
         z_axis: { x: 10, y: 11, z: 12 }
       }
     })
  |> startProfileAt([-12.55, 2.89], %)
  |> line([3.02, 1.9], %)
  |> line([1.82, -1.49], %, $seg02)
  |> angledLine([-86, segLen(seg02)], %)
  |> line([-3.97, -0.53], %)
  |> line([0.3, 0.84], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
`,
        lineOfInterest: 'startProfileAt([4.46, 5.12], %, $tag)',
        type: 'end-cap',
      },
    ],
  ] as const
  test.each(cases)(
    '%s',
    async (name, { codeBefore, codeAfter, lineOfInterest, type }) => {
      // const lineOfInterest = 'line([-2.94, 2.7], %)'
      const ast = parse(codeBefore)
      if (err(ast)) throw ast
      const programMemory = await enginelessExecutor(ast)

      // deleteFromSelection
      const range: [number, number] = [
        codeBefore.indexOf(lineOfInterest),
        codeBefore.indexOf(lineOfInterest) + lineOfInterest.length,
      ]
      const newAst = await deleteFromSelection(
        ast,
        {
          range,
          type,
        },
        programMemory,
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
