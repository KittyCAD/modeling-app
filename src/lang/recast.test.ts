import { recast } from "./recast";
import { Program } from "./abstractSyntaxTree";
import { abstractSyntaxTree } from "./abstractSyntaxTree";
import { lexer } from "./tokeniser";
import { Token } from "./tokeniser";

describe("recast", () => {
  it("recasts a simple program", () => {
    const code = "1 + 2";
    const {ast, tokens } = code2ast(code);
    const recasted = recast(ast);
    expect(recasted).toBe(code);
  });
});

// helpers

function code2ast(code: string): { ast: Program; tokens: Token[]} {
  const tokens = lexer(code);
  const ast = abstractSyntaxTree(tokens);
  return {
    ast,
    tokens
  }
}
