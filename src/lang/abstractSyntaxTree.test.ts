import { abstractSyntaxTree, findClosingBrace } from "./abstractSyntaxTree";
import { lexer } from "./tokeniser";

describe("findClosingBrace", () => {
  test("finds the closing brace", () => {
    const basic = "( hey )"
    expect(findClosingBrace(lexer(basic), 0)).toBe(4)

    const handlesNonZeroIndex = "(indexForBracketToRightOfThisIsTwo(shouldBeFour)AndNotThisSix)"
    expect(findClosingBrace(lexer(handlesNonZeroIndex), 2)).toBe(4)
    expect(findClosingBrace(lexer(handlesNonZeroIndex), 0)).toBe(6)
    
    const handlesNested = "{a{b{c(}d]}eathou athoeu tah u} thatOneToTheLeftIsLast }"
    expect(findClosingBrace(lexer(handlesNested), 0)).toBe(18)

    // throws when not started on a brace
    expect(() => findClosingBrace(lexer(handlesNested), 1)).toThrow()
    
  })
})

describe("testing AST", () => {
  test("test 5 + 6", () => {
    const tokens = lexer("5 +6");
    const result = abstractSyntaxTree(tokens);
    expect(result).toEqual({
      type: "Program",
      start: 0,
      end: 4,
      body: [
        {
          type: "ExpressionStatement",
          start: 0,
          end: 4,
          expression: {
            type: "BinaryExpression",
            start: 0,
            end: 4,
            left: {
              type: "Literal",
              start: 0,
              end: 1,
              value: 5,
              raw: "5",
            },
            operator: "+",
            right: {
              type: "Literal",
              start: 3,
              end: 4,
              value: 6,
              raw: "6",
            },
          },
        },
      ],
    });
  });
  test("test const myVar = 5", () => {
    const tokens = lexer("const myVar = 5");
    const { body } = abstractSyntaxTree(tokens);
    expect(body).toEqual([
      {
        type: "VariableDeclaration",
        start: 0,
        end: 15,
        kind: "const",
        declarations: [
          {
            type: "VariableDeclarator",
            start: 6,
            end: 15,
            id: {
              type: "Identifier",
              start: 6,
              end: 11,
              name: "myVar",
            },
            init: {
              type: "Literal",
              start: 14,
              end: 15,
              value: 5,
              raw: "5",
            },
          },
        ],
      },
    ]);
  });
  test("test multi-line", () => {
    const code = `const myVar = 5
const newVar = myVar + 1
`;
    const tokens = lexer(code);
    const { body } = abstractSyntaxTree(tokens);
    expect(body).toEqual([
      {
        type: "VariableDeclaration",
        start: 0,
        end: 15,
        kind: "const",
        declarations: [
          {
            type: "VariableDeclarator",
            start: 6,
            end: 15,
            id: {
              type: "Identifier",
              start: 6,
              end: 11,
              name: "myVar",
            },
            init: {
              type: "Literal",
              start: 14,
              end: 15,
              value: 5,
              raw: "5",
            },
          },
        ],
      },
      {
        type: "VariableDeclaration",
        start: 16,
        end: 40,
        kind: "const",
        declarations: [
          {
            type: "VariableDeclarator",
            start: 22,
            end: 40,
            id: {
              type: "Identifier",
              start: 22,
              end: 28,
              name: "newVar",
            },
            init: {
              type: "BinaryExpression",
              start: 31,
              end: 40,
              left: {
                type: "Identifier",
                start: 31,
                end: 36,
                name: "myVar",
              },
              operator: "+",
              right: {
                type: "Literal",
                start: 39,
                end: 40,
                value: 1,
                raw: "1",
              },
            },
          },
        ],
      },
    ]);
  });
  test('test using std function "log"', () => {
    const code = `log(5, "hello", aIdentifier)`;
    const tokens = lexer(code);
    const { body } = abstractSyntaxTree(tokens);
    expect(body).toEqual([
      {
        "type": "ExpressionStatement",
        "start": 0,
        "end": 28,
        "expression": {
          "type": "CallExpression",
          "start": 0,
          "end": 28,
          "callee": {
            "type": "Identifier",
            "start": 0,
            "end": 3,
            "name": "log"
          },
          "arguments": [
            {
              "type": "Literal",
              "start": 4,
              "end": 5,
              "value": 5,
              "raw": "5"
            },
            {
              "type": "Literal",
              "start": 7,
              "end": 14,
              "value": "hello",
              "raw": "\"hello\""
            },
            {
              "type": "Identifier",
              "start": 16,
              "end": 27,
              "name": "aIdentifier"
            }
          ],
          "optional": false
        }
      }
    ]);
  });
});
