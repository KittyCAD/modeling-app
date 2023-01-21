import fs from 'node:fs'

import { abstractSyntaxTree } from './abstractSyntaxTree'
import { lexer } from './tokeniser'
import { executor, ProgramMemory, Path, SketchGroup } from './executor'

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
    let code = `sketch mySketch {
  path myPath = lineTo(0,2)
  lineTo(2,3)
  path rightPath = lineTo(5,-1)
  close()
}
show(mySketch)
`
    const { root, return: _return } = exe(code)
    // geo is three js buffer geometry and is very bloated to have in tests
    const minusGeo = removeGeoFromPaths(root.mySketch.value)
    expect(minusGeo).toEqual([
      {
        type: 'toPoint',
        to: [0, 2],
        from: [5, -1],
        __geoMeta: {
          sourceRange: [25, 45],
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
          sourceRange: [48, 59],
          pathToNode: [],
          geos: ['line', 'lineEnd'],
        },
      },
      {
        type: 'toPoint',
        to: [5, -1],
        from: [2, 3],
        __geoMeta: {
          sourceRange: [67, 91],
          pathToNode: [],
          geos: ['line', 'lineEnd'],
        },
        name: 'rightPath',
      },
      {
        type: 'toPoint',
        from: [5, -1],
        to: [0, 2],
        __geoMeta: {
          sourceRange: [94, 101],
          pathToNode: [],
          geos: ['line', 'lineEnd'],
        },
      },
    ])
    // expect(root.mySketch.sketch[0]).toEqual(root.mySketch.sketch[4].firstPath)
    expect(_return).toEqual([
      {
        type: 'Identifier',
        start: 109,
        end: 117,
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
      'sketch mySk1 {',
      '  lineTo(1,1)',
      '  path myPath = lineTo(0, 1)',
      '  lineTo(1,1)',
      '}',
      'const rotated = rx(90, mySk1)',
      // 'show(mySk1)',
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
      'sketch mySk1 {',
      '  lineTo(1,1)',
      '  path myPath = lineTo(0, 1)',
      '  lineTo(1,1)',
      '} |> rx(90, %)',
    ].join('\n')
    const { root } = exe(code)
    const striptVersion = removeGeoFromSketch(root.mySk1 as SketchGroup)
    expect(striptVersion).toEqual({
      type: 'sketchGroup',
      value: [
        {
          type: 'toPoint',
          to: [1, 1],
          from: [0, 0],
          __geoMeta: {
            sourceRange: [17, 28],
            pathToNode: [],
            geos: ['line', 'lineEnd'],
          },
        },
        {
          type: 'toPoint',
          to: [0, 1],
          from: [1, 1],
          __geoMeta: {
            sourceRange: [36, 57],
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
            sourceRange: [60, 71],
            pathToNode: [],
            geos: ['line', 'lineEnd'],
          },
        },
      ],
      position: [0, 0, 0],
      rotation: [0.7071067811865475, 0, 0, 0.7071067811865476],
      __meta: [
        {
          sourceRange: [13, 73],
          pathToNode: ['body', 0, 'declarations', 0, 'init', 0],
        },
        {
          sourceRange: [77, 86],
          pathToNode: [],
        },
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
            pathToNode: ['body', 0, 'declarations', 0, 'init'],
            sourceRange: [14, 15],
          },
        ],
      },
      yo: {
        type: 'userVal',
        value: [1, '2', 3, 9],
        __meta: [
          {
            pathToNode: ['body', 1, 'declarations', 0, 'init'],
            sourceRange: [27, 49],
          },
          {
            pathToNode: ['body', 0, 'declarations', 0, 'init'],
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
      value: {
        aStr: 'str',
        anum: 2,
        identifier: 3,
        binExp: 9,
      },
      __meta: [
        {
          pathToNode: ['body', 1, 'declarations', 0, 'init'],
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
          pathToNode: ['body', 1, 'declarations', 0, 'init'],
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
  // TODO
  // it('with callExpression', () => {
  //   const code = [
  //     'const yo = (a) => a * 2',
  //     'const myVar = yo(2) + 2'
  //   ].join('\n')
  //   const { root } = exe(code)
  //   expect(root.myVar.value).toBe(6)
  // })
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

function removeGeoFromSketch(sketch: SketchGroup): any {
  return {
    ...sketch,
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
