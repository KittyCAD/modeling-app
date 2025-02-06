import fs from 'node:fs'

import {
  assertParse,
  ProgramMemory,
  Sketch,
  initPromise,
  sketchFromKclValue,
  defaultArtifactGraph,
  topLevelRange,
} from './wasm'
import { enginelessExecutor } from '../lib/testHelpers'
import { KCLError } from './errors'

beforeAll(async () => {
  await initPromise
})

describe('test executor', () => {
  it('test assigning two variables, the second summing with the first', async () => {
    const code = `const myVar = 5
const newVar = myVar + 1`
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(5)
    expect(mem.get('newVar')?.value).toBe(6)
  })
  it('test assigning a var with a string', async () => {
    const code = `const myVar = "a str"`
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe('a str')
  })
  it('test assigning a var by cont concatenating two strings string execute', async () => {
    const code = fs.readFileSync(
      './src/lang/testExamples/variableDeclaration.cado',
      'utf-8'
    )
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe('a str another str')
  })
  it('fn funcN = () => {} execute', async () => {
    const mem = await exe(
      [
        'fn funcN = (a, b) => {',
        '  return a + b',
        '}',
        'const theVar = 60',
        'const magicNum = funcN(9, theVar)',
      ].join('\n')
    )
    expect(mem.get('theVar')?.value).toBe(60)
    expect(mem.get('magicNum')?.value).toBe(69)
  })
  it('sketch declaration', async () => {
    let code = `const mySketch = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> line(endAbsolute = [0,2], tag = $myPath)
  |> line(endAbsolute = [2,3])
  |> line(endAbsolute = [5,-1], tag = $rightPath)
  // |> close()
`
    const mem = await exe(code)
    // geo is three js buffer geometry and is very bloated to have in tests
    const sk = mem.get('mySketch')
    expect(sk?.type).toEqual('Sketch')
    if (sk?.type !== 'Sketch') {
      return
    }

    const minusGeo = sk?.value?.paths
    expect(minusGeo).toEqual([
      {
        type: 'ToPoint',
        to: [0, 2],
        from: [0, 0],
        __geoMeta: {
          sourceRange: [expect.any(Number), expect.any(Number), 0],
          id: expect.any(String),
        },
        tag: {
          end: 111,
          start: 104,
          type: 'TagDeclarator',
          value: 'myPath',
        },
      },
      {
        type: 'ToPoint',
        to: [2, 3],
        from: [0, 2],
        tag: null,
        __geoMeta: {
          sourceRange: [expect.any(Number), expect.any(Number), 0],
          id: expect.any(String),
        },
      },
      {
        type: 'ToPoint',
        to: [5, -1],
        from: [2, 3],
        __geoMeta: {
          sourceRange: [expect.any(Number), expect.any(Number), 0],
          id: expect.any(String),
        },
        tag: {
          end: 192,
          start: 182,
          type: 'TagDeclarator',
          value: 'rightPath',
        },
      },
    ])
  })

  it('pipe binary expression into call expression', async () => {
    const code = [
      'fn myFn = (a) => { return a + 1 }',
      'const myVar = 5 + 1 |> myFn(%)',
    ].join('\n')
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(7)
  })

  // Enable rotations #152
  // it('rotated sketch', async () => {
  //   const code = [
  //     'const mySk1 = startSketchAt([0,0])',
  //     '  |> line(endAbsolute = [1,1])',
  //     '  |> line(endAbsolute = [0, 1], tag = "myPath")',
  //     '  |> line(endAbsolute = [1, 1])',
  //     'const rotated = rx(90, mySk1)',
  //   ].join('\n')
  //   const mem = await exe(code)
  //   expect(mem.get('mySk1')?.value).toHaveLength(3)
  //   expect(mem.get('rotated')?.type).toBe('Sketch')
  //   if (
  //     mem.get('mySk1')?.type !== 'Sketch' ||
  //     mem.get('rotated')?.type !== 'Sketch'
  //   )
  //     throw new Error('not a sketch')
  //   expect(mem.get('mySk1')?.rotation).toEqual([0, 0, 0, 1])
  //   expect(mem.get('rotated')?.rotation.map((a) => a.toFixed(4))).toEqual([
  //     '0.7071',
  //     '0.0000',
  //     '0.0000',
  //     '0.7071',
  //   ])
  // })

  it('execute pipe sketch into call expression', async () => {
    // Enable rotations #152
    const code = [
      "const mySk1 = startSketchOn('XY')",
      '  |> startProfileAt([0,0], %)',
      '  |> line(endAbsolute = [1,1])',
      '  |> line(endAbsolute = [0, 1], tag = $myPath)',
      '  |> line(endAbsolute = [1,1])',
      // '  |> rx(90, %)',
    ].join('\n')
    const mem = await exe(code)
    expect(mem.get('mySk1')).toEqual({
      type: 'Sketch',
      value: {
        type: 'Sketch',
        on: expect.any(Object),
        start: {
          to: [0, 0],
          from: [0, 0],
          tag: null,
          __geoMeta: {
            id: expect.any(String),
            sourceRange: [expect.any(Number), expect.any(Number), 0],
          },
        },
        tags: {
          myPath: {
            __meta: [
              {
                sourceRange: [expect.any(Number), expect.any(Number), 0],
              },
            ],
            type: 'TagIdentifier',
            value: 'myPath',
            info: expect.any(Object),
          },
        },
        paths: [
          {
            type: 'ToPoint',
            to: [1, 1],
            from: [0, 0],
            tag: null,
            __geoMeta: {
              sourceRange: [expect.any(Number), expect.any(Number), 0],
              id: expect.any(String),
            },
          },
          {
            type: 'ToPoint',
            to: [0, 1],
            from: [1, 1],
            __geoMeta: {
              sourceRange: [expect.any(Number), expect.any(Number), 0],
              id: expect.any(String),
            },
            tag: {
              end: 140,
              start: 133,
              type: 'TagDeclarator',
              value: 'myPath',
            },
          },
          {
            type: 'ToPoint',
            to: [1, 1],
            from: [0, 1],
            tag: null,
            __geoMeta: {
              sourceRange: [expect.any(Number), expect.any(Number), 0],
              id: expect.any(String),
            },
          },
        ],
        id: expect.any(String),
        artifactId: expect.any(String),
        units: {
          type: 'Mm',
        },
        __meta: [{ sourceRange: [expect.any(Number), expect.any(Number), 0] }],
      },
    })
  })
  it('execute array expression', async () => {
    const code = ['const three = 3', "const yo = [1, '2', three, 4 + 5]"].join(
      '\n'
    )
    const mem = await exe(code)
    // TODO path to node is probably wrong here, zero indexes are not correct
    expect(mem.get('three')).toEqual({
      type: 'Number',
      value: 3,
      __meta: [
        {
          sourceRange: [14, 15, 0],
        },
      ],
    })
    expect(mem.get('yo')).toEqual({
      type: 'Array',
      value: [
        { type: 'Number', value: 1, __meta: [{ sourceRange: [28, 29, 0] }] },
        { type: 'String', value: '2', __meta: [{ sourceRange: [31, 34, 0] }] },
        { type: 'Number', value: 3, __meta: [{ sourceRange: [14, 15, 0] }] },
        {
          type: 'Number',
          value: 9,
          __meta: [{ sourceRange: [43, 44, 0] }, { sourceRange: [47, 48, 0] }],
        },
      ],
      __meta: [
        {
          sourceRange: [27, 49, 0],
        },
      ],
    })
    // Check that there are no other variables or environments.
    expect(mem.numEnvironments()).toBe(1)
    expect(mem.numVariables(0)).toBe(2)
  })
  it('execute object expression', async () => {
    const code = [
      'const three = 3',
      "const yo = {aStr: 'str', anum: 2, identifier: three, binExp: 4 + 5}",
    ].join('\n')
    const mem = await exe(code)
    expect(mem.get('yo')).toEqual({
      type: 'Object',
      value: {
        aStr: {
          type: 'String',
          value: 'str',
          __meta: [{ sourceRange: [34, 39, 0] }],
        },
        anum: {
          type: 'Number',
          value: 2,
          __meta: [{ sourceRange: [47, 48, 0] }],
        },
        identifier: {
          type: 'Number',
          value: 3,
          __meta: [{ sourceRange: [14, 15, 0] }],
        },
        binExp: {
          type: 'Number',
          value: 9,
          __meta: [{ sourceRange: [77, 78, 0] }, { sourceRange: [81, 82, 0] }],
        },
      },
      __meta: [
        {
          sourceRange: [27, 83, 0],
        },
      ],
    })
  })
  it('execute memberExpression', async () => {
    const code = ["const yo = {a: {b: '123'}}", "const myVar = yo.a['b']"].join(
      '\n'
    )
    const mem = await exe(code)
    expect(mem.get('myVar')).toEqual({
      type: 'String',
      value: '123',
      __meta: [
        {
          sourceRange: [19, 24, 0],
        },
      ],
    })
  })
})

describe('testing math operators', () => {
  it('can sum', async () => {
    const code = ['const myVar = 1 + 2'].join('\n')
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(3)
  })
  it('can subtract', async () => {
    const code = ['const myVar = 1 - 2'].join('\n')
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(-1)
  })
  it('can multiply', async () => {
    const code = ['const myVar = 1 * 2'].join('\n')
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(2)
  })
  it('can divide', async () => {
    const code = ['const myVar = 1 / 2'].join('\n')
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(0.5)
  })
  it('can modulus', async () => {
    const code = ['const myVar = 5 % 2'].join('\n')
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(1)
  })
  it('can do multiple operations', async () => {
    const code = ['const myVar = 1 + 2 * 3'].join('\n')
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(7)
  })
  it('big example with parans', async () => {
    const code = ['const myVar = 1 + 2 * (3 - 4) / -5 + 6'].join('\n')
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(7.4)
  })
  it('with identifier', async () => {
    const code = ['const yo = 6', 'const myVar = yo / 2'].join('\n')
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(3)
  })
  it('with lots of testing', async () => {
    const code = ['const myVar = 2 * ((2 + 3 ) / 4 + 5)'].join('\n')
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(12.5)
  })
  it('with callExpression at start', async () => {
    const code = 'const myVar = min(4, 100) + 2'
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(6)
  })
  it('with callExpression at end', async () => {
    const code = 'const myVar = 2 + min(4, 100)'
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(6)
  })
  it('with nested callExpression', async () => {
    const code = 'const myVar = 2 + min(100, legLen(5, 3))'
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(6)
  })
  it('with unaryExpression', async () => {
    const code = 'const myVar = -min(100, 3)'
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(-3)
  })
  it('with unaryExpression in callExpression', async () => {
    const code = 'const myVar = min(-legLen(5, 4), 5)'
    const code2 = 'const myVar = min(5 , -legLen(5, 4))'
    const mem = await exe(code)
    const mem2 = await exe(code2)
    expect(mem.get('myVar')?.value).toBe(-3)
    expect(mem.get('myVar')?.value).toBe(mem2.get('myVar')?.value)
  })
  it('with unaryExpression in ArrayExpression', async () => {
    const code = 'const myVar = [1,-legLen(5, 4)]'
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toEqual([
      {
        __meta: [
          {
            sourceRange: [15, 16, 0],
          },
        ],
        type: 'Number',
        value: 1,
      },
      {
        __meta: [
          {
            sourceRange: [17, 30, 0],
          },
        ],
        type: 'Number',
        value: -3,
      },
    ])
  })
  it('with unaryExpression in ArrayExpression in CallExpression, checking nothing funny happens when used in a sketch', async () => {
    const code = [
      "const part001 = startSketchOn('XY')",
      '  |> startProfileAt([0, 0], %)',
      '|> line(end = [-2.21, -legLen(5, min(3, 999))])',
    ].join('\n')
    const mem = await exe(code)
    const sketch = sketchFromKclValue(mem.get('part001'), 'part001')
    // result of `-legLen(5, min(3, 999))` should be -4
    const yVal = (sketch as Sketch).paths?.[0]?.to?.[1]
    expect(yVal).toBe(-4)
  })
  it('test that % substitution feeds down CallExp->ArrExp->UnaryExp->CallExp', async () => {
    const code = [
      `const myVar = 3`,
      `const part001 = startSketchOn('XY')`,
      `  |> startProfileAt([0, 0], %)`,
      `  |> line(end = [3, 4], tag = $seg01)`,
      `  |> line(end = [`,
      `  min(segLen(seg01), myVar),`,
      `  -legLen(segLen(seg01), myVar)`,
      `])`,
      ``,
    ].join('\n')
    const mem = await exe(code)
    const sketch = sketchFromKclValue(mem.get('part001'), 'part001')
    // expect -legLen(segLen('seg01'), myVar) to equal -4 setting the y value back to 0
    expect((sketch as Sketch).paths?.[1]?.from).toEqual([3, 4])
    expect((sketch as Sketch).paths?.[1]?.to).toEqual([6, 0])
    const removedUnaryExp = code.replace(
      `-legLen(segLen(seg01), myVar)`,
      `legLen(segLen(seg01), myVar)`
    )
    const removedUnaryExpMem = await exe(removedUnaryExp)
    const removedUnaryExpMemSketch = sketchFromKclValue(
      removedUnaryExpMem.get('part001'),
      'part001'
    )

    // without the minus sign, the y value should be 8
    expect((removedUnaryExpMemSketch as Sketch).paths?.[1]?.to).toEqual([6, 8])
  })
  it('with nested callExpression and binaryExpression', async () => {
    const code = 'const myVar = 2 + min(100, -1 + legLen(5, 3))'
    const mem = await exe(code)
    expect(mem.get('myVar')?.value).toBe(5)
  })
  it('can do power of math', async () => {
    const code = 'const myNeg2 = 4 ^ 2 - 3 ^ 2 * 2'
    const mem = await exe(code)
    expect(mem.get('myNeg2')?.value).toBe(-2)
  })
})

describe('Testing Errors', () => {
  it('should throw an error when a variable is not defined', async () => {
    const code = `const myVar = 5
const theExtrude = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line(end = [-2.4, 5])
  |> line(end = myVarZ)
  |> line(end = [5,5])
  |> close()
  |> extrude(length = 4)`
    await expect(exe(code)).rejects.toEqual(
      new KCLError(
        'undefined_value',
        'memory item key `myVarZ` is not defined',
        topLevelRange(129, 135),
        [],
        [],
        defaultArtifactGraph()
      )
    )
  })
})

// helpers

async function exe(
  code: string,
  programMemory: ProgramMemory = ProgramMemory.empty()
) {
  const ast = assertParse(code)

  const execState = await enginelessExecutor(ast, programMemory)
  return execState.memory
}
