import {
  changeSketchArguments,
  addTagForSketchOnFace,
  addNewSketchLn,
  getYComponent,
  getXComponent,
  addCloseToPipe,
  getConstraintInfo,
} from './sketch'
import {
  assertParse,
  recast,
  initPromise,
  SourceRange,
  CallExpression,
} from '../wasm'
import { getNodeFromPath, getNodePathFromSourceRange } from '../queryAst'
import { enginelessExecutor } from '../../lib/testHelpers'
import { err } from 'lib/trap'
import { Node } from 'wasm-lib/kcl/bindings/Node'

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
  const lineToChange = 'lineTo([-1.59, -1.54], %)'
  const lineAfterChange = 'lineTo([2, 3], %)'
  test('changeSketchArguments', async () => {
    // Enable rotations #152
    const genCode = (line: string) => `mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> ${line}
  |> lineTo([0.46, -5.82], %)
// |> rx(45, %)
`
    const code = genCode(lineToChange)
    const expectedCode = genCode(lineAfterChange)
    const ast = assertParse(code)

    const execState = await enginelessExecutor(ast)
    const sourceStart = code.indexOf(lineToChange)
    const changeSketchArgsRetVal = changeSketchArguments(
      ast,
      execState.memory,
      {
        type: 'sourceRange',
        sourceRange: [sourceStart, sourceStart + lineToChange.length],
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
  const lineToChange = 'lineTo([-1.59, -1.54], %)'
  test('addNewSketchLn', async () => {
    // Enable rotations #152
    const code = `
mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  // |> rx(45, %)
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)`
    const ast = assertParse(code)

    const execState = await enginelessExecutor(ast)
    const sourceStart = code.indexOf(lineToChange)
    expect(sourceStart).toBe(89)
    const newSketchLnRetVal = addNewSketchLn({
      node: ast,
      programMemory: execState.memory,
      input: {
        type: 'straight-segment',
        from: [0, 0],
        to: [2, 3],
      },
      fnName: 'lineTo',
      pathToNode: [
        ['body', ''],
        [0, 'index'],
        ['declarations', 'VariableDeclaration'],
        [0, 'index'],
        ['init', 'VariableDeclarator'],
      ],
    })
    if (err(newSketchLnRetVal)) return newSketchLnRetVal

    // Enable rotations #152
    let expectedCode = `mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  // |> rx(45, %)
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)
  |> lineTo([2, 3], %)
`

    const { modifiedAst } = newSketchLnRetVal
    expect(recast(modifiedAst)).toBe(expectedCode)

    const modifiedAst2 = addCloseToPipe({
      node: ast,
      programMemory: execState.memory,
      pathToNode: [
        ['body', ''],
        [0, 'index'],
        ['declarations', 'VariableDeclaration'],
        [0, 'index'],
        ['init', 'VariableDeclarator'],
      ],
    })
    if (err(modifiedAst2)) return modifiedAst2

    expectedCode = `mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  // |> rx(45, %)
  |> lineTo([-1.59, -1.54], %)
  |> lineTo([0.46, -5.82], %)
  |> close(%)
`
    expect(recast(modifiedAst2)).toBe(expectedCode)
  })
})

describe('testing addTagForSketchOnFace', () => {
  it('needs to be in it', async () => {
    const originalLine = 'lineTo([-1.59, -1.54], %)'
    // Enable rotations #152
    const genCode = (line: string) => `mySketch001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  // |> rx(45, %)
  |> ${line}
  |> lineTo([0.46, -5.82], %)
`
    const code = genCode(originalLine)
    const ast = assertParse(code)
    await enginelessExecutor(ast)
    const sourceStart = code.indexOf(originalLine)
    const sourceRange: [number, number] = [
      sourceStart,
      sourceStart + originalLine.length,
    ]
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
    const expectedCode = genCode('lineTo([-1.59, -1.54], %, $seg01)')
    expect(recast(modifiedAst)).toBe(expectedCode)
  })
  const chamferTestCases = [
    {
      desc: 'chamfer in pipeExpr',
      originalChamfer: `  |> chamfer({
       length = 30,
       tags = [seg01, getOppositeEdge(seg01)]
     }, %)`,
      expectedChamfer: `  |> chamfer({
       length = 30,
       tags = [getOppositeEdge(seg01)]
     }, %, $seg03)
  |> chamfer({ length = 30, tags = [seg01] }, %)`,
    },
    {
      desc: 'chamfer with its own variable',
      originalChamfer: `chamf = chamfer({
       length = 30,
       tags = [seg01, getOppositeEdge(seg01)]
     }, extrude001)`,
      expectedChamfer: `chamf = chamfer({
       length = 30,
       tags = [getOppositeEdge(seg01)]
     }, extrude001, $seg03)
  |> chamfer({ length = 30, tags = [seg01] }, %)`,
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
  |> lineTo([profileStartX(%), profileStartY(%)], %, $seg02)
  |> close(%)
extrude001 = extrude(100, sketch001)
${insertCode}
`
      const code = genCode(originalChamfer)
      const ast = assertParse(code)
      await enginelessExecutor(ast)
      const sourceStart = code.indexOf(originalChamfer)
      const extraChars = originalChamfer.indexOf('chamfer')
      const sourceRange: [number, number] = [
        sourceStart + extraChars,
        sourceStart + originalChamfer.length - extraChars,
      ]

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
  |> line([3, 4], %)
  |> angledLine({
    angle = 3.14,
    length = 3.14,
  }, %)
  |> lineTo([6.14, 3.14], %)
  |> xLineTo(8, %)
  |> yLineTo(5, %)
  |> yLine(3.14, %, $a)
  |> xLine(3.14, %)
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
    const ast = assertParse(code)
    test.each([
      [
        'line',
        [
          {
            type: 'xRelative',
            isConstrained: false,
            value: '3',
            sourceRange: [78, 79],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'line',
          },
          {
            type: 'yRelative',
            isConstrained: false,
            value: '4',
            sourceRange: [81, 82],
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
            sourceRange: [118, 122],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
          {
            type: 'length',
            isConstrained: false,
            value: '3.14',
            sourceRange: [137, 141],
            argPosition: { type: 'objectProperty', key: 'length' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
        ],
      ],
      [
        'lineTo',
        [
          {
            type: 'xAbsolute',
            isConstrained: false,
            value: '6.14',
            sourceRange: [164, 168],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'lineTo',
          },
          {
            type: 'yAbsolute',
            isConstrained: false,
            value: '3.14',
            sourceRange: [170, 174],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'lineTo',
          },
        ],
      ],
      [
        'xLineTo',
        [
          {
            type: 'horizontal',
            isConstrained: true,
            value: 'xLineTo',
            sourceRange: [185, 192],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLineTo',
          },
          {
            type: 'xAbsolute',
            isConstrained: false,
            value: '8',
            sourceRange: [193, 194],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLineTo',
          },
        ],
      ],
      [
        'yLineTo',
        [
          {
            type: 'vertical',
            isConstrained: true,
            value: 'yLineTo',
            sourceRange: [204, 211],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLineTo',
          },
          {
            type: 'yAbsolute',
            isConstrained: false,
            value: '5',
            sourceRange: [212, 213],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLineTo',
          },
        ],
      ],
      [
        'yLine(',
        [
          {
            type: 'vertical',
            isConstrained: true,
            value: 'yLine',
            sourceRange: [223, 228],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLine',
          },
          {
            type: 'yRelative',
            isConstrained: false,
            value: '3.14',
            sourceRange: [229, 233],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLine',
          },
        ],
      ],
      [
        'xLine(',
        [
          {
            type: 'horizontal',
            isConstrained: true,
            value: 'xLine',
            sourceRange: [247, 252],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLine',
          },
          {
            type: 'xRelative',
            isConstrained: false,
            value: '3.14',
            sourceRange: [253, 257],
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
            sourceRange: [301, 305],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfXLength',
          },
          {
            type: 'xRelative',
            isConstrained: false,
            value: '3.14',
            sourceRange: [320, 324],
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
            sourceRange: [373, 375],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfYLength',
          },
          {
            type: 'yRelative',
            isConstrained: false,
            value: '3',
            sourceRange: [390, 391],
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
            sourceRange: [434, 439],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToX',
          },
          {
            type: 'xAbsolute',
            isConstrained: false,
            value: '12',
            sourceRange: [450, 452],
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
            sourceRange: [495, 497],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToY',
          },
          {
            type: 'yAbsolute',
            isConstrained: false,
            value: '10.14',
            sourceRange: [508, 513],
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
            sourceRange: [567, 571],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineThatIntersects',
          },
          {
            type: 'intersectionOffset',
            isConstrained: false,
            value: '0',
            sourceRange: [608, 609],
            argPosition: { type: 'objectProperty', key: 'offset' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineThatIntersects',
          },
          {
            type: 'intersectionTag',
            isConstrained: false,
            value: 'a',
            sourceRange: [592, 593],
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
            sourceRange: [623, 638],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
          {
            type: 'xAbsolute',
            isConstrained: false,
            value: '3.14',
            sourceRange: [640, 644],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
          {
            type: 'yAbsolute',
            isConstrained: false,
            value: '13.14',
            sourceRange: [646, 651],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
        ],
      ],
    ])('testing %s when inputs are unconstrained', (functionName, expected) => {
      const sourceRange: SourceRange = [
        code.indexOf(functionName),
        code.indexOf(functionName) + functionName.length,
      ]
      if (err(ast)) return ast
      const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
      const callExp = getNodeFromPath<Node<CallExpression>>(
        ast,
        pathToNode,
        'CallExpression'
      )
      if (err(callExp)) return callExp
      const result = getConstraintInfo(callExp.node, code, pathToNode)
      expect(result).toEqual(expected)
    })
  })
  describe('array notation', () => {
    const code = `const part001 = startSketchOn('-XZ')
    |> startProfileAt([0, 0], %)
    |> line([3, 4], %)
    |> angledLine([3.14, 3.14], %)
    |> lineTo([6.14, 3.14], %)
    |> xLineTo(8, %)
    |> yLineTo(5, %)
    |> yLine(3.14, %, $a)
    |> xLine(3.14, %)
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
    const ast = assertParse(code)
    test.each([
      [
        `angledLine(`,
        [
          {
            type: 'angle',
            isConstrained: false,
            value: '3.14',
            sourceRange: [112, 116],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
          {
            type: 'length',
            isConstrained: false,
            value: '3.14',
            sourceRange: [118, 122],
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
            sourceRange: [277, 281],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfXLength',
          },
          {
            type: 'xRelative',
            isConstrained: false,
            value: '3.14',
            sourceRange: [283, 287],
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
            sourceRange: [321, 323],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfYLength',
          },
          {
            type: 'yRelative',
            isConstrained: false,
            value: '3',
            sourceRange: [325, 326],
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
            sourceRange: [354, 356],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToX',
          },
          {
            type: 'xAbsolute',
            isConstrained: false,
            value: '12',
            sourceRange: [358, 360],
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
            sourceRange: [388, 390],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToY',
          },
          {
            type: 'yAbsolute',
            isConstrained: false,
            value: '10',
            sourceRange: [392, 394],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToY',
          },
        ],
      ],
    ])('testing %s when inputs are unconstrained', (functionName, expected) => {
      const sourceRange: SourceRange = [
        code.indexOf(functionName),
        code.indexOf(functionName) + functionName.length,
      ]
      if (err(ast)) return ast
      const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
      const callExp = getNodeFromPath<Node<CallExpression>>(
        ast,
        pathToNode,
        'CallExpression'
      )
      if (err(callExp)) return callExp
      const result = getConstraintInfo(callExp.node, code, pathToNode)
      expect(result).toEqual(expected)
    })
  })
  describe('constrained', () => {
    const code = `const part001 = startSketchOn('-XZ')
    |> startProfileAt([0, 0], %)
    |> line([3 + 0, 4 + 0], %)
    |> angledLine({ angle = 3.14 + 0, length = 3.14 + 0 }, %)
    |> lineTo([6.14 + 0, 3.14 + 0], %)
    |> xLineTo(8 + 0, %)
    |> yLineTo(5 + 0, %)
    |> yLine(3.14 + 0, %, $a)
    |> xLine(3.14 + 0, %)
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
    const ast = assertParse(code)
    test.each([
      [
        'line',
        [
          {
            type: 'xRelative',
            isConstrained: true,
            value: '3 + 0',
            sourceRange: [83, 88],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'line',
          },
          {
            type: 'yRelative',
            isConstrained: true,
            value: '4 + 0',
            sourceRange: [90, 95],
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
            sourceRange: [129, 137],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
          {
            type: 'length',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [148, 156],
            argPosition: { type: 'objectProperty', key: 'length' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLine',
          },
        ],
      ],
      [
        'lineTo',
        [
          {
            type: 'xAbsolute',
            isConstrained: true,
            value: '6.14 + 0',
            sourceRange: [178, 186],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'lineTo',
          },
          {
            type: 'yAbsolute',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [188, 196],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'lineTo',
          },
        ],
      ],
      [
        'xLineTo',
        [
          {
            type: 'horizontal',
            isConstrained: true,
            value: 'xLineTo',
            sourceRange: [209, 216],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLineTo',
          },
          {
            type: 'xAbsolute',
            isConstrained: true,
            value: '8 + 0',
            sourceRange: [217, 222],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLineTo',
          },
        ],
      ],
      [
        'yLineTo',
        [
          {
            type: 'vertical',
            isConstrained: true,
            value: 'yLineTo',
            sourceRange: [234, 241],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLineTo',
          },
          {
            type: 'yAbsolute',
            isConstrained: true,
            value: '5 + 0',
            sourceRange: [242, 247],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLineTo',
          },
        ],
      ],
      [
        'yLine(',
        [
          {
            type: 'vertical',
            isConstrained: true,
            value: 'yLine',
            sourceRange: [259, 264],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLine',
          },
          {
            type: 'yRelative',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [265, 273],
            argPosition: { type: 'singleValue' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'yLine',
          },
        ],
      ],
      [
        'xLine(',
        [
          {
            type: 'horizontal',
            isConstrained: true,
            value: 'xLine',
            sourceRange: [289, 294],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'xLine',
          },
          {
            type: 'xRelative',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [295, 303],
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
            sourceRange: [345, 353],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfXLength',
          },
          {
            type: 'xRelative',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [364, 372],
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
            sourceRange: [416, 422],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineOfYLength',
          },
          {
            type: 'yRelative',
            isConstrained: true,
            value: '3 + 0',
            sourceRange: [433, 438],
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
            sourceRange: [476, 485],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToX',
          },
          {
            type: 'xAbsolute',
            isConstrained: true,
            value: '12 + 0',
            sourceRange: [492, 498],
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
            sourceRange: [536, 542],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineToY',
          },
          {
            type: 'yAbsolute',
            isConstrained: true,
            value: '10.14 + 0',
            sourceRange: [549, 558],
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
            sourceRange: [616, 624],
            argPosition: { type: 'objectProperty', key: 'angle' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineThatIntersects',
          },
          {
            type: 'intersectionOffset',
            isConstrained: true,
            value: '0 + 0',
            sourceRange: [671, 676],
            argPosition: { type: 'objectProperty', key: 'offset' },
            pathToNode: expect.any(Array),
            stdLibFnName: 'angledLineThatIntersects',
          },
          {
            type: 'intersectionTag',
            isConstrained: false,
            value: 'a',
            sourceRange: [650, 651],
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
            sourceRange: [697, 712],
            argPosition: undefined,
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
          {
            type: 'xAbsolute',
            isConstrained: true,
            value: '3.14 + 0',
            sourceRange: [714, 722],
            argPosition: { type: 'arrayItem', index: 0 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
          {
            type: 'yAbsolute',
            isConstrained: true,
            value: '13.14 + 0',
            sourceRange: [724, 733],
            argPosition: { type: 'arrayItem', index: 1 },
            pathToNode: expect.any(Array),
            stdLibFnName: 'tangentialArcTo',
          },
        ],
      ],
    ])('testing %s when inputs are unconstrained', (functionName, expected) => {
      const sourceRange: SourceRange = [
        code.indexOf(functionName),
        code.indexOf(functionName) + functionName.length,
      ]
      if (err(ast)) return ast
      const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
      const callExp = getNodeFromPath<Node<CallExpression>>(
        ast,
        pathToNode,
        'CallExpression'
      )
      if (err(callExp)) return callExp

      const result = getConstraintInfo(callExp.node, code, pathToNode)
      expect(result).toEqual(expected)
    })
  })
})
