import fs from 'node:fs'

import { parse, ProgramMemory, SketchGroup } from './wasm'
import { enginelessExecutor } from '../lib/testHelpers'
import { KCLError } from './errors'

describe('test executor', () => {
  it('test assigning two variables, the second summing with the first', async () => {
    const code = `const myVar = 5
const newVar = myVar + 1`
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(5)
    expect(root.newVar.value).toBe(6)
  })
  it('test assigning a var with a string', async () => {
    const code = `const myVar = "a str"`
    const { root } = await exe(code)
    expect(root.myVar.value).toBe('a str')
  })
  it('test assigning a var by cont concatenating two strings string execute', async () => {
    const code = fs.readFileSync(
      './src/lang/testExamples/variableDeclaration.cado',
      'utf-8'
    )
    const { root } = await exe(code)
    expect(root.myVar.value).toBe('a str another str')
  })
  it('fn funcN = () => {} execute', async () => {
    const { root } = await exe(
      [
        'fn funcN = (a, b) => {',
        '  return a + b',
        '}',
        'const theVar = 60',
        'const magicNum = funcN(9, theVar)',
      ].join('\n')
    )
    expect(root.theVar.value).toBe(60)
    expect(root.magicNum.value).toBe(69)
  })
  it('sketch declaration', async () => {
    let code = `const mySketch = startSketchAt([0,0])
  |> lineTo({to: [0,2], tag: "myPath"}, %)
  |> lineTo([2,3], %)
  |> lineTo({ to: [5,-1], tag: "rightPath" }, %)
  // |> close(%)
show(mySketch)
`
    const { root, return: _return } = await exe(code)
    // geo is three js buffer geometry and is very bloated to have in tests
    const minusGeo = root.mySketch.value
    expect(minusGeo).toEqual([
      {
        type: 'toPoint',
        to: [0, 2],
        from: [0, 0],
        __geoMeta: {
          sourceRange: [43, 80],
          id: expect.any(String),
        },
        name: 'myPath',
      },
      {
        type: 'toPoint',
        to: [2, 3],
        from: [0, 2],
        name: '',
        __geoMeta: {
          sourceRange: [86, 102],
          id: expect.any(String),
        },
      },
      {
        type: 'toPoint',
        to: [5, -1],
        from: [2, 3],
        __geoMeta: {
          sourceRange: [108, 151],
          id: expect.any(String),
        },
        name: 'rightPath',
      },
    ])
    // expect(root.mySketch.sketch[0]).toEqual(root.mySketch.sketch[4].firstPath)
    expect(_return).toEqual([
      {
        type: 'Identifier',
        start: 174,
        end: 182,
        name: 'mySketch',
      },
    ])
  })

  it('pipe binary expression into call expression', async () => {
    const code = [
      'fn myFn = (a) => { return a + 1 }',
      'const myVar = 5 + 1 |> myFn(%)',
    ].join('\n')
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(7)
  })

  // Enable rotations #152
  // it('rotated sketch', async () => {
  //   const code = [
  //     'const mySk1 = startSketchAt([0,0])',
  //     '  |> lineTo([1,1], %)',
  //     '  |> lineTo({to: [0, 1], tag: "myPath"}, %)',
  //     '  |> lineTo([1, 1], %)',
  //     'const rotated = rx(90, mySk1)',
  //   ].join('\n')
  //   const { root } = await exe(code)
  //   expect(root.mySk1.value).toHaveLength(3)
  //   expect(root?.rotated?.type).toBe('SketchGroup')
  //   if (
  //     root?.mySk1?.type !== 'SketchGroup' ||
  //     root?.rotated?.type !== 'SketchGroup'
  //   )
  //     throw new Error('not a sketch group')
  //   expect(root.mySk1.rotation).toEqual([0, 0, 0, 1])
  //   expect(root.rotated.rotation.map((a) => a.toFixed(4))).toEqual([
  //     '0.7071',
  //     '0.0000',
  //     '0.0000',
  //     '0.7071',
  //   ])
  // })

  it('execute pipe sketch into call expression', async () => {
    // Enable rotations #152
    const code = [
      'const mySk1 = startSketchAt([0,0])',
      '  |> lineTo([1,1], %)',
      '  |> lineTo({to: [0, 1], tag: "myPath"}, %)',
      '  |> lineTo([1,1], %)',
      // '  |> rx(90, %)',
    ].join('\n')
    const { root } = await exe(code)
    expect(root.mySk1).toEqual({
      type: 'SketchGroup',
      start: {
        to: [0, 0],
        from: [0, 0],
        name: '',
        __geoMeta: {
          id: expect.any(String),
          sourceRange: [14, 34],
        },
      },
      value: [
        {
          type: 'toPoint',
          to: [1, 1],
          from: [0, 0],
          name: '',
          __geoMeta: {
            sourceRange: [40, 56],
            id: expect.any(String),
          },
        },
        {
          type: 'toPoint',
          to: [0, 1],
          from: [1, 1],
          __geoMeta: {
            sourceRange: [62, 100],
            id: expect.any(String),
          },
          name: 'myPath',
        },
        {
          type: 'toPoint',
          to: [1, 1],
          from: [0, 1],
          name: '',
          __geoMeta: {
            sourceRange: [106, 122],
            id: expect.any(String),
          },
        },
      ],
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      id: expect.any(String),
      __meta: [{ sourceRange: [14, 34] }],
    })
  })
  it('execute array expression', async () => {
    const code = ['const three = 3', "const yo = [1, '2', three, 4 + 5]"].join(
      '\n'
    )
    const { root } = await exe(code)
    // TODO path to node is probably wrong here, zero indexes are not correct
    expect(root).toEqual({
      three: {
        type: 'UserVal',
        value: 3,
        __meta: [
          {
            sourceRange: [14, 15],
          },
        ],
      },
      yo: {
        type: 'UserVal',
        value: [1, '2', 3, 9],
        __meta: [
          {
            sourceRange: [27, 49],
          },
        ],
      },
    })
  })
  it('execute object expression', async () => {
    const code = [
      'const three = 3',
      "const yo = {aStr: 'str', anum: 2, identifier: three, binExp: 4 + 5}",
    ].join('\n')
    const { root } = await exe(code)
    expect(root.yo).toEqual({
      type: 'UserVal',
      value: { aStr: 'str', anum: 2, identifier: 3, binExp: 9 },
      __meta: [
        {
          sourceRange: [27, 83],
        },
      ],
    })
  })
  it('execute memberExpression', async () => {
    const code = ["const yo = {a: {b: '123'}}", "const myVar = yo.a['b']"].join(
      '\n'
    )
    const { root } = await exe(code)
    expect(root.myVar).toEqual({
      type: 'UserVal',
      value: '123',
      __meta: [
        {
          sourceRange: [41, 50],
        },
      ],
    })
  })
})

describe('testing math operators', () => {
  it('can sum', async () => {
    const code = ['const myVar = 1 + 2'].join('\n')
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(3)
  })
  it('can subtract', async () => {
    const code = ['const myVar = 1 - 2'].join('\n')
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(-1)
  })
  it('can multiply', async () => {
    const code = ['const myVar = 1 * 2'].join('\n')
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(2)
  })
  it('can divide', async () => {
    const code = ['const myVar = 1 / 2'].join('\n')
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(0.5)
  })
  it('can modulus', async () => {
    const code = ['const myVar = 5 % 2'].join('\n')
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(1)
  })
  it('can do multiple operations', async () => {
    const code = ['const myVar = 1 + 2 * 3'].join('\n')
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(7)
  })
  it('big example with parans', async () => {
    const code = ['const myVar = 1 + 2 * (3 - 4) / -5 + 6'].join('\n')
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(7.4)
  })
  it('with identifier', async () => {
    const code = ['const yo = 6', 'const myVar = yo / 2'].join('\n')
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(3)
  })
  it('with lots of testing', async () => {
    const code = ['const myVar = 2 * ((2 + 3 ) / 4 + 5)'].join('\n')
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(12.5)
  })
  it('with callExpression at start', async () => {
    const code = 'const myVar = min(4, 100) + 2'
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(6)
  })
  it('with callExpression at end', async () => {
    const code = 'const myVar = 2 + min(4, 100)'
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(6)
  })
  it('with nested callExpression', async () => {
    const code = 'const myVar = 2 + min(100, legLen(5, 3))'
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(6)
  })
  it('with unaryExpression', async () => {
    const code = 'const myVar = -min(100, 3)'
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(-3)
  })
  it('with unaryExpression in callExpression', async () => {
    const code = 'const myVar = min(-legLen(5, 4), 5)'
    const code2 = 'const myVar = min(5 , -legLen(5, 4))'
    const { root } = await exe(code)
    const { root: root2 } = await exe(code2)
    expect(root.myVar.value).toBe(-3)
    expect(root.myVar.value).toBe(root2.myVar.value)
  })
  it('with unaryExpression in ArrayExpression', async () => {
    const code = 'const myVar = [1,-legLen(5, 4)]'
    const { root } = await exe(code)
    expect(root.myVar.value).toEqual([1, -3])
  })
  it('with unaryExpression in ArrayExpression in CallExpression, checking nothing funny happens when used in a sketch', async () => {
    const code = [
      'const part001 = startSketchAt([0, 0])',
      '|> line([-2.21, -legLen(5, min(3, 999))], %)',
    ].join('\n')
    const { root } = await exe(code)
    const sketch = root.part001
    // result of `-legLen(5, min(3, 999))` should be -4
    const yVal = (sketch as SketchGroup).value?.[0]?.to?.[1]
    expect(yVal).toBe(-4)
  })
  it('test that % substitution feeds down CallExp->ArrExp->UnaryExp->CallExp', async () => {
    const code = [
      `const myVar = 3`,
      `const part001 = startSketchAt([0, 0])`,
      `  |> line({ to: [3, 4], tag: 'seg01' }, %)`,
      `  |> line([`,
      `  min(segLen('seg01', %), myVar),`,
      `  -legLen(segLen('seg01', %), myVar)`,
      `], %)`,
      ``,
      `show(part001)`,
    ].join('\n')
    const { root } = await exe(code)
    const sketch = root.part001
    // expect -legLen(segLen('seg01', %), myVar) to equal -4 setting the y value back to 0
    expect((sketch as SketchGroup).value?.[1]?.from).toEqual([3, 4])
    expect((sketch as SketchGroup).value?.[1]?.to).toEqual([6, 0])
    const removedUnaryExp = code.replace(
      `-legLen(segLen('seg01', %), myVar)`,
      `legLen(segLen('seg01', %), myVar)`
    )
    const { root: removedUnaryExpRoot } = await exe(removedUnaryExp)
    const removedUnaryExpRootSketch = removedUnaryExpRoot.part001

    // without the minus sign, the y value should be 8
    expect((removedUnaryExpRootSketch as SketchGroup).value?.[1]?.to).toEqual([
      6, 8,
    ])
  })
  it('with nested callExpression and binaryExpression', async () => {
    const code = 'const myVar = 2 + min(100, -1 + legLen(5, 3))'
    const { root } = await exe(code)
    expect(root.myVar.value).toBe(5)
  })
})

describe('Testing Errors', () => {
  it('should throw an error when a variable is not defined', async () => {
    const code = `const myVar = 5
const theExtrude = startSketchAt([0, 0])
  |> line([-2.4, 5], %)
  |> line([-0.76], myVarZ, %)
  |> line([5,5], %)
  |> close(%)
  |> extrude(4, %)
show(theExtrude)`
    await expect(exe(code)).rejects.toEqual(
      new KCLError(
        'undefined_value',
        'memory item key `myVarZ` is not defined',
        [[100, 106]]
      )
    )
  })
})

// helpers

async function exe(
  code: string,
  programMemory: ProgramMemory = { root: {}, return: null }
) {
  const ast = parse(code)

  const result = await enginelessExecutor(ast, programMemory)
  return result
}
