import { recast, processTokens } from './recast'
import { Program, abstractSyntaxTree } from './abstractSyntaxTree'
import { lexer, Token } from './tokeniser'
import fs from 'node:fs'

describe('recast', () => {
  it('recasts a simple program', () => {
    const code = '1 + 2'
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('variable declaration', () => {
    const code = 'const myVar = 5'
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it("variable declaration that's binary with string", () => {
    const code = "const myVar = 5 + 'yo'"
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
    const codeWithOtherQuotes = 'const myVar = 5 + "yo"'
    const { ast: ast2 } = code2ast(codeWithOtherQuotes)
    expect(recast(ast2)).toBe(codeWithOtherQuotes)
  })
  it('test assigning two variables, the second summing with the first', () => {
    const code = `const myVar = 5
const newVar = myVar + 1`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('test assigning a var by cont concatenating two strings string', () => {
    const code = fs.readFileSync(
      './src/lang/testExamples/variableDeclaration.cado',
      'utf-8'
    )
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('test with function call', () => {
    const code = `
const myVar = "hello"
log(5, myVar)`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('function declaration with call', () => {
    const code = [
      'fn funcN = (a, b) => {',
      '  return a + b',
      '}',
      'const theVar = 60',
      'const magicNum = funcN(9, theVar)',
    ].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('sketch declaration', () => {
    let code = `sketch mySketch {
  path myPath = lineTo(0, 1)
  lineTo(1, 1)
  path rightPath = lineTo(1, 0)
  close()
}
show(mySketch)
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('sketch piped into callExpression', () => {
    const code = [
      'sketch mySk1 {',
      '  lineTo(1, 1)',
      '  path myPath = lineTo(0, 1)',
      '  lineTo(1, 1)',
      '}',
      '  |> rx(90, %)',
    ].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('recast BinaryExpression piped into CallExpression', () => {
    const code = [
      'fn myFn = (a) => {',
      '  return a + 1',
      '}',
      'const myVar = 5 + 1',
      '  |> myFn(%)',
    ].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('recast nested binary expression', () => {
    const code = ['const myVar = 1 + 2 * 5'].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('recast nested binary expression with parans', () => {
    const code = ['const myVar = 1 + (1 + 2) * 5'].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('unnecessary paran wrap will be remove', () => {
    const code = ['const myVar = 1 + (2 * 5)'].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.replace('(', '').replace(')', ''))
  })
  it('complex nested binary expression', () => {
    const code = ['1 * ((2 + 3) / 4 + 5)'].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('multiplied paren expressions', () => {
    const code = ['3 + (1 + 2) * (3 + 4)'].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('recast array declaration', () => {
    const code = ['const three = 3', "const yo = [1, '2', three, 4 + 5]"].join(
      '\n'
    )
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('recast long array declaration', () => {
    const code = [
      'const three = 3',
      'const yo = [',
      '  1,',
      "  '2',",
      '  three,',
      '  4 + 5,',
      "  'hey oooooo really long long long'",
      ']',
    ].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('recast long object exectution', () => {
    const code = `const three = 3
const yo = {
  aStr: 'str',
  anum: 2,
  identifier: three,
  binExp: 4 + 5
}`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('recast short object exectution', () => {
    const code = `const yo = { key: 'val' }`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('recast object execution with member expression', () => {
    const code = `const yo = { a: { b: { c: '123' } } }
const key = 'c'
const myVar = yo.a['b'][key]
const key2 = 'b'
const myVar2 = yo['a'][key2].c`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code.trim())
  })
  it('code with comments', () => {
    const code = `
const yo = { a: { b: { c: '123' } } }
// this is a comment
const key = 'c'`

    const { ast, tokens } = code2ast(code)
    const processedTokens = processTokens(tokens)
    const recasted = recast(ast, processedTokens)

    expect(recasted).toBe(code.trim())
  })
  it('code with extra whitespace should be respected when recasted', () => {
    const withExtraEmptylLineBetween = `
const yo = { a: { b: { c: '123' } } }

const key = 'c'`

    const { ast, tokens } = code2ast(withExtraEmptylLineBetween)
    const processedTokens = processTokens(tokens)
    const recasted = recast(ast, processedTokens)

    expect(recasted).toBe(withExtraEmptylLineBetween.trim())
  })
  it('code with block comment in between', () => {
    const withExtraEmptylLineBetween = `
const yo = { a: { b: { c: '123' } } }
/* hi there
yo yo yo
*/
const key = 'c'`

    const { ast, tokens } = code2ast(withExtraEmptylLineBetween)
    const processedTokens = processTokens(tokens)
    const recasted = recast(ast, processedTokens)

    expect(recasted).toBe(withExtraEmptylLineBetween.trim())
  })
  it('code with block comment line comment and empty line', () => {
    const withExtraEmptylLineBetween = `
const yo = { a: { b: { c: '123' } } }
/* hi there
yo yo yo
*/

// empty line above and line comment here
const key = 'c'`

    const { ast, tokens } = code2ast(withExtraEmptylLineBetween)
    const processedTokens = processTokens(tokens)
    const recasted = recast(ast, processedTokens)

    expect(recasted).toBe(withExtraEmptylLineBetween.trim())
  })
  it('code comment at the start and end', () => {
    const withExtraEmptylLineBetween = `
// comment at the start
const yo = { a: { b: { c: '123' } } }
const key = 'c'
// comment at the end`

    const { ast, tokens } = code2ast(withExtraEmptylLineBetween)
    const processedTokens = processTokens(tokens)
    const recasted = recast(ast, processedTokens)

    expect(recasted).toBe(withExtraEmptylLineBetween.trim())
  })
  it('comments and random new lines between statements within function declarations are fine', () => {
    const withExtraEmptylLineBetween = `
const fn = (a) => {
  const yo = 5

  // a comment


  return a + yo

}`

    const { ast, tokens } = code2ast(withExtraEmptylLineBetween)
    const processedTokens = processTokens(tokens)
    const recasted = recast(ast, processedTokens)
    expect(recasted).toBe(withExtraEmptylLineBetween.trim())
  })
  it('Comment with sketch', () => {
    const withExtraEmptylLineBetween = `sketch part001 {
  lineTo(5.98, -0.04)
  // yo

  lineTo(0.18, 0.03)
}
  |> rx(90, %)
  |> extrude(9.6, %)

show(part001)`

    const { ast, tokens } = code2ast(withExtraEmptylLineBetween)
    const processedTokens = processTokens(tokens)
    const recasted = recast(ast, processedTokens)
    expect(recasted).toBe(withExtraEmptylLineBetween.trim())
  })
})

// helpers

function code2ast(code: string): { ast: Program; tokens: Token[] } {
  const tokens = lexer(code)
  const ast = abstractSyntaxTree(tokens)
  return {
    ast,
    tokens,
  }
}
