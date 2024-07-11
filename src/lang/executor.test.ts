import fs from 'node:fs'

import { parse, ProgramMemory, SketchGroup, initPromise, Program } from './wasm'
import {
  MockEngineCommandManager,
  enginelessExecutor,
} from '../lib/testHelpers'
import { KCLError } from './errors'
import { executeAst } from './langHelpers'
import { EngineCommandManager } from './std/engineConnection'
import { getNodePathFromSourceRange } from './queryAst'

beforeAll(async () => {
  await initPromise
})

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
    let code = `const mySketch = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> lineTo([0,2], %, "myPath")
  |> lineTo([2,3], %)
  |> lineTo([5,-1], %, "rightPath")
  // |> close(%)
`
    const { root } = await exe(code)
    // geo is three js buffer geometry and is very bloated to have in tests
    const minusGeo = root.mySketch.value
    expect(minusGeo).toEqual([
      {
        type: 'ToPoint',
        to: [0, 2],
        from: [0, 0],
        __geoMeta: {
          sourceRange: [72, 98],
          id: expect.any(String),
        },
        tag: {
          end: 97,
          start: 89,
          type: 'TagDeclarator',
          value: 'myPath',
          digest: null,
        },
      },
      {
        type: 'ToPoint',
        to: [2, 3],
        from: [0, 2],
        tag: null,
        __geoMeta: {
          sourceRange: [104, 120],
          id: expect.any(String),
        },
      },
      {
        type: 'ToPoint',
        to: [5, -1],
        from: [2, 3],
        __geoMeta: {
          sourceRange: [126, 156],
          id: expect.any(String),
        },
        tag: {
          end: 155,
          start: 144,
          type: 'TagDeclarator',
          value: 'rightPath',
          digest: null,
        },
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

  it('execute pipe sketch into call expression', async () => {
    // Enable rotations #152
    const code = [
      "const mySk1 = startSketchOn('XY')",
      '  |> startProfileAt([0,0], %)',
      '  |> lineTo([1,1], %)',
      '  |> lineTo([0, 1], %, "myPath")',
      '  |> lineTo([1,1], %)',
      // '  |> rx(90, %)',
    ].join('\n')
    const { root } = await exe(code)
    expect(root.mySk1).toEqual({
      type: 'SketchGroup',
      on: expect.any(Object),
      start: {
        to: [0, 0],
        from: [0, 0],
        tag: null,
        __geoMeta: {
          id: expect.any(String),
          sourceRange: [39, 63],
        },
      },
      tags: {
        myPath: {
          __meta: [
            {
              sourceRange: [109, 117],
            },
          ],
          type: 'TagIdentifier',
          value: 'myPath',
        },
      },
      value: [
        {
          type: 'ToPoint',
          to: [1, 1],
          from: [0, 0],
          tag: null,
          __geoMeta: {
            sourceRange: [69, 85],
            id: expect.any(String),
          },
        },
        {
          type: 'ToPoint',
          to: [0, 1],
          from: [1, 1],
          __geoMeta: {
            sourceRange: [91, 118],
            id: expect.any(String),
          },
          tag: {
            end: 117,
            start: 109,
            type: 'TagDeclarator',
            value: 'myPath',
            digest: null,
          },
        },
        {
          type: 'ToPoint',
          to: [1, 1],
          from: [0, 1],
          tag: null,
          __geoMeta: {
            sourceRange: [124, 140],
            id: expect.any(String),
          },
        },
      ],
      id: expect.any(String),
      __meta: [{ sourceRange: [39, 63] }],
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
      "const part001 = startSketchOn('XY')",
      '  |> startProfileAt([0, 0], %)',
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
      `const part001 = startSketchOn('XY')`,
      `  |> startProfileAt([0, 0], %)`,
      `  |> line([3, 4], %, 'seg01')`,
      `  |> line([`,
      `  min(segLen('seg01', %), myVar),`,
      `  -legLen(segLen('seg01', %), myVar)`,
      `], %)`,
      ``,
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
const theExtrude = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([-2.4, 5], %)
  |> line([-0.76], myVarZ, %)
  |> line([5,5], %)
  |> close(%)
  |> extrude(4, %)`
    await expect(exe(code)).rejects.toEqual(
      new KCLError(
        'undefined_value',
        'memory item key `myVarZ` is not defined',
        [[129, 135]]
      )
    )
  })
})

describe('trying pathToNodeStuff', () => {
  it('source range should agree with path to node', async () => {
    const code = `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([7.72, 4.13], %)
  |> line([7.11, 3.48], %)
  |> line([-3.29, -13.86], %)
  |> close(%)
const sketch002 = startSketchOn('XY')
  |> startProfileAt([8.57, 5.92], %)
  |> line([13.28, 4], %)`
    const manager = new MockEngineCommandManager({
      setIsStreamReady: () => {},
      setMediaStream: () => {},
    }) as any as EngineCommandManager
    const ast = parse(code) as Program
    const yo = await executeAst({
      ast,
      engineCommandManager: manager,
      useFakeExecutor: true,
    })
    const sketch001 = yo.programMemory.root.sketch001 as SketchGroup
    let derivedPaths: [any, any, any][] = sketch001.value.map(
      ({ __geoMeta }) => {
        return [
          getNodePathFromSourceRange(ast, __geoMeta.sourceRange).map((a) => [
            String(a[0]),
            a[1],
          ]),
          __geoMeta.pathToNode,
          __geoMeta.sourceRange,
        ]
      }
    )
    let snippets = [
      'line([7.11, 3.48], %)',
      'line([-3.29, -13.86], %)',
      'close(%)',
    ]
    for (const [
      index,
      [sourcePath, wasmPath, range],
    ] of derivedPaths.entries()) {
      expect(sourcePath).toEqual(wasmPath)
      const codeSlice = code.slice(range[0], range[1])
      expect(snippets[index]).toBe(codeSlice)
    }
    const sketch002 = yo.programMemory.root.sketch002 as SketchGroup
    derivedPaths = sketch002.value.map(({ __geoMeta }) => {
      return [
        getNodePathFromSourceRange(ast, __geoMeta.sourceRange).map((a) => [
          String(a[0]),
          a[1],
        ]),
        __geoMeta.pathToNode,
        __geoMeta.sourceRange,
      ]
    })
    snippets = ['line([13.28, 4], %)']
    for (const [
      index,
      [sourcePath, wasmPath, range],
    ] of derivedPaths.entries()) {
      expect(sourcePath).toEqual(wasmPath)
      const codeSlice = code.slice(range[0], range[1])
      expect(snippets[index]).toBe(codeSlice)
    }
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
