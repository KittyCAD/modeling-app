import fs from 'node:fs'

import { abstractSyntaxTree } from './abstractSyntaxTree'
import { lexer } from './tokeniser'
import { executor, ProgramMemory } from './executor'

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
      root.mySketch.map(({ previousPath, geo, ...rest }: any) => rest)
    ).toEqual([
      { type: 'base', from: [0, 0], sourceRange: [0, 0] },
      { type: 'toPoint', to: [0, 1], sourceRange: [25, 45], name: 'myPath' },
      { type: 'toPoint', to: [1, 1], sourceRange: [48, 59] },
      { type: 'toPoint', to: [1, 0], sourceRange: [67, 90], name: 'rightPath' },
      {
        type: 'close',
        firstPath: { type: 'base', from: [0, 0], sourceRange: [0, 0] },
        sourceRange: [93, 100],
      },
    ])
    expect(root.mySketch[0]).toEqual(root.mySketch[4].firstPath)
    // hmm not sure what handle the "show" function
    expect(_return).toEqual([
      {
        type: 'Identifier',
        start: 108,
        end: 116,
        name: 'mySketch',
      },
    ])
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
