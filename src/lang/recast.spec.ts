import { err } from '@src/lib/trap'
import { join } from 'path'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import fs from 'node:fs'

import type { Program } from '@src/lang/wasm'
import { assertParse, recast } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { expect, describe, it } from 'vitest'

function code2ast(code: string, instance: ModuleType): { ast: Program } {
  const ast = assertParse(code, instance)
  return { ast }
}
const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

describe('recast', () => {
  it('recasts a simple program', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = '1 + 2'
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code)
  })
  it('variable declaration', async () => {
    const code = 'myVar = 5'
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code)
  })
  it("variable declaration that's binary with string", async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = "myVar = 5 + 'yo'"
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code)
    const codeWithOtherQuotes = 'myVar = 5 + "yo"'
    const { ast: ast2 } = code2ast(codeWithOtherQuotes, instance)
    const recastRetVal = recast(ast2, instance)
    if (err(recastRetVal)) throw recastRetVal
    expect(recastRetVal.trim()).toBe(codeWithOtherQuotes)
  })
  it('test assigning two variables, the second summing with the first', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `myVar = 5
newVar = myVar + 1
`
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted).toBe(code)
  })
  it('test assigning a var by cont concatenating two strings string', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = fs.readFileSync(
      './src/lang/testExamples/variableDeclaration.cado',
      'utf-8'
    )
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code.trim())
  })
  it('test with function call', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `myVar = "hello"
log(5, exp = myVar)
`
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted).toBe(code)
  })
  it('function declaration with call', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = [
      'fn funcN(a, b) {',
      '  return a + b',
      '}',
      'theVar = 60',
      'magicNum = funcN(a = 9, b = theVar)',
    ].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code)
  })
  it('recast sketch declaration', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    let code = `mySketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [0, 1], tag = $myPath)
  |> line(endAbsolute = [1, 1])
  |> line(endAbsolute = [1, 0], tag = $rightPath)
  |> close()
`
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted).toBe(code)
  })
  it('sketch piped into callExpression', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = [
      'mySk1 = startSketchOn(XY)',
      '  |> startProfile(at = [0, 0])',
      '  |> line(endAbsolute = [1, 1])',
      '  |> line(endAbsolute = [0, 1], tag = $myTag)',
      '  |> line(endAbsolute = [1, 1])',
      '  |> rx(90)',
    ].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast BinaryExpression piped into CallExpression', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = [
      'fn myFn(@a) {',
      '  return a + 1',
      '}',
      'myVar = 5 + 1',
      '  |> myFn(%)',
    ].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code)
  })
  it('recast nested binary expression', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = ['myVar = 1 + 2 * 5'].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast nested binary expression with parans', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = ['myVar = 1 + (1 + 2) * 5'].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code.trim())
  })
  it('unnecessary paran wrap will be remove', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = ['myVar = 1 + (2 * 5)'].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code.replace('(', '').replace(')', ''))
  })
  it('complex nested binary expression', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = ['1 * ((2 + 3) / 4 + 5)'].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code.trim())
  })
  it('multiplied paren expressions', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = ['3 + (1 + 2) * (3 + 4)'].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast array declaration', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = ['three = 3', "yo = [1, '2', three, 4 + 5]"].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast long array declaration', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = [
      'three = 3',
      'yo = [',
      '  1,',
      "  '2',",
      '  three,',
      '  4 + 5,',
      "  'hey oooooo really long long long'",
      ']',
    ].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code.trim())
  })
  it('recast long object execution', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `three = 3
yo = {
  aStr = 'str',
  anum = 2,
  identifier = three,
  binExp = 4 + 5
}
`
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted).toBe(code)
  })
  it('recast short object execution', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `yo = { key = 'val' }
`
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted).toBe(code)
  })
  it('recast object execution with member expression', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `yo = { a = { b = { c = '123' } } }
key = 'c'
myVar = yo.a['b'][key]
key2 = 'b'
myVar2 = yo['a'][key2].c
`
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted).toBe(code)
  })
})

describe('testing recasting with comments and whitespace', () => {
  it('code with comments', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `yo = { a = { b = { c = '123' } } }
// this is a comment
key = 'c'
`

    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted

    expect(recasted).toBe(code)
  })
  it('comments at the start and end', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `// this is a comment
yo = { a = { b = { c = '123' } } }
key = 'c'

// this is also a comment
`
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted).toBe(code)
  })
  it('comments in a pipe expression', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = [
      'mySk1 = startSketchOn(XY)',
      '  |> startProfile(at = [0, 0])',
      '  |> line(endAbsolute = [1, 1])',
      '  |> line(endAbsolute = [0, 1], tag = $myTag)',
      '  |> line(endAbsolute = [1, 1])',
      '  // a comment',
      '  |> rx(90)',
    ].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code)
  })
  it('comments sprinkled in all over the place', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `
/* comment at start */

mySk1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [1, 1])
  // comment here
  |> line(endAbsolute = [0, 1], tag = $myTag)
  |> line(endAbsolute = [1, 1]) /* and
  here
  */
  // a comment between pipe expression statements
  |> rx(90)
  // and another with just white space between others below
  |> ry(45)


  |> rx(45)
/*
one more for good measure
*/
`
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted).toBe(`/* comment at start */

mySk1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [1, 1])
  // comment here
  |> line(endAbsolute = [0, 1], tag = $myTag)
  |> line(endAbsolute = [1, 1]) /* and
  here */
  // a comment between pipe expression statements
  |> rx(90)
  // and another with just white space between others below
  |> ry(45)
  |> rx(45)
/* one more for good measure */
`)
  })
})

describe('testing call Expressions in BinaryExpressions and UnaryExpressions', () => {
  it('nested callExpression in binaryExpression', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = 'myVar = 2 + min([100, legLen(hypotenuse = 5, leg = 3)])'
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code)
  })
  it('nested callExpression in unaryExpression', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = 'myVar = -min([100, legLen(hypotenuse = 5, leg = 3)])'
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code)
  })
  it('with unaryExpression in callExpression', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = 'myVar = min([5, -legLen(hypotenuse = 5, leg = 4)])'
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code)
  })
  it('with unaryExpression in sketch situation', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = [
      'part001 = startSketchOn(XY)',
      '  |> startProfile(at = [0, 0])',
      '  |> line(end = [\n       -2.21,\n       -legLen(hypotenuse = 5, leg = min([3, 999]))\n     ])',
    ].join('\n')
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted.trim()).toBe(code)
  })
})

describe('it recasts wrapped object expressions in pipe bodies with correct indentation', () => {
  it('with a single line', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `part001 = startSketchOn(XY)
  |> startProfile(at = [-0.01, -0.08])
  |> line(end = [0.62, 4.15], tag = $seg01)
  |> line(end = [2.77, -1.24])
  |> angledLineThatIntersects(angle = 201, offset = -1.35, intersectTag = $seg01)
  |> line(end = [-0.42, -1.72])
`
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted).toBe(code)
  })
  it('recasts wrapped object expressions NOT in pipe body correctly', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `angledLineThatIntersects(angle = 201, offset = -1.35, intersectTag = $seg01)
`
    const { ast } = code2ast(code, instance)
    const recasted = recast(ast, instance)
    if (err(recasted)) throw recasted
    expect(recasted).toBe(code)
  })
})

describe('it recasts binary expression using brackets where needed', () => {
  it('when there are two minus in a row', async () => {
    const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
    const code = `part001 = 1 - (def - abc)
`
    const recasted = recast(code2ast(code, instance).ast, instance)
    expect(recasted).toBe(code)
  })
})
