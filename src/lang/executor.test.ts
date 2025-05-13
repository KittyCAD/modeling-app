import fs from 'node:fs'

import { KCLError } from '@src/lang/errors'
import { topLevelRange } from '@src/lang/util'
import type { Sketch } from '@src/lang/wasm'
import { assertParse, sketchFromKclValue } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import { enginelessExecutor } from '@src/lib/testHelpers'

beforeAll(async () => {
  await initPromise
})

describe('test executor', () => {
  it('test assigning two variables, the second summing with the first', async () => {
    const code = `myVar = 5
newVar = myVar + 1`
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(5)
    expect(mem['newVar']?.value).toBe(6)
  })
  it('test assigning a var with a string', async () => {
    const code = `myVar = "a str"`
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe('a str')
  })
  it('test assigning a var by cont concatenating two strings string execute', async () => {
    const code = fs.readFileSync(
      './src/lang/testExamples/variableDeclaration.cado',
      'utf-8'
    )
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe('a str another str')
  })
  it('fn funcN() {} execute', async () => {
    const mem = await exe(
      [
        'fn funcN(a, b) {',
        '  return a + b',
        '}',
        'theVar = 60',
        'magicNum = funcN(a = 9, b = theVar)',
      ].join('\n')
    )
    expect(mem['theVar']?.value).toBe(60)
    expect(mem['magicNum']?.value).toBe(69)
  })
  it('sketch declaration', async () => {
    let code = `mySketch = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> line(endAbsolute = [0,2], tag = $myPath)
  |> line(endAbsolute = [2,3])
  |> line(endAbsolute = [5,-1], tag = $rightPath)
  // |> close()
`
    const mem = await exe(code)
    // geo is three js buffer geometry and is very bloated to have in tests
    const sk = mem['mySketch']
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
        units: { type: 'Mm' },
        __geoMeta: {
          sourceRange: [expect.any(Number), expect.any(Number), 0],
          id: expect.any(String),
        },
        tag: {
          end: 103,
          start: 96,
          commentStart: expect.any(Number),
          type: 'TagDeclarator',
          value: 'myPath',
        },
      },
      {
        type: 'ToPoint',
        to: [2, 3],
        from: [0, 2],
        units: { type: 'Mm' },
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
        units: { type: 'Mm' },
        __geoMeta: {
          sourceRange: [expect.any(Number), expect.any(Number), 0],
          id: expect.any(String),
        },
        tag: {
          end: 184,
          start: 174,
          commentStart: expect.any(Number),
          type: 'TagDeclarator',
          value: 'rightPath',
        },
      },
    ])
  })

  it('pipe binary expression into call expression', async () => {
    const code = [
      'fn myFn(@a) { return a + 1 }',
      'myVar = 5 + 1 |> myFn(%)',
    ].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(7)
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
  //   expect(mem['mySk1']?.value).toHaveLength(3)
  //   expect(mem['rotated')?.type).toBe('Sketch']
  //   if (
  //     mem['mySk1']?.type !== 'Sketch' ||
  //     mem['rotated']?.type !== 'Sketch'
  //   )
  //     throw new Error('not a sketch')
  //   expect(mem['mySk1']?.rotation).toEqual([0, 0, 0, 1])
  //   expect(mem['rotated']?.rotation.map((a) => a.toFixed(4))).toEqual([
  //     '0.7071',
  //     '0.0000',
  //     '0.0000',
  //     '0.7071',
  //   ])
  // })

  it('execute pipe sketch into call expression', async () => {
    // Enable rotations #152
    const code = [
      'mySk1 = startSketchOn(XY)',
      '  |> startProfile(at = [0,0])',
      '  |> line(endAbsolute = [1,1])',
      '  |> line(endAbsolute = [0, 1], tag = $myPath)',
      '  |> line(endAbsolute = [1,1])',
      // '  |> rx(90)',
    ].join('\n')
    const mem = await exe(code)
    expect(mem['mySk1']).toEqual({
      type: 'Sketch',
      value: {
        type: 'Sketch',
        on: expect.any(Object),
        start: {
          to: [0, 0],
          from: [0, 0],
          units: { type: 'Mm' },
          tag: null,
          __geoMeta: {
            id: expect.any(String),
            sourceRange: [expect.any(Number), expect.any(Number), 0],
          },
        },
        tags: {
          myPath: {
            type: 'TagIdentifier',
            value: 'myPath',
          },
        },
        paths: [
          {
            type: 'ToPoint',
            to: [1, 1],
            from: [0, 0],
            units: { type: 'Mm' },
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
            units: { type: 'Mm' },
            __geoMeta: {
              sourceRange: [expect.any(Number), expect.any(Number), 0],
              id: expect.any(String),
            },
            tag: {
              end: 132,
              start: 125,
              commentStart: expect.any(Number),
              type: 'TagDeclarator',
              value: 'myPath',
            },
          },
          {
            type: 'ToPoint',
            to: [1, 1],
            from: [0, 1],
            units: { type: 'Mm' },
            tag: null,
            __geoMeta: {
              sourceRange: [expect.any(Number), expect.any(Number), 0],
              id: expect.any(String),
            },
          },
        ],
        id: expect.any(String),
        originalId: expect.any(String),
        artifactId: expect.any(String),
        units: {
          type: 'Mm',
        },
      },
    })
  })
  it('execute array expression', async () => {
    const code = ['three = 3', "yo = [1, '2', three, 4 + 5]"].join('\n')
    const mem = await exe(code)
    // TODO path to node is probably wrong here, zero indexes are not correct
    expect(mem['three']).toEqual({
      type: 'Number',
      value: 3,
      ty: expect.any(Object),
    })
    expect(mem['yo']).toEqual({
      type: 'HomArray',
      value: [
        {
          type: 'Number',
          value: 1,
          ty: expect.any(Object),
        },
        { type: 'String', value: '2' },
        {
          type: 'Number',
          value: 3,
          ty: expect.any(Object),
        },
        {
          type: 'Number',
          value: 9,
          ty: expect.any(Object),
        },
      ],
    })
  })
  it('execute object expression', async () => {
    const code = [
      'three = 3',
      "yo = {aStr = 'str', anum = 2, identifier = three, binExp = 4 + 5}",
    ].join('\n')
    const mem = await exe(code)
    expect(mem['yo']).toEqual({
      type: 'Object',
      value: {
        aStr: {
          type: 'String',
          value: 'str',
        },
        anum: {
          type: 'Number',
          value: 2,
          ty: expect.any(Object),
        },
        identifier: {
          type: 'Number',
          value: 3,
          ty: expect.any(Object),
        },
        binExp: {
          type: 'Number',
          value: 9,
          ty: expect.any(Object),
        },
      },
    })
  })
  it('execute memberExpression', async () => {
    const code = ["yo = {a = {b = '123'}}", 'myVar = yo.a.b'].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']).toEqual({
      type: 'String',
      value: '123',
    })
  })
})

describe('testing math operators', () => {
  it('can sum', async () => {
    const code = ['myVar = 1 + 2'].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(3)
  })
  it('can subtract', async () => {
    const code = ['myVar = 1 - 2'].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(-1)
  })
  it('can multiply', async () => {
    const code = ['myVar = 1 * 2'].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(2)
  })
  it('can divide', async () => {
    const code = ['myVar = 1 / 2'].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(0.5)
  })
  it('can modulus', async () => {
    const code = ['myVar = 5 % 2'].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(1)
  })
  it('can do multiple operations', async () => {
    const code = ['myVar = 1 + 2 * 3'].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(7)
  })
  it('big example with parans', async () => {
    const code = ['myVar = 1 + 2 * (3 - 4) / -5 + 6'].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(7.4)
  })
  it('with identifier', async () => {
    const code = ['yo = 6', 'myVar = yo / 2'].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(3)
  })
  it('with lots of testing', async () => {
    const code = ['myVar = 2 * ((2 + 3 ) / 4 + 5)'].join('\n')
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(12.5)
  })
  it('with callExpression at start', async () => {
    const code = 'myVar = min([4, 100]) + 2'
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(6)
  })
  it('with callExpression at end', async () => {
    const code = 'myVar = 2 + min([4, 100])'
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(6)
  })
  it('with nested callExpression', async () => {
    const code = 'myVar = 2 + min([100, legLen(hypotenuse = 5, leg = 3)])'
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(6)
  })
  it('with unaryExpression', async () => {
    const code = 'myVar = -min([100, 3])'
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(-3)
  })
  it('with unaryExpression in callExpression', async () => {
    const code = 'myVar = min([-legLen(hypotenuse = 5, leg = 4), 5])'
    const code2 = 'myVar = min([5 , -legLen(hypotenuse = 5, leg = 4)])'
    const mem = await exe(code)
    const mem2 = await exe(code2)
    expect(mem['myVar']?.value).toBe(-3)
    expect(mem['myVar']?.value).toBe(mem2['myVar']?.value)
  })
  it('with unaryExpression in ArrayExpression', async () => {
    const code = 'myVar = [1,-legLen(hypotenuse = 5, leg = 4)]'
    const mem = await exe(code)
    expect(mem['myVar']?.value).toEqual([
      {
        type: 'Number',
        value: 1,
        ty: expect.any(Object),
      },
      {
        type: 'Number',
        value: -3,
        ty: expect.any(Object),
      },
    ])
  })
  it('with unaryExpression in ArrayExpression in CallExpression, checking nothing funny happens when used in a sketch', async () => {
    const code = [
      'part001 = startSketchOn(XY)',
      '  |> startProfile(at = [0, 0])',
      '|> line(end = [-2.21, -legLen(hypotenuse = 5, leg = min([3, 999]))])',
    ].join('\n')
    const mem = await exe(code)
    const sketch = sketchFromKclValue(mem['part001'], 'part001')
    // result of `-legLen(5, min([3, 999]))` should be -4
    const yVal = (sketch as Sketch).paths?.[0]?.to?.[1]
    expect(yVal).toBe(-4)
  })
  it('test that % substitution feeds down CallExp->ArrExp->UnaryExp->CallExp', async () => {
    const code = [
      `myVar = 3`,
      `part001 = startSketchOn(XY)`,
      `  |> startProfile(at = [0, 0])`,
      `  |> line(end = [3, 4], tag = $seg01)`,
      `  |> line(end = [`,
      `  min([segLen(seg01), myVar]),`,
      `  -legLen(hypotenuse = segLen(seg01), leg = myVar)`,
      `])`,
      ``,
    ].join('\n')
    const mem = await exe(code)
    const sketch = sketchFromKclValue(mem['part001'], 'part001')
    // expect -legLen(segLen('seg01'), myVar) to equal -4 setting the y value back to 0
    expect((sketch as Sketch).paths?.[1]?.from).toEqual([3, 4])
    expect((sketch as Sketch).paths?.[1]?.to).toEqual([6, 0])
    const removedUnaryExp = code.replace(
      `-legLen(hypotenuse = segLen(seg01), leg = myVar)`,
      `legLen(hypotenuse = segLen(seg01), leg = myVar)`
    )
    const removedUnaryExpMem = await exe(removedUnaryExp)
    const removedUnaryExpMemSketch = sketchFromKclValue(
      removedUnaryExpMem['part001'],
      'part001'
    )

    // without the minus sign, the y value should be 8
    expect((removedUnaryExpMemSketch as Sketch).paths?.[1]?.to).toEqual([6, 8])
  })
  it('with nested callExpression and binaryExpression', async () => {
    const code = 'myVar = 2 + min([100, -1 + legLen(hypotenuse = 5, leg = 3)])'
    const mem = await exe(code)
    expect(mem['myVar']?.value).toBe(5)
  })
  it('can do power of math', async () => {
    const code = 'myNeg2 = 4 ^ 2 - 3 ^ 2 * 2'
    const mem = await exe(code)
    expect(mem['myNeg2']?.value).toBe(-2)
  })
})

describe('Testing Errors', () => {
  it('should throw an error when a variable is not defined', async () => {
    const code = `myVar = 5
theExtrude = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [-2.4, 5])
  |> line(end = myVarZ)
  |> line(end = [5,5])
  |> close()
  |> extrude(length = 4)`
    await expect(exe(code)).rejects.toEqual(
      new KCLError(
        'undefined_value',
        '`myVarZ` is not defined',
        topLevelRange(115, 121),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        null
      )
    )
  })
})

// helpers

async function exe(code: string) {
  const ast = assertParse(code)

  const execState = await enginelessExecutor(ast, true, undefined)
  return execState.variables
}
