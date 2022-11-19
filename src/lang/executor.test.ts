import fs from "node:fs";

import { abstractSyntaxTree } from "./abstractSyntaxTree";
import { lexer } from "./tokeniser";
import { executor } from "./executor";

describe("test", () => {
  it("test assigning two variables, the second summing with the first", () => {
    const code = `const myVar = 5
const newVar = myVar + 1`;
    const programMemory = exe(code);
    expect(withoutStdFns(programMemory)).toEqual({
      root: {
        myVar: 5,
        newVar: 6,
      },
    });
  });
  it("test assigning a var with a string", () => {
    const code = `const myVar = "a str"`;
    const programMemory = exe(code);
    expect(withoutStdFns(programMemory)).toEqual({
      root: {
        myVar: "a str",
      },
    });
  });
  it("test assigning a var by cont concatenating two strings string", () => {
    const code = fs.readFileSync(
      "./src/lang/testExamples/variableDeclaration.cado",
      "utf-8"
    );
    const programMemory = exe(code);
    expect(withoutStdFns(programMemory)).toEqual({
      root: {
        myVar: "a str another str",
      },
    });
  });
  it("test with function call", () => {
    const code = `
const myVar = "hello"
log(5, myVar)`;
    const programMemoryOverride = {
      log: jest.fn(),
    };
    const programMemory = executor(abstractSyntaxTree(lexer(code)), {
      root: programMemoryOverride,
    });
    expect(withoutStdFns(programMemory)).toEqual({
      root: { myVar: "hello" },
    });
    expect(programMemoryOverride.log).toHaveBeenCalledWith(5, "hello");
  });
  it("fn funcN = () => {}", () => {
    const programMemory = exe(
      [
        "fn funcN = (a, b) => {",
        "  return a + b",
        "}",
        "const theVar = 60",
        "const magicNum = funcN(9, theVar)",
      ].join("\n")
    );
    expect(withoutStdFns(programMemory, ["funcN"])).toEqual({
      root: { theVar: 60, magicNum: 69 },
    });
  });
});

// helpers

function exe(
  code: string,
  programMemory: { root: { [key: string]: any }; return?: any } = { root: {} }
) {
  const tokens = lexer(code);
  const ast = abstractSyntaxTree(tokens);
  return executor(ast, programMemory);
}

function withoutStdFns(obj: any, toDelete: string[] = []) {
  const newRoot = { ...obj.root };
  const newObj = { ...obj, root: newRoot };
  delete newObj.root.log;
  toDelete.forEach((key) => {
    delete newObj.root[key];
  });
  return newObj;
}
