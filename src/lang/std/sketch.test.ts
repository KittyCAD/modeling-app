import {
  changeSketchArguments,
  addTagForSketchOnFace,
  addNewSketchLn,
  getYComponent,
  getXComponent,
  addCloseToPipe,
  getConstraintInfo,
  getConstraintInfoKw,
} from './sketch'
import {
  assertParse,
  recast,
  initPromise,
  CallExpression,
  topLevelRange,
  CallExpressionKw,
} from '../wasm'
import { getNodeFromPath } from '../queryAst'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { enginelessExecutor } from '../../lib/testHelpers'
import { err } from 'lib/trap'
import { Node } from '@rust/kcl-lib/bindings/Node'

const eachQuad: [number, [number, number]][] = [
  [-315, [1, 1]],
  [-225, [-1, 1]],
  [-135, [-1, -1]],
  [-45, [1, -1]],
  [45, [1, 1]],
  [135, [-1, 1]],
  [225, [-1, -1]],
  [315, [1, -1]],
  [405, [1, 1]],
  [495, [-1, 1]],
  [585, [-1, -1]],
  [675, [1, -1]],
]

beforeAll(async () => {
  await initPromise
})

describe('testing getYComponent', () => {
  it('should return the vertical component of a vector correctly when given angles in each quadrant (and with angles < 0, or > 360)', () => {
    const expected: [number, number][] = []
    const results: [number, number][] = []
    eachQuad.forEach(([angle, expectedResult]) => {
      results.push(
        getYComponent(angle, 1).map((a) => Math.round(a)) as [number, number]
      )
      expected.push(expectedResult)
    })
    expect(results).toEqual(expected)
  })
  it('return extreme values on the extremes', () => {
    let result: [number, number]
    result = getYComponent(0, 1)
    expect(result[0]).toBe(1)
    expect(result[1]).toBe(0)

    result = getYComponent(90, 1)
    expect(result[0]).toBe(1)
    expect(result[1]).toBeGreaterThan(100000)

    result = getYComponent(180, 1)
    expect(result[0]).toBe(-1)
    expect(result[1]).toBeCloseTo(0)

    result = getYComponent(270, 1)
    expect(result[0]).toBe(-1)
    expect(result[1]).toBeLessThan(100000)
  })
})

describe('testing getXComponent', () => {
  it('should return the horizontal component of a vector correctly when given angles in each quadrant (and with angles < 0, or > 360)', () => {
    const expected: [number, number][] = []
    const results: [number, number][] = []
    eachQuad.forEach(([angle, expectedResult]) => {
      results.push(
        getXComponent(angle, 1).map((a) => Math.round(a)) as [number, number]
      )
      expected.push(expectedResult)
    })
    expect(results).toEqual(expected)
  })
  it('return extreme values on the extremes', () => {
    let result: [number, number]
    result = getXComponent(0, 1)
    expect(result[0]).toBeGreaterThan(100000)
    expect(result[1]).toBe(1)

    result = getXComponent(90, 1)
    expect(result[0]).toBeCloseTo(0)
    expect(result[1]).toBe(1)

    result = getXComponent(180, 1)
    expect(result[0]).toBeLessThan(100000)
    expect(result[1]).toBe(1)

    result = getXComponent(270, 1)
    expect(result[0]).toBeCloseTo(0)
    expect(result[1]).toBe(-1)
  })
})

describe('testing changeSketchArguments', () => {
  const lineToChange = 'line(endAbsolute = [-1.59, -1.54])'
  const lineAfterChange = 'line(endAbsolute = [2, 3])'
  test('changeSketchArguments', async () => {
    // Enable rotations #152
    const genCode = (line: string) => `mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> ${line}
  |> line(endAbsolute = [0.46, -5.82])
// |> rx(45, %)
`
    const code = genCode(lineToChange)
    const expectedCode = genCode(lineAfterChange)
    const ast = assertParse(code)

    const execState = await enginelessExecutor(ast)
    const sourceStart = code.indexOf(lineToChange)
    const changeSketchArgsRetVal = changeSketchArguments(
      ast,
      execState.variables,
      {
        type: 'sourceRange',
        sourceRange: topLevelRange(
          sourceStart,
          sourceStart + lineToChange.length
        ),
      },
      {
        type: 'straight-segment',
        from: [0, 0],
        to: [2, 3],
      }
    )
    if (err(changeSketchArgsRetVal)) return changeSketchArgsRetVal
    expect(recast(changeSketchArgsRetVal.modifiedAst)).toBe(expectedCode)
  })
})

describe('testing addNewSketchLn', () => {
  const lineToChange = 'line(endAbsolute = [-1.59, -1.54])'
  test('addNewSketchLn', async () => {
    // Enable rotations #152
    const code = `
mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  // |> rx(45, %)
  |> line(endAbsolute = [-1.59, -1.54])
  |> line(endAbsolute = [0.46, -5.82])`
    const ast = assertParse(code)

    const execState = await enginelessExecutor(ast)
    const sourceStart = code.indexOf(lineToChange)
    expect(sourceStart).toBe(89)
    const newSketchLnRetVal = addNewSketchLn({
      node: ast,
      variables: execState.variables,
      input: {
        type: 'straight-segment',
        from: [0, 0],
        to: [2, 3],
      },
      fnName: 'lineTo',
      pathToNode: [
        ['body', ''],
        [0, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', 'VariableDeclarator'],
      ],
    })
    if (err(newSketchLnRetVal)) return newSketchLnRetVal

    // Enable rotations #152
    let expectedCode = `mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  // |> rx(45, %)
  |> line(endAbsolute = [-1.59, -1.54])
  |> line(endAbsolute = [0.46, -5.82])
  |> line(endAbsolute = [2, 3])
`

    const { modifiedAst } = newSketchLnRetVal
    expect(recast(modifiedAst)).toBe(expectedCode)

    const modifiedAst2 = addCloseToPipe({
      node: ast,
      variables: execState.variables,
      pathToNode: [
        ['body', ''],
        [0, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', 'VariableDeclarator'],
      ],
    })
    if (err(modifiedAst2)) return modifiedAst2

    expectedCode = `mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  // |> rx(45, %)
  |> line(endAbsolute = [-1.59, -1.54])
  |> line(endAbsolute = [0.46, -5.82])
  |> close()
`
    expect(recast(modifiedAst2)).toBe(expectedCode)
  })
})

describe('testing addTagForSketchOnFace', () => {
  it('needs to be in it', async () => {
    const originalLine = 'line(endAbsolute = [-1.59, -1.54])'
    // Enable rotations #152
    const genCode = (line: string) => `mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  // |> rx(45, %)
  |> ${line}
  |> line(endAbsolute = [0.46, -5.82])
`
    const code = genCode(originalLine)
    const ast = assertParse(code)
    await enginelessExecutor(ast)
    const sourceStart = code.indexOf(originalLine)
    const sourceRange = topLevelRange(
      sourceStart,
      sourceStart + originalLine.length
    )
    if (err(ast)) return ast
    const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
    const sketchOnFaceRetVal = addTagForSketchOnFace(
      {
        // previousProgramMemory: execState.memory, // redundant?
        pathToNode,
        node: ast,
      },
      'lineTo',
      null
    )
    if (err(sketchOnFaceRetVal)) return sketchOnFaceRetVal

    const { modifiedAst } = sketchOnFaceRetVal
    const expectedCode = genCode(
      'line(endAbsolute = [-1.59, -1.54], tag = $seg01)'
    )
    expect(recast(modifiedAst)).toBe(expectedCode)
  })
  const chamferTestCases = [
    {
      desc: 'chamfer in pipeExpr',
      originalChamfer: `  |> chamfer(length = 30, tags = [seg01, getOppositeEdge(seg01)])`,
      expectedChamfer: `  |> chamfer(length = 30, tags = [getOppositeEdge(seg01)], tag = $seg03)
  |> chamfer(length = 30, tags = [seg01])`,
    },
    {
      desc: 'chamfer with its own variable',
      originalChamfer: `chamf = chamfer(
       extrude001,
       length = 30,
       tags = [seg01, getOppositeEdge(seg01)],
     )`,
      expectedChamfer: `chamf = chamfer(
       extrude001,
       length = 30,
       tags = [getOppositeEdge(seg01)],
       tag = $seg03,
     )
  |> chamfer(length = 30, tags = [seg01])`,
    },
    // Add more test cases here if needed
  ] as const

  chamferTestCases.forEach(({ originalChamfer, expectedChamfer, desc }) => {
    it(`can break up chamfers in order to add tags - ${desc}`, async () => {
      const genCode = (insertCode: string) => `sketch001 = startSketchOn('XZ')
  |> startProfileAt([75.8, 317.2], %) // [$startCapTag, $EndCapTag]
  |> angledLine([0, 268.43], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       217.26
     ], %, $seg01)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(sketch001, length = 100)
${insertCode}
`
      const code = genCode(originalChamfer)
      const ast = assertParse(code)
      await enginelessExecutor(ast)
      const sourceStart = code.indexOf(originalChamfer)
      const extraChars = originalChamfer.indexOf('chamfer')
      const sourceRange = topLevelRange(
        sourceStart + extraChars,
        sourceStart + originalChamfer.length - extraChars
      )

      if (err(ast)) throw ast
      const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
      console.log('pathToNode', pathToNode)
      const sketchOnFaceRetVal = addTagForSketchOnFace(
        {
          pathToNode,
          node: ast,
        },
        'chamfer',
        {
          type: 'edgeCut',
          subType: 'opposite',
          tagName: 'seg01',
        }
      )
      if (err(sketchOnFaceRetVal)) throw sketchOnFaceRetVal
      expect(recast(sketchOnFaceRetVal.modifiedAst)).toBe(
        genCode(expectedChamfer)
      )
    })
  })
})

describe('testing getConstraintInfo', () => {
  describe('object notation', () => {
    const code = `const part001 = startSketchOn('-XZ')
  |> startProfileAt([0,0], %)
  |> line(end = [3, 4])
  |> angledLine({
    angle = 3.14,
    length = 3.14,
  }, %)
  |> line(endAbsolute = [6.14, 3.14])
  |> xLine(endAbsolute = 8)
  |> yLine(endAbsolute = 5)
  |> yLine(length = 3.14, tag = $a)
  |> xLine(length = 3.14)
  |> angledLineOfXLength({
    angle = 3.14,
    length = 3.14,
  }, %)
  |> angledLineOfYLength({
    angle = 30,
    length = 3,
  }, %)
  |> angledLineToX({
    angle = 12.14,
    to = 12,
  }, %)
  |> angledLineToY({
    angle = 30,
    to = 10.14,
  }, %)
  |> angledLineThatIntersects({
    angle = 3.14,
    intersectTag = a,
    offset = 0
  }, %)
  |> tangentialArcTo([3.14, 13.14], %)`
    test.each([
      [
        'line',
        [
          {
            type: 'xRelative',
            isConstrained: false,
            value: '3',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'line',
          },
          {
            type: 'yRelative',
            isConstrained: false,
            value: '4',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'line',
          },
        ],
      ],
      [
        `angledLine(`,
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
          {
            type: 'length',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'length' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
        ],
      ],
      [
        'line(endAbsolute',
        [
          {
            type: 'xAbsolute',
            isConstrained: false,
            value: '6.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'line',
          },
          {
            type: 'yAbsolute',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'line',
          },
        ],
      ],
      [
        'xLine(endAbsolute',
        [
          {
            type: 'horizontal',
            isConstrained: true,
            value: 'xLine',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLineTo',
          },
          {
            type: 'xAbsolute',
            isConstrained: false,
            value: '8',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLineTo',
          },
        ],
      ],
      [
        'yLine(endAbsolute',
        [
          {
            type: 'vertical',
            isConstrained: true,
            value: 'yLine',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLineTo',
          },
          {
            type: 'yAbsolute',
            isConstrained: false,
            value: '5',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLineTo',
          },
        ],
      ],
      [
        'yLine(length',
        [
          {
            type: 'vertical',
            isConstrained: true,
            value: 'yLine',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLine',
          },
          {
            type: 'yRelative',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLine',
          },
        ],
      ],
      [
        'xLine(length',
        [
          {
            type: 'horizontal',
            isConstrained: true,
            value: 'xLine',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLine',
          },
          {
            type: 'xRelative',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLine',
          },
        ],
      ],
      [
        'angledLineOfXLength',
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfXLength',
          },
          {
            type: 'xRelative',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'length' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfXLength',
          },
        ],
      ],
      [
        'angledLineOfYLength',
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '30',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfYLength',
          },
          {
            type: 'yRelative',
            isConstrained: false,
            value: '3',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'length' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfYLength',
          },
        ],
      ],
      [
        'angledLineToX',
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '12.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToX',
          },
          {
            type: 'xAbsolute',
            isConstrained: false,
            value: '12',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'to' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToX',
          },
        ],
      ],
      [
        'angledLineToY',
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '30',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToY',
          },
          {
            type: 'yAbsolute',
            isConstrained: false,
            value: '10.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'to' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToY',
          },
        ],
      ],
      [
        'angledLineThatIntersects',
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineThatIntersects',
          },
          {
            type: 'intersectionOffset',
            isConstrained: false,
            value: '0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'offset' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineThatIntersects',
          },
          {
            type: 'intersectionTag',
            isConstrained: false,
            value: 'a',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: {
              key: 'intersectTag',
              type: 'objectProperty',
            },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineThatIntersects',
          },
        ],
      ],
      [
        'tangentialArcTo',
        [
          {
            type: 'tangentialWithPrevious',
            isConstrained: true,
            value: 'tangentialArcTo',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
          {
            type: 'xAbsolute',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
          {
            type: 'yAbsolute',
            isConstrained: false,
            value: '13.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
        ],
      ],
    ])('testing %s when inputs are unconstrained', (functionName, expected) => {
      const ast = assertParse(code)
      const start = code.indexOf(functionName)
      expect(start).toBeGreaterThanOrEqual(0)
      const sourceRange = topLevelRange(start, start + functionName.length)
      if (err(ast)) return ast
      const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
      const callExp = getNodeFromPath<Node<CallExpression | CallExpressionKw>>(
        ast,
        pathToNode,
        ['CallExpression', 'CallExpressionKw']
      )
      if (err(callExp)) return callExp
      const result =
        callExp.node.type === 'CallExpression'
          ? getConstraintInfo(callExp.node, code, pathToNode)
          : getConstraintInfoKw(callExp.node, code, pathToNode)
      expect(result).toEqual(expected)
    })
  })
  describe('array notation', () => {
    const code = `const part001 = startSketchOn('-XZ')
    |> startProfileAt([0, 0], %)
    |> line(end = [3, 4])
    |> angledLine([3.14, 3.14], %)
    |> line(endAbsolute = [6.14, 3.14])
    |> xLine(endAbsolute = 8)
    |> yLine(endAbsolute = 5)
    |> yLine(length = 3.14, tag = $a)
    |> xLine(length = 3.14)
    |> angledLineOfXLength([3.14, 3.14], %)
    |> angledLineOfYLength([30, 3], %)
    |> angledLineToX([12, 12], %)
    |> angledLineToY([30, 10], %)
    |> angledLineThatIntersects({
         angle = 3.14,
         intersectTag = a,
         offset = 0
       }, %)
    |> tangentialArcTo([3.14, 13.14], %)`
    test.each([
      [
        `angledLine(`,
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
          {
            type: 'length',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
        ],
      ],
      [
        'angledLineOfXLength',
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfXLength',
          },
          {
            type: 'xRelative',
            isConstrained: false,
            value: '3.14',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfXLength',
          },
        ],
      ],
      [
        'angledLineOfYLength',
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '30',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfYLength',
          },
          {
            type: 'yRelative',
            isConstrained: false,
            value: '3',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfYLength',
          },
        ],
      ],
      [
        'angledLineToX',
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '12',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToX',
          },
          {
            type: 'xAbsolute',
            isConstrained: false,
            value: '12',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToX',
          },
        ],
      ],
      [
        'angledLineToY',
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '30',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToY',
          },
          {
            type: 'yAbsolute',
            isConstrained: false,
            value: '10',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToY',
          },
        ],
      ],
    ])('testing %s when inputs are unconstrained', (functionName, expected) => {
      const ast = assertParse(code)
      const sourceRange = topLevelRange(
        code.indexOf(functionName),
        code.indexOf(functionName) + functionName.length
      )
      if (err(ast)) return ast
      const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
      const callExp = getNodeFromPath<Node<CallExpression | CallExpressionKw>>(
        ast,
        pathToNode,
        ['CallExpression', 'CallExpressionKw']
      )
      if (err(callExp)) return callExp
      const result =
        callExp.node.type === 'CallExpression'
          ? getConstraintInfo(callExp.node, code, pathToNode)
          : getConstraintInfoKw(callExp.node, code, pathToNode)
      expect(result).toEqual(expected)
    })
  })
  describe('constrained', () => {
    const code = `const part001 = startSketchOn('-XZ')
    |> startProfileAt([0, 0], %)
    |> line(end = [3 + 0, 4 + 0])
    |> angledLine({ angle = 3.14 + 0, length = 3.14 + 0 }, %)
    |> line(endAbsolute = [6.14 + 0, 3.14 + 0])
    |> xLine(endAbsolute = 8 + 0)
    |> yLine(endAbsolute = 5 + 0)
    |> yLine(length = 3.14 + 0, tag = $a)
    |> xLine(length = 3.14 + 0)
    |> angledLineOfXLength({ angle = 3.14 + 0, length = 3.14 + 0 }, %)
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
      [
        'line',
        [
          {
            type: 'xRelative',
            isConstrained: true,
            value: '3 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'line',
          },
          {
            type: 'yRelative',
            isConstrained: true,
            value: '4 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'line',
          },
        ],
      ],
      [
        `angledLine(`,
        [
          {
            type: 'angle',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
          {
            type: 'length',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'length' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
        ],
      ],
      [
        'line(endAbsolute',
        [
          {
            type: 'xAbsolute',
            isConstrained: true,
            value: '6.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'line',
          },
          {
            type: 'yAbsolute',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'line',
          },
        ],
      ],
      [
        'xLine(endAbsolute',
        [
          {
            type: 'horizontal',
            isConstrained: true,
            value: 'xLine',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLineTo',
          },
          {
            type: 'xAbsolute',
            isConstrained: true,
            value: '8 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLineTo',
          },
        ],
      ],
      [
        'yLine(endAbsolute',
        [
          {
            type: 'vertical',
            isConstrained: true,
            value: 'yLine',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLineTo',
          },
          {
            type: 'yAbsolute',
            isConstrained: true,
            value: '5 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLineTo',
          },
        ],
      ],
      [
        'yLine(length',
        [
          {
            type: 'vertical',
            isConstrained: true,
            value: 'yLine',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLine',
          },
          {
            type: 'yRelative',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLine',
          },
        ],
      ],
      [
        'xLine(length',
        [
          {
            type: 'horizontal',
            isConstrained: true,
            value: 'xLine',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLine',
          },
          {
            type: 'xRelative',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLine',
          },
        ],
      ],
      [
        'angledLineOfXLength',
        [
          {
            type: 'angle',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfXLength',
          },
          {
            type: 'xRelative',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'length' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfXLength',
          },
        ],
      ],
      [
        'angledLineOfYLength',
        [
          {
            type: 'angle',
            isConstrained: true,
            value: '30 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfYLength',
          },
          {
            type: 'yRelative',
            isConstrained: true,
            value: '3 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'length' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfYLength',
          },
        ],
      ],
      [
        'angledLineToX',
        [
          {
            type: 'angle',
            isConstrained: true,
            value: '12.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToX',
          },
          {
            type: 'xAbsolute',
            isConstrained: true,
            value: '12 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'to' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToX',
          },
        ],
      ],
      [
        'angledLineToY',
        [
          {
            type: 'angle',
            isConstrained: true,
            value: '30 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToY',
          },
          {
            type: 'yAbsolute',
            isConstrained: true,
            value: '10.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'to' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToY',
          },
        ],
      ],
      [
        'angledLineThatIntersects',
        [
          {
            type: 'angle',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineThatIntersects',
          },
          {
            type: 'intersectionOffset',
            isConstrained: true,
            value: '0 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'objectProperty', key: 'offset' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineThatIntersects',
          },
          {
            type: 'intersectionTag',
            isConstrained: false,
            value: 'a',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { key: 'intersectTag', type: 'objectProperty' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineThatIntersects',
          },
        ],
      ],
      [
        'tangentialArcTo',
        [
          {
            type: 'tangentialWithPrevious',
            isConstrained: true,
            value: 'tangentialArcTo',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
          {
            type: 'xAbsolute',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
          {
            type: 'yAbsolute',
            isConstrained: true,
            value: '13.14 + 0',
            sourceRange: [expect.any(Number), expect.any(Number), 0],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
        ],
      ],
    ])('testing %s when inputs are unconstrained', (functionName, expected) => {
      const ast = assertParse(code)
      const start = code.indexOf(functionName)
      expect(start).toBeGreaterThanOrEqual(0)
      const sourceRange = topLevelRange(start, start + functionName.length)
      if (err(ast)) return ast
      const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
      const callExp = getNodeFromPath<Node<CallExpression | CallExpressionKw>>(
        ast,
        pathToNode,
        ['CallExpression', 'CallExpressionKw']
      )
      if (err(callExp)) return callExp

      const result =
        callExp.node.type === 'CallExpression'
          ? getConstraintInfo(callExp.node, code, pathToNode)
          : getConstraintInfoKw(callExp.node, code, pathToNode)
      expect(result).toEqual(expected)
    })
  })
})
