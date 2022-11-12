import {
  isBlockEnd,
  isBlockStart,
  isNumber,
  isOperator,
  isParanEnd,
  isParanStart,
  isString,
  isWhitespace,
  isWord,
  lexer,
} from "./tokeniser";

describe("testing helpers", () => {
  it("test is number", () => {
    expect(isNumber("1")).toBe(true);
    expect(isNumber("5?")).toBe(true);
    expect(isNumber("5 + 6")).toBe(true);
    expect(isNumber("5 + a")).toBe(true);

    expect(isNumber("a")).toBe(false);
    expect(isNumber("?")).toBe(false);
    expect(isNumber("?5")).toBe(false);
  });
  it("test is whitespace", () => {
    expect(isWhitespace(" ")).toBe(true);
    expect(isWhitespace("  ")).toBe(true);
    expect(isWhitespace(" a")).toBe(true);
    expect(isWhitespace("a ")).toBe(true);

    expect(isWhitespace("a")).toBe(false);
    expect(isWhitespace("?")).toBe(false);
  });
  it("test is word", () => {
    expect(isWord("a")).toBe(true);
    expect(isWord("a ")).toBe(true);
    expect(isWord("a5")).toBe(true);
    expect(isWord("a5a")).toBe(true);

    expect(isWord("5")).toBe(false);
    expect(isWord("5a")).toBe(false);
    expect(isWord("5a5")).toBe(false);
  });
  it("test is string", () => {
    expect(isString('""')).toBe(true);
    expect(isString('"a"')).toBe(true);
    expect(isString('"a" ')).toBe(true);
    expect(isString('"a"5')).toBe(true);
    expect(isString("'a'5")).toBe(true);
    expect(isString('"with escaped \\" backslash"')).toBe(true);

    expect(isString('"')).toBe(false);
    expect(isString('"a')).toBe(false);
    expect(isString('a"')).toBe(false);
    expect(isString(' "a"')).toBe(false);
    expect(isString('5"a"')).toBe(false);
  });
  it("test is operator", () => {
    expect(isOperator("+")).toBe(true);
    expect(isOperator("+ ")).toBe(true);
    expect(isOperator("-")).toBe(true);
    expect(isOperator("<=")).toBe(true);
    expect(isOperator("<= ")).toBe(true);
    expect(isOperator(">=")).toBe(true);
    expect(isOperator(">= ")).toBe(true);
    expect(isOperator("> ")).toBe(true);
    expect(isOperator("< ")).toBe(true);
    expect(isOperator("| ")).toBe(true);
    expect(isOperator("|> ")).toBe(true);
    expect(isOperator("^ ")).toBe(true);
    expect(isOperator("% ")).toBe(true);
    expect(isOperator("+* ")).toBe(true);

    expect(isOperator("5 + 5")).toBe(false);
    expect(isOperator("a")).toBe(false);
    expect(isOperator("a+")).toBe(false);
    expect(isOperator("a+5")).toBe(false);
    expect(isOperator("5a+5")).toBe(false);
  });
  it("test is paran start", () => {
    expect(isParanStart("(")).toBe(true);
    expect(isParanStart("( ")).toBe(true);
    expect(isParanStart("(5")).toBe(true);
    expect(isParanStart("(5 ")).toBe(true);
    expect(isParanStart("(5 + 5")).toBe(true);
    expect(isParanStart("(5 + 5)")).toBe(true);
    expect(isParanStart("(5 + 5) ")).toBe(true);

    expect(isParanStart("5")).toBe(false);
    expect(isParanStart("5 + 5")).toBe(false);
    expect(isParanStart("5( + 5)")).toBe(false);
    expect(isParanStart(" ( + 5)")).toBe(false);
  });
  it("test is paran end", () => {
    expect(isParanEnd(")")).toBe(true);
    expect(isParanEnd(") ")).toBe(true);
    expect(isParanEnd(")5")).toBe(true);
    expect(isParanEnd(")5 ")).toBe(true);

    expect(isParanEnd("5")).toBe(false);
    expect(isParanEnd("5 + 5")).toBe(false);
    expect(isParanEnd("5) + 5")).toBe(false);
    expect(isParanEnd(" ) + 5")).toBe(false);
  });
  it("test is block start", () => {
    expect(isBlockStart("{")).toBe(true);
    expect(isBlockStart("{ ")).toBe(true);
    expect(isBlockStart("{5")).toBe(true);
    expect(isBlockStart("{a")).toBe(true);
    expect(isBlockStart("{5 ")).toBe(true);

    expect(isBlockStart("5")).toBe(false);
    expect(isBlockStart("5 + 5")).toBe(false);
    expect(isBlockStart("5{ + 5")).toBe(false);
    expect(isBlockStart("a{ + 5")).toBe(false);
    expect(isBlockStart(" { + 5")).toBe(false);
  });
  it("test is block end", () => {
    expect(isBlockEnd("}")).toBe(true);
    expect(isBlockEnd("} ")).toBe(true);
    expect(isBlockEnd("}5")).toBe(true);
    expect(isBlockEnd("}5 ")).toBe(true);

    expect(isBlockEnd("5")).toBe(false);
    expect(isBlockEnd("5 + 5")).toBe(false);
    expect(isBlockEnd("5} + 5")).toBe(false);
    expect(isBlockEnd(" } + 5")).toBe(false);
  });

});

describe("testing lexer", () => {
  it("test lexer", () => {
    expect(lexer("1 + 2")).toEqual([
      { type: "number", value: "1" },
      { type: "operator", value: "+" },
      { type: "number", value: "2" },
    ]);
    expect(lexer("54 + 22500 + 6")).toEqual([
      { type: "number", value: "54" },
      { type: "operator", value: "+" },
      { type: "number", value: "22500" },
      { type: "operator", value: "+" },
      { type: "number", value: "6" },
    ]);
    expect(lexer("a + bo + t5 - 6")).toEqual([
      { type: "word", value: "a" },
      { type: "operator", value: "+" },
      { type: "word", value: "bo" },
      { type: "operator", value: "+" },
      { type: "word", value: "t5" },
      { type: "operator", value: "-" },
      { type: "number", value: "6" },
    ]);
    expect(lexer('a + "a str" - 6')).toEqual([
      { type: "word", value: "a" },
      { type: "operator", value: "+" },
      { type: "string", value: '"a str"' },
      { type: "operator", value: "-" },
      { type: "number", value: "6" },
    ]);
    const sameWithOrWithoutWhiteSpaces = [
      { type: "word", value: "a" },
      { type: "operator", value: "+" },
      { type: "string", value: "'str'" },
    ];
    expect(lexer("a + 'str'")).toEqual(sameWithOrWithoutWhiteSpaces);
    expect(lexer("a +'str'")).toEqual(sameWithOrWithoutWhiteSpaces);

    expect(lexer("a + (sick)")).toEqual([
      { type: "word", value: "a" },
      { type: "operator", value: "+" },
      { type: "brace", value: "(" },
      { type: "word", value: "sick" },
      { type: "brace", value: ")" },
    ]);

    expect(lexer("a + {sick}")).toEqual([
      { type: "word", value: "a" },
      { type: "operator", value: "+" },
      { type: "brace", value: "{" },
      { type: "word", value: "sick" },
      { type: "brace", value: "}" },
    ]);
  });
});
