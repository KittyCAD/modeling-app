import fs from 'node:fs'

import { abstractSyntaxTree } from './abstractSyntaxTree'
import { lexer } from './tokeniser'
import { executor, ProgramMemory } from './executor'
import { Transform, SketchGeo } from './sketch'

describe('test', () => {
  it('test assigning two variables, the second summing with the first', () => {
    const code = `const myVar = 5
const newVar = myVar + 1`
    const { root } = exe(code)
    expect(root.myVar).toBe(5)
    expect(root.newVar).toBe(6)
  })
  it('test assigning a var with a string', () => {
    const code = `const myVar = "a str"`
    const { root } = exe(code)
    expect(root.myVar).toBe('a str')
  })
  it('test assigning a var by cont concatenating two strings string', () => {
    const code = fs.readFileSync(
      './src/lang/testExamples/variableDeclaration.cado',
      'utf-8'
    )
    const { root } = exe(code)
    expect(root.myVar).toBe('a str another str')
  })
  it('test with function call', () => {
    const code = `
const myVar = "hello"
log(5, myVar)`
    const programMemoryOverride = {
      log: jest.fn(),
    }
    const { root } = executor(abstractSyntaxTree(lexer(code)), {
      root: programMemoryOverride,
      _sketch: [],
    })
    expect(root.myVar).toBe('hello')
    expect(programMemoryOverride.log).toHaveBeenCalledWith(5, 'hello')
  })
  it('fn funcN = () => {}', () => {
    const { root } = exe(
      [
        'fn funcN = (a, b) => {',
        '  return a + b',
        '}',
        'const theVar = 60',
        'const magicNum = funcN(9, theVar)',
      ].join('\n')
    )
    expect(root.theVar).toBe(60)
    expect(root.magicNum).toBe(69)
  })
  it('sketch declaration', () => {
    let code = `sketch mySketch {
  path myPath = lineTo(0,1)
  lineTo(1,1)
  path rightPath = lineTo(1,0)
  close()
}
show(mySketch)
`
    const { root, return: _return } = exe(code)
    expect(
      root.mySketch.sketch.map(
        ({ previousPath, firstPath, geo, ...rest }: any) => rest
      )
    ).toEqual([
      { type: 'base', from: [0, 0], sourceRange: [0, 0] },
      { type: 'toPoint', to: [0, 1], sourceRange: [25, 45], name: 'myPath' },
      { type: 'toPoint', to: [1, 1], sourceRange: [48, 59] },
      { type: 'toPoint', to: [1, 0], sourceRange: [67, 90], name: 'rightPath' },
      {
        type: 'close',
        sourceRange: [93, 100],
      },
    ])
    // expect(root.mySketch.sketch[0]).toEqual(root.mySketch.sketch[4].firstPath)
    expect(_return).toEqual([
      {
        type: 'Identifier',
        start: 108,
        end: 116,
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
    expect(root.myVar).toBe(7)
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
    expect(root.mySk1.sketch).toHaveLength(4)
    expect(root?.rotated?.type).toBe('transform')
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
    const striptVersion = removeGeoFromSketch(root.mySk1)
    expect(striptVersion).toEqual({
      type: 'sketchGeo',
      sketch: [
        {
          type: 'base',
          from: [0, 0],
          sourceRange: [0, 0],
        },
        {
          type: 'toPoint',
          to: [1, 1],
          sourceRange: [17, 28],
        },
        {
          type: 'toPoint',
          to: [0, 1],
          sourceRange: [36, 57],
          name: 'myPath',
        },
        {
          type: 'toPoint',
          to: [1, 1],
          sourceRange: [60, 71],
        },
      ],
      sourceRange: [13, 73],
    })
    // old expect
    // expect(striptVersion).toEqual({
    //   type: 'transform',
    //   rotation: [1.5707963267948966, 0, 0],
    //   transform: [0, 0, 0],
    //   sketch: [
    //     {
    //       type: 'base',
    //       from: [0, 0],
    //       sourceRange: [0, 0],
    //     },
    //     {
    //       type: 'toPoint',
    //       to: [1, 1],
    //       sourceRange: [17, 28],
    //     },
    //     {
    //       type: 'toPoint',
    //       to: [0, 1],
    //       sourceRange: [36, 57],
    //       name: 'myPath',
    //     },
    //     {
    //       type: 'toPoint',
    //       to: [1, 1],
    //       sourceRange: [60, 71],
    //     },
    //   ],
    //   sourceRange: [77, 86],
    // })
  })
  it('execute array expression', () => {
    const code = ['const three = 3', "const yo = [1, '2', three, 4 + 5]"].join(
      '\n'
    )
    const { root } = exe(code)
    expect(root).toEqual({
      three: 3,
      yo: [1, '2', 3, 9],
    })
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

function removeGeoFromSketch(sketch: Transform | SketchGeo): any {
  if (sketch.type !== 'sketchGeo' && sketch.type === 'transform') {
    return removeGeoFromSketch(sketch.sketch as any) // TODO fix type
  }
  if (sketch.type === 'sketchGeo') {
    return {
      ...sketch,
      sketch: sketch.sketch.map(({ geo, previousPath, ...rest }: any) => rest),
    }
  }
  throw new Error('not a sketch')
}
