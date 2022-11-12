import fsp from "node:fs/promises";

const NUMBER = /^[0-9]+/;
const WHITESPACE = /\s+/;
const WORD = /^[a-zA-Z_][a-zA-Z0-9_]*/;
// regex that captures everything between two non escaped quotes and the quotes aren't captured in the match
const STRING = /^(["'])(?:(?=(\\?))\2.)*?\1/;
// regex for operators
const OPERATOR = /^[>=|<=|+|\-|*|/|>|<|^|%]/;
const BLOCK_START = /^\{/;
const BLOCK_END = /^\}/;
const PARAN_START = /^\(/;
const PARAN_END = /^\)/;

export const isNumber = (character: string) => NUMBER.test(character);
export const isWhitespace = (character: string) => WHITESPACE.test(character);
export const isWord = (character: string) => WORD.test(character);
export const isString = (character: string) => STRING.test(character);
export const isOperator = (character: string) => OPERATOR.test(character);
export const isBlockStart = (character: string) => BLOCK_START.test(character);
export const isBlockEnd = (character: string) => BLOCK_END.test(character);
export const isParanStart = (character: string) => PARAN_START.test(character);
export const isParanEnd = (character: string) => PARAN_END.test(character);

function matchFirst(str: string, regex: RegExp) {
  const theMatch = str.match(regex);
  if (!theMatch) {
    throw new Error("Should always be a match:" + str);
  }
  return theMatch[0];
}

interface Token {
  type: "number" | "word" | "operator" | "string" | "brace";
  value: string;
}

const returnTokenAtIndex = (str: string, startIndex: number): Token | null => {
  const strFromIndex = str.slice(startIndex);
  if (isOperator(strFromIndex)) {
    return {
      type: "operator",
      value: matchFirst(strFromIndex, OPERATOR),
    };
  }
  if (isString(strFromIndex)) {
    return {
      type: "string",
      value: matchFirst(strFromIndex, STRING),
    };
  }
  if (isParanEnd(strFromIndex)) {
    return {
      type: "brace",
      value: matchFirst(strFromIndex, PARAN_END),
    };
  }
  if (isParanStart(strFromIndex)) {
    return {
      type: "brace",
      value: matchFirst(strFromIndex, PARAN_START),
    };
  }
  if (isBlockStart(strFromIndex)) {
    return {
      type: "brace",
      value: matchFirst(strFromIndex, BLOCK_START),
    };
  }
  if (isBlockEnd(strFromIndex)) {
    return {
      type: "brace",
      value: matchFirst(strFromIndex, BLOCK_END),
    };
  }
  if (isNumber(strFromIndex)) {
    return {
      type: "number",
      value: matchFirst(strFromIndex, NUMBER),
    };
  }
  if (isWord(strFromIndex)) {
    return {
      type: "word",
      value: matchFirst(strFromIndex, WORD),
    };
  }
  return null;
};

export const lexer = (str: string): Token[] => {
  const recursivelyTokenise = (
    str: string,
    currentIndex: number = 0,
    previousTokens: Token[] = []
  ): Token[] => {
    if (currentIndex >= str.length) {
      return previousTokens;
    }
    const token = returnTokenAtIndex(str, currentIndex);
    if (!token) {
      return recursivelyTokenise(str, currentIndex + 1, previousTokens);
    }
    const nextIndex = currentIndex + token.value.length;
    return recursivelyTokenise(str, nextIndex, [...previousTokens, token]);
  };
  return recursivelyTokenise(str);
};

// const example1 = await fsp.readFile("./examples/addition.cado", "ascii");
