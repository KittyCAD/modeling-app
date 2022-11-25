import { recast } from './recast'
import { Program } from './abstractSyntaxTree'
import { abstractSyntaxTree } from './abstractSyntaxTree'
import { lexer } from './tokeniser'
import { Token } from './tokeniser'

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
