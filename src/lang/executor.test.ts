import fs from 'node:fs'

import { abstractSyntaxTree } from './abstractSyntaxTree'
import { lexer } from './tokeniser'
import { executor, ProgramMemory, Path, SketchGroup } from './executor'
import { initPromise } from './rust'

beforeAll(() => initPromise)

describe('test', () => {
  it('test assigning two variables, the second summing with the first', () => {
    const code = `const myVar = 5
const newVar = myVar + 1`
    const { root } = exe(code)
    expect(root.myVar.value).toBe(5)
    expect(root.newVar.value).toBe(6)
  })
  it('test assigning a var with a string', () => {
    const code = `const myVar = "a str"`
    const { root } = exe(code)
    expect(root.myVar.value).toBe('a str')
  })
  it('test assigning a var by cont concatenating two strings string execute', () => {
    const code = fs.readFileSync(
      './src/lang/testExamples/variableDeclaration.cado',
      'utf-8'
    )
    const { root } = exe(code)
    expect(root.myVar.value).toBe('a str another str')
  })
  it('test with function call', () => {
    const code = `
const myVar = "hello"
log(5, myVar)`
    const programMemoryOverride: ProgramMemory['root'] = {
      log: {
        type: 'userVal',
        value: jest.fn(),
        __meta: [
          {
            sourceRange: [0, 0],
            pathToNode: [],
          },
        ],
      },
    }
    const { root } = executor(abstractSyntaxTree(lexer(code)), {
      root: programMemoryOverride,
      _sketch: [],
    })
    expect(root.myVar.value).toBe('hello')
    expect(programMemoryOverride.log.value).toHaveBeenCalledWith(5, 'hello')
  })
  it('fn funcN = () => {} execute', () => {
    const { root } = exe(
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
  it('sketch declaration', () => {
    let code = `const mySketch = startSketchAt([0,0])
  |> lineTo({to: [0,2], tag: "myPath"}, %)
  |> lineTo([2,3], %)
  |> lineTo({ to: [5,-1], tag: "rightPath" }, %)
  // |> close(%)
show(mySketch)
`
    const { root, return: _return } = exe(code)
    // geo is three js buffer geometry and is very bloated to have in tests
    const minusGeo = removeGeoFromPaths(root.mySketch.value)
    expect(minusGeo).toEqual([
      {
        type: 'toPoint',
        to: [0, 2],
        from: [0, 0],
        __geoMeta: {
          sourceRange: [43, 80],
          pathToNode: [],
          geos: ['line', 'lineEnd'],
        },
        name: 'myPath',
      },
      {
        type: 'toPoint',
        to: [2, 3],
        from: [0, 2],
        __geoMeta: {
          sourceRange: [86, 102],
          pathToNode: [],
          geos: ['line', 'lineEnd'],
        },
      },
      {
        type: 'toPoint',
        to: [5, -1],
        from: [2, 3],
        __geoMeta: {
          sourceRange: [108, 151],
          pathToNode: [],
          geos: ['line', 'lineEnd'],
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

  it('pipe binary expression into call expression', () => {
    const code = [
      'fn myFn = (a) => { return a + 1 }',
      'const myVar = 5 + 1 |> myFn(%)',
    ].join('\n')
    const { root } = exe(code)
    expect(root.myVar.value).toBe(7)
  })

  it('rotated sketch', () => {
    const code = [
      'const mySk1 = startSketchAt([0,0])',
      '  |> lineTo([1,1], %)',
      '  |> lineTo({to: [0, 1], tag: "myPath"}, %)',
      '  |> lineTo([1, 1], %)',
      'const rotated = rx(90, mySk1)',
    ].join('\n')
    const { root } = exe(code)
    expect(root.mySk1.value).toHaveLength(3)
    expect(root?.rotated?.type).toBe('sketchGroup')
    if (
      root?.mySk1?.type !== 'sketchGroup' ||
      root?.rotated?.type !== 'sketchGroup'
    )
      throw new Error('not a sketch group')
    expect(root.mySk1.rotation).toEqual([0, 0, 0, 1])
    expect(root.rotated.rotation.map((a) => a.toFixed(4))).toEqual([
      '0.7071',
      '0.0000',
      '0.0000',
      '0.7071',
    ])
  })

  it('execute pipe sketch into call expression', () => {
    const code = [
      'const mySk1 = startSketchAt([0,0])',
      '  |> lineTo([1,1], %)',
      '  |> lineTo({to: [0, 1], tag: "myPath"}, %)',
      '  |> lineTo([1,1], %)',
      '  |> rx(90, %)',
    ].join('\n')
    const { root } = exe(code)
    const striptVersion = removeGeoFromSketch(root.mySk1 as SketchGroup)
    expect(striptVersion).toEqual({
      type: 'sketchGroup',
      start: {
        type: 'base',
        to: [0, 0],
        from: [0, 0],
        __geoMeta: {
          sourceRange: [14, 34],
          pathToNode: [],
          geos: ['sketchBase'],
        },
      },
      value: [
        {
          type: 'toPoint',
          to: [1, 1],
          from: [0, 0],
          __geoMeta: {
            sourceRange: [40, 56],
            pathToNode: [],
            geos: ['line', 'lineEnd'],
          },
        },
        {
          type: 'toPoint',
          to: [0, 1],
          from: [1, 1],
          __geoMeta: {
            sourceRange: [62, 100],
            pathToNode: [],
            geos: ['line', 'lineEnd'],
          },
          name: 'myPath',
        },
        {
          type: 'toPoint',
          to: [1, 1],
          from: [0, 1],
          __geoMeta: {
            sourceRange: [106, 122],
            pathToNode: [],
            geos: ['line', 'lineEnd'],
          },
        },
      ],
      position: [0, 0, 0],
      rotation: [0.7071067811865475, 0, 0, 0.7071067811865476],
      __meta: [
        { sourceRange: [14, 34], pathToNode: [] },
        { sourceRange: [128, 137], pathToNode: [] },
      ],
    })
  })
  it('execute array expression', () => {
    const code = ['const three = 3', "const yo = [1, '2', three, 4 + 5]"].join(
      '\n'
    )
    const { root } = exe(code)
    // TODO path to node is probably wrong here, zero indexes are not correct
    expect(root).toEqual({
      three: {
        type: 'userVal',
        value: 3,
        __meta: [
          {
            pathToNode: [
              ['body', ''],
              [0, 'index'],
              ['declarations', 'VariableDeclaration'],
              [0, 'index'],
              ['init', 'VariableDeclaration'],
            ],
            sourceRange: [14, 15],
          },
        ],
      },
      yo: {
        type: 'userVal',
        value: [1, '2', 3, 9],
        __meta: [
          {
            pathToNode: [
              ['body', ''],
              [1, 'index'],
              ['declarations', 'VariableDeclaration'],
              [0, 'index'],
              ['init', 'VariableDeclaration'],
            ],
            sourceRange: [27, 49],
          },
          {
            pathToNode: [
              ['body', ''],
              [0, 'index'],
              ['declarations', 'VariableDeclaration'],
              [0, 'index'],
              ['init', 'VariableDeclaration'],
            ],
            sourceRange: [14, 15],
          },
        ],
      },
    })
  })
  it('execute object expression', () => {
    const code = [
      'const three = 3',
      "const yo = {aStr: 'str', anum: 2, identifier: three, binExp: 4 + 5}",
    ].join('\n')
    const { root } = exe(code)
    expect(root.yo).toEqual({
      type: 'userVal',
      value: { aStr: 'str', anum: 2, identifier: 3, binExp: 9 },
      __meta: [
        {
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declarations', 'VariableDeclaration'],
            [0, 'index'],
            ['init', 'VariableDeclaration'],
          ],
          sourceRange: [27, 83],
        },
      ],
    })
  })
  it('execute memberExpression', () => {
    const code = ["const yo = {a: {b: '123'}}", "const myVar = yo.a['b']"].join(
      '\n'
    )
    const { root } = exe(code)
    expect(root.myVar).toEqual({
      type: 'userVal',
      value: '123',
      __meta: [
        {
          pathToNode: [
            ['body', ''],
            [1, 'index'],
            ['declarations', 'VariableDeclaration'],
            [0, 'index'],
            ['init', 'VariableDeclaration'],
          ],
          sourceRange: [41, 50],
        },
      ],
    })
  })
})

describe('testing math operators', () => {
  it('it can sum', () => {
    const code = ['const myVar = 1 + 2'].join('\n')
    const { root } = exe(code)
    expect(root.myVar.value).toBe(3)
  })
  it('it can subtract', () => {
    const code = ['const myVar = 1 - 2'].join('\n')
    const { root } = exe(code)
    expect(root.myVar.value).toBe(-1)
  })
  it('it can multiply', () => {
    const code = ['const myVar = 1 * 2'].join('\n')
    const { root } = exe(code)
    expect(root.myVar.value).toBe(2)
  })
  it('it can divide', () => {
    const code = ['const myVar = 1 / 2'].join('\n')
    const { root } = exe(code)
    expect(root.myVar.value).toBe(0.5)
  })
  it('it can modulus', () => {
    const code = ['const myVar = 5 % 2'].join('\n')
    const { root } = exe(code)
    expect(root.myVar.value).toBe(1)
  })
  it('it can do multiple operations', () => {
    const code = ['const myVar = 1 + 2 * 3'].join('\n')
    const { root } = exe(code)
    expect(root.myVar.value).toBe(7)
  })
  it('big example with parans', () => {
    const code = ['const myVar = 1 + 2 * (3 - 4) / -5 + 6'].join('\n')
    const { root } = exe(code)
    expect(root.myVar.value).toBe(7.4)
  })
  it('with identifier', () => {
    const code = ['const yo = 6', 'const myVar = yo / 2'].join('\n')
    const { root } = exe(code)
    expect(root.myVar.value).toBe(3)
  })
  it('with identifier', () => {
    const code = ['const myVar = 2 * ((2 + 3 ) / 4 + 5)'].join('\n')
    const { root } = exe(code)
    expect(root.myVar.value).toBe(12.5)
  })
  it('with callExpression at start', () => {
    const code = 'const myVar = min(4, 100) + 2'
    const { root } = exe(code)
    expect(root.myVar.value).toBe(6)
  })
  it('with callExpression at end', () => {
    const code = 'const myVar = 2 + min(4, 100)'
    const { root } = exe(code)
    expect(root.myVar.value).toBe(6)
  })
  it('with nested callExpression', () => {
    const code = 'const myVar = 2 + min(100, legLen(5, 3))'
    const { root } = exe(code)
    expect(root.myVar.value).toBe(6)
  })
  it('with unaryExpression', () => {
    const code = 'const myVar = -min(100, 3)'
    const { root } = exe(code)
    expect(root.myVar.value).toBe(-3)
  })
  it('with unaryExpression in callExpression', () => {
    const code = 'const myVar = min(-legLen(5, 4), 5)'
    const code2 = 'const myVar = min(5 , -legLen(5, 4))'
    const { root } = exe(code)
    const { root: root2 } = exe(code2)
    expect(root.myVar.value).toBe(-3)
    expect(root.myVar.value).toBe(root2.myVar.value)
  })
  it('with unaryExpression in ArrayExpression', () => {
    const code = 'const myVar = [1,-legLen(5, 4)]'
    const { root } = exe(code)
    expect(root.myVar.value).toEqual([1, -3])
  })
  it('with unaryExpression in ArrayExpression in CallExpression, checking nothing funny happens when used in a sketch', () => {
    const code = [
      'const part001 = startSketchAt([0, 0])',
      '|> line([-2.21, -legLen(5, min(3, 999))], %)',
    ].join('\n')
    const { root } = exe(code)
    const sketch = removeGeoFromSketch(root.part001 as SketchGroup)
    // result of `-legLen(5, min(3, 999))` should be -4
    const yVal = sketch.value?.[0]?.to?.[1]
    expect(yVal).toBe(-4)
  })
  it('test that % substitution feeds down CallExp->ArrExp->UnaryExp->CallExp', () => {
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
    const { root } = exe(code)
    const sketch = removeGeoFromSketch(root.part001 as SketchGroup)
    // expect -legLen(segLen('seg01', %), myVar) to equal -4 setting the y value back to 0
    expect(sketch.value?.[1]?.from).toEqual([3, 4])
    expect(sketch.value?.[1]?.to).toEqual([6, 0])
    const removedUnaryExp = code.replace(
      `-legLen(segLen('seg01', %), myVar)`,
      `legLen(segLen('seg01', %), myVar)`
    )
    const { root: removedUnaryExpRoot } = exe(removedUnaryExp)
    const removedUnaryExpRootSketch = removeGeoFromSketch(
      removedUnaryExpRoot.part001 as SketchGroup
    )
    // without the minus sign, the y value should be 8
    expect(removedUnaryExpRootSketch.value?.[1]?.to).toEqual([6, 8])
  })
  it('with nested callExpression and binaryExpression', () => {
    const code = 'const myVar = 2 + min(100, -1 + legLen(5, 3))'
    const { root } = exe(code)
    expect(root.myVar.value).toBe(5)
  })
})

// helpers

function exe(
  code: string,
  programMemory: ProgramMemory = { root: {}, _sketch: [] }
) {
  const tokens = lexer(code)
  const ast = abstractSyntaxTree(tokens)
  return executor(ast, programMemory)
}

function removeGeoFromSketch(sketch: SketchGroup): SketchGroup {
  return {
    ...sketch,
    start: !sketch.start
      ? undefined
      : {
          ...sketch.start,
          __geoMeta: {
            ...sketch.start.__geoMeta,
            geos: sketch.start.__geoMeta.geos.map((geo) => geo.type as any),
          },
        },
    value: removeGeoFromPaths(sketch.value),
  }
}

function removeGeoFromPaths(paths: Path[]): any[] {
  return paths.map((path: Path) => {
    const newGeos = path?.__geoMeta?.geos.map((geo) => geo.type)
    return {
      ...path,
      __geoMeta: {
        ...path.__geoMeta,
        geos: newGeos,
      },
    }
  })
}
