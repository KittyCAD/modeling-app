import { parse, Program, recast, initPromise } from './wasm'
import fs from 'node:fs'

beforeAll(() => initPromise)

describe('recast', () => {
  it('recasts a simple program', () => {
    const code = '1 + 2'
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('variable declaration', () => {
    const code = 'const myVar = 5'
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it("variable declaration that's binary with string", () => {
    const code = "const myVar = 5 + 'yo'"
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
    const codeWithOtherQuotes = 'const myVar = 5 + "yo"'
    const { ast: ast2 } = code2ast(codeWithOtherQuotes)
    expect(recast(ast2).trim()).toBe(codeWithOtherQuotes)
  })
  it('test assigning two variables, the second summing with the first', () => {
    const code = `const myVar = 5
const newVar = myVar + 1
`
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
    expect(recasted.trim()).toBe(code.trim())
  })
  it('test with function call', () => {
    const code = `const myVar = "hello"
log(5, myVar)
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
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
    expect(recasted.trim()).toBe(code)
  })
  it('recast sketch declaration', () => {
    let code = `const mySketch = startSketchAt([0, 0])
  |> lineTo({ to: [0, 1], tag: "myPath" }, %)
  |> lineTo([1, 1], %)
  |> lineTo({ to: [1, 0], tag: "rightPath" }, %)
  |> close(%)

show(mySketch)
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('sketch piped into callExpression', () => {
    const code = [
      'const mySk1 = startSketchAt([0, 0])',
      '  |> lineTo([1, 1], %)',
      '  |> lineTo({ to: [0, 1], tag: "myTag" }, %)',
      '  |> lineTo([1, 1], %)',
      '  |> rx(90, %)',
    ].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
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
    expect(recasted.trim()).toBe(code)
  })
  it('recast nested binary expression', () => {
    const code = ['const myVar = 1 + 2 * 5'].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast nested binary expression with parans', () => {
    const code = ['const myVar = 1 + (1 + 2) * 5'].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('unnecessary paran wrap will be remove', () => {
    const code = ['const myVar = 1 + (2 * 5)'].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.replace('(', '').replace(')', ''))
  })
  it('complex nested binary expression', () => {
    const code = ['1 * ((2 + 3) / 4 + 5)'].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('multiplied paren expressions', () => {
    const code = ['3 + (1 + 2) * (3 + 4)'].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast array declaration', () => {
    const code = ['const three = 3', "const yo = [1, '2', three, 4 + 5]"].join(
      '\n'
    )
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
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
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast long object exectution', () => {
    const code = `const three = 3
const yo = {
  aStr: 'str',
  anum: 2,
  identifier: three,
  binExp: 4 + 5
}
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('recast short object exectution', () => {
    const code = `const yo = { key: 'val' }
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('recast object execution with member expression', () => {
    const code = `const yo = { a: { b: { c: '123' } } }
const key = 'c'
const myVar = yo.a['b'][key]
const key2 = 'b'
const myVar2 = yo['a'][key2].c
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
})

describe('testing recasting with comments and whitespace', () => {
  it('code with comments', () => {
    const code = `const yo = { a: { b: { c: '123' } } }
// this is a comment
const key = 'c'
`

    const { ast } = code2ast(code)
    const recasted = recast(ast)

    expect(recasted).toBe(code)
  })
  it('code with comment and extra lines', () => {
    const code = `const yo = 'c'

/* this is
a
comment */
const yo = 'bing'
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('comments at the start and end', () => {
    const code = `// this is a comment
const yo = { a: { b: { c: '123' } } }
const key = 'c'

// this is also a comment
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('comments in a fn block', () => {
    const code = `fn myFn = () => {
  // this is a comment
  const yo = { a: { b: { c: '123' } } }

  /* block
  comment */
  const key = 'c'
  // this is also a comment
}
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('comments in a pipe expression', () => {
    const code = [
      'const mySk1 = startSketchAt([0, 0])',
      '  |> lineTo([1, 1], %)',
      '  |> lineTo({ to: [0, 1], tag: "myTag" }, %)',
      '  |> lineTo([1, 1], %)',
      '  // a comment',
      '  |> rx(90, %)',
    ].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('comments sprinkled in all over the place', () => {
    const code = `
/* comment at start */

const mySk1 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  // comment here
  |> lineTo({ to: [0, 1], tag: 'myTag' }, %)
  |> lineTo([1, 1], %) /* and
  here
  */
  // a comment between pipe expression statements
  |> rx(90, %)
  // and another with just white space between others below
  |> ry(45, %)


  |> rx(45, %)
  /*
  one more for good measure
  */
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(`/* comment at start */
const mySk1 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  // comment here
  |> lineTo({ to: [0, 1], tag: 'myTag' }, %)
  |> lineTo([1, 1], %) /* and
  here */
  // a comment between pipe expression statements
  |> rx(90, %)
  // and another with just white space between others below
  |> ry(45, %)
  |> rx(45, %)
  /* one more for good measure */
`)
  })
})

describe('testing call Expressions in BinaryExpressions and UnaryExpressions', () => {
  it('nested callExpression in binaryExpression', () => {
    const code = 'const myVar = 2 + min(100, legLen(5, 3))'
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('nested callExpression in unaryExpression', () => {
    const code = 'const myVar = -min(100, legLen(5, 3))'
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('with unaryExpression in callExpression', () => {
    const code = 'const myVar = min(5, -legLen(5, 4))'
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('with unaryExpression in sketch situation', () => {
    const code = [
      'const part001 = startSketchAt([0, 0])',
      '  |> line([-2.21, -legLen(5, min(3, 999))], %)',
    ].join('\n')
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
})

describe('it recasts wrapped object expressions in pipe bodies with correct indentation', () => {
  it('with a single line', () => {
    const code = `const part001 = startSketchAt([-0.01, -0.08])
  |> line({ to: [0.62, 4.15], tag: 'seg01' }, %)
  |> line([2.77, -1.24], %)
  |> angledLineThatIntersects({
       angle: 201,
       offset: -1.35,
       intersectTag: 'seg01'
     }, %)
  |> line([-0.42, -1.72], %)
show(part001)
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('recasts wrapped object expressions NOT in pipe body correctly', () => {
    const code = `angledLineThatIntersects({
  angle: 201,
  offset: -1.35,
  intersectTag: 'seg01'
}, %)
`
    const { ast } = code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
})

describe('it recasts binary expression using brackets where needed', () => {
  it('when there are two minus in a row', () => {
    const code = `const part001 = 1 - (def - abc)
`
    const recasted = recast(code2ast(code).ast)
    expect(recasted).toBe(code)
  })
})

// helpers

function code2ast(code: string): { ast: Program } {
  const ast = parse(code)
  return { ast }
}
