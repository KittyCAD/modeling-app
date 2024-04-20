import { parse, Program, recast, initPromise } from './wasm'
import fs from 'node:fs'

beforeAll(() => initPromise)

describe('recast', () => {
  it('recasts a simple program', async () => {
    const code = '1 + 2'
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('variable declaration', async () => {
    const code = 'const myVar = 5'
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it("variable declaration that's binary with string", async () => {
    const code = "const myVar = 5 + 'yo'"
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
    const codeWithOtherQuotes = 'const myVar = 5 + "yo"'
    const { ast: ast2 } = await code2ast(codeWithOtherQuotes)
    expect(recast(ast2).trim()).toBe(codeWithOtherQuotes)
  })
  it('test assigning two variables, the second summing with the first', async () => {
    const code = `const myVar = 5
const newVar = myVar + 1
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('test assigning a var by cont concatenating two strings string', async () => {
    const code = fs.readFileSync(
      './src/lang/testExamples/variableDeclaration.cado',
      'utf-8'
    )
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('test with function call', async () => {
    const code = `const myVar = "hello"
log(5, myVar)
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('function declaration with call', async () => {
    const code = [
      'fn funcN = (a, b) => {',
      '  return a + b',
      '}',
      'const theVar = 60',
      'const magicNum = funcN(9, theVar)',
    ].join('\n')
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('recast sketch declaration', async () => {
    let code = `const mySketch = startSketchAt([0, 0])
  |> lineTo([0, 1], %, "myPath")
  |> lineTo([1, 1], %)
  |> lineTo([1, 0], %, "rightPath")
  |> close(%)
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('sketch piped into callExpression', async () => {
    const code = [
      'const mySk1 = startSketchAt([0, 0])',
      '  |> lineTo([1, 1], %)',
      '  |> lineTo([0, 1], %, "myTag")',
      '  |> lineTo([1, 1], %)',
      '  |> rx(90, %)',
    ].join('\n')
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast BinaryExpression piped into CallExpression', async () => {
    const code = [
      'fn myFn = (a) => {',
      '  return a + 1',
      '}',
      'const myVar = 5 + 1',
      '  |> myFn(%)',
    ].join('\n')
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('recast nested binary expression', async () => {
    const code = ['const myVar = 1 + 2 * 5'].join('\n')
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast nested binary expression with parans', async () => {
    const code = ['const myVar = 1 + (1 + 2) * 5'].join('\n')
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('unnecessary paran wrap will be remove', async () => {
    const code = ['const myVar = 1 + (2 * 5)'].join('\n')
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.replace('(', '').replace(')', ''))
  })
  it('complex nested binary expression', async () => {
    const code = ['1 * ((2 + 3) / 4 + 5)'].join('\n')
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('multiplied paren expressions', async () => {
    const code = ['3 + (1 + 2) * (3 + 4)'].join('\n')
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast array declaration', async () => {
    const code = ['const three = 3', "const yo = [1, '2', three, 4 + 5]"].join(
      '\n'
    )
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast long array declaration', async () => {
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
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast long object execution', async () => {
    const code = `const three = 3
const yo = {
  aStr: 'str',
  anum: 2,
  identifier: three,
  binExp: 4 + 5
}
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('recast short object execution', async () => {
    const code = `const yo = { key: 'val' }
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('recast object execution with member expression', async () => {
    const code = `const yo = { a: { b: { c: '123' } } }
const key = 'c'
const myVar = yo.a['b'][key]
const key2 = 'b'
const myVar2 = yo['a'][key2].c
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
})

describe('testing recasting with comments and whitespace', () => {
  it('code with comments', async () => {
    const code = `const yo = { a: { b: { c: '123' } } }
// this is a comment
const key = 'c'
`

    const { ast } = await code2ast(code)
    const recasted = recast(ast)

    expect(recasted).toBe(code)
  })
  it('code with comment and extra lines', async () => {
    const code = `const yo = 'c'

/* this is
a
comment */
const yo = 'bing'
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('comments at the start and end', async () => {
    const code = `// this is a comment
const yo = { a: { b: { c: '123' } } }
const key = 'c'

// this is also a comment
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('comments in a fn block', async () => {
    const code = `fn myFn = async () => {
  // this is a comment
  const yo = { a: { b: { c: '123' } } }

  /* block
  comment */
  const key = 'c'
  // this is also a comment
}
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('comments in a pipe expression', async () => {
    const code = [
      'const mySk1 = startSketchAt([0, 0])',
      '  |> lineTo([1, 1], %)',
      '  |> lineTo([0, 1], %, "myTag")',
      '  |> lineTo([1, 1], %)',
      '  // a comment',
      '  |> rx(90, %)',
    ].join('\n')
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('comments sprinkled in all over the place', async () => {
    const code = `
/* comment at start */

const mySk1 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  // comment here
  |> lineTo([0, 1], %, 'myTag')
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
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(`/* comment at start */

const mySk1 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  // comment here
  |> lineTo([0, 1], %, 'myTag')
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
  it('nested callExpression in binaryExpression', async () => {
    const code = 'const myVar = 2 + min(100, legLen(5, 3))'
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('nested callExpression in unaryExpression', async () => {
    const code = 'const myVar = -min(100, legLen(5, 3))'
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('with unaryExpression in callExpression', async () => {
    const code = 'const myVar = min(5, -legLen(5, 4))'
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
  it('with unaryExpression in sketch situation', async () => {
    const code = [
      'const part001 = startSketchAt([0, 0])',
      '  |> line([-2.21, -legLen(5, min(3, 999))], %)',
    ].join('\n')
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted.trim()).toBe(code)
  })
})

describe('it recasts wrapped object expressions in pipe bodies with correct indentation', () => {
  it('with a single line', async () => {
    const code = `const part001 = startSketchAt([-0.01, -0.08])
  |> line([0.62, 4.15], %, 'seg01')
  |> line([2.77, -1.24], %)
  |> angledLineThatIntersects({
       angle: 201,
       offset: -1.35,
       intersectTag: 'seg01'
     }, %)
  |> line([-0.42, -1.72], %)
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
  it('recasts wrapped object expressions NOT in pipe body correctly', async () => {
    const code = `angledLineThatIntersects({
  angle: 201,
  offset: -1.35,
  intersectTag: 'seg01'
}, %)
`
    const { ast } = await code2ast(code)
    const recasted = recast(ast)
    expect(recasted).toBe(code)
  })
})

describe('it recasts binary expression using brackets where needed', () => {
  it('when there are two minus in a row', async () => {
    const code = `const part001 = 1 - (def - abc)
`
    const recasted = recast((await code2ast(code)).ast)
    expect(recasted).toBe(code)
  })
})

// helpers

async function code2ast(code: string): Promise<{ ast: Program }> {
  const ast = await parse(code)
  return { ast }
}
