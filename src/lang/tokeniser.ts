const NUMBER = /^[0-9]+/;
const WHITESPACE = /\s+/;
const WORD = /^[a-zA-Z_][a-zA-Z0-9_]*/;
// regex that captures everything between two non escaped quotes and the quotes aren't captured in the match
const STRING = /^(["'])(?:(?=(\\?))\2.)*?\1/;
// verbose regex for finding operators, multiple character operators need to be first
const OPERATOR = /^(>=|<=|==|=>|!=|\*|\+|-|\/|%|=|<|>|\||\^)/;

const BLOCK_START = /^\{/;
const BLOCK_END = /^\}/;
const PARAN_START = /^\(/;
const PARAN_END = /^\)/;
const COMMA = /^,/;

export const isNumber = (character: string) => NUMBER.test(character);
export const isWhitespace = (character: string) => WHITESPACE.test(character);
export const isWord = (character: string) => WORD.test(character);
export const isString = (character: string) => STRING.test(character);
export const isOperator = (character: string) => OPERATOR.test(character);
export const isBlockStart = (character: string) => BLOCK_START.test(character);
export const isBlockEnd = (character: string) => BLOCK_END.test(character);
export const isParanStart = (character: string) => PARAN_START.test(character);
export const isParanEnd = (character: string) => PARAN_END.test(character);
export const isComma = (character: string) => COMMA.test(character);

function matchFirst(str: string, regex: RegExp) {
  const theMatch = str.match(regex);
  if (!theMatch) {
    throw new Error("Should always be a match:" + str);
  }
  return theMatch[0];
}

export interface Token {
  type: "number" | "word" | "operator" | "string" | "brace" | "whitespace" | "comma";
  value: string;
  start: number;
  end: number;
}

const makeToken = (type: Token["type"], value: string, start: number): Token => ({
  type,
  value,
  start,
  end: start + value.length,
})

const returnTokenAtIndex = (str: string, startIndex: number): Token | null => {
  const strFromIndex = str.slice(startIndex);
  if (isOperator(strFromIndex)) {
    return makeToken("operator", matchFirst(strFromIndex, OPERATOR), startIndex);
  }
  if (isString(strFromIndex)) {
    return makeToken("string", matchFirst(strFromIndex, STRING), startIndex);
  }
  if (isParanEnd(strFromIndex)) {
    return makeToken("brace", matchFirst(strFromIndex, PARAN_END), startIndex);
  }
  if (isParanStart(strFromIndex)) {
    return makeToken("brace", matchFirst(strFromIndex, PARAN_START), startIndex);
  }
  if (isBlockStart(strFromIndex)) {
    return makeToken("brace", matchFirst(strFromIndex, BLOCK_START), startIndex);
  }
  if (isBlockEnd(strFromIndex)) {
    return makeToken("brace", matchFirst(strFromIndex, BLOCK_END), startIndex);
  }
  if (isComma(strFromIndex)) {
    return makeToken("comma", matchFirst(strFromIndex, COMMA), startIndex);
  }
  if (isNumber(strFromIndex)) {
    return makeToken("number", matchFirst(strFromIndex, NUMBER), startIndex);
  }
  if (isWord(strFromIndex)) {
    return makeToken("word", matchFirst(strFromIndex, WORD), startIndex);
  }
  if (isWhitespace(strFromIndex)) {
    return makeToken("whitespace", matchFirst(strFromIndex, WHITESPACE), startIndex);
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
