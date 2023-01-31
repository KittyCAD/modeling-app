// regular expression for number that includes a decimal point or starts with a minus sign
const NUMBER = /^-?\d+(\.\d+)?/

const WHITESPACE = /\s+/
const WORD = /^[a-zA-Z_][a-zA-Z0-9_]*/
// regex that captures everything between two non escaped quotes and the quotes aren't captured in the match
const STRING = /^(["'])(?:(?=(\\?))\2.)*?\1/
// verbose regex for finding operators, multiple character operators need to be first
const OPERATOR = /^(>=|<=|==|=>|!= |\|>|\*|\+|-|\/|%|=|<|>|\||\^)/

const BLOCK_START = /^\{/
const BLOCK_END = /^\}/
const PARAN_START = /^\(/
const PARAN_END = /^\)/
const ARRAY_START = /^\[/
const ARRAY_END = /^\]/
const COMMA = /^,/
const COLON = /^:/
const PERIOD = /^\./
const LINECOMMENT = /^\/\/.*/
const BLOCKCOMMENT = /^\/\*[\s\S]*?\*\//

export const isNumber = (character: string) => NUMBER.test(character)
export const isWhitespace = (character: string) => WHITESPACE.test(character)
export const isWord = (character: string) => WORD.test(character)
export const isString = (character: string) => STRING.test(character)
export const isOperator = (character: string) => OPERATOR.test(character)
export const isBlockStart = (character: string) => BLOCK_START.test(character)
export const isBlockEnd = (character: string) => BLOCK_END.test(character)
export const isParanStart = (character: string) => PARAN_START.test(character)
export const isParanEnd = (character: string) => PARAN_END.test(character)
export const isArrayStart = (character: string) => ARRAY_START.test(character)
export const isArrayEnd = (character: string) => ARRAY_END.test(character)
export const isComma = (character: string) => COMMA.test(character)
export const isColon = (character: string) => COLON.test(character)
export const isPeriod = (character: string) => PERIOD.test(character)
export const isLineComment = (character: string) => LINECOMMENT.test(character)
export const isBlockComment = (character: string) =>
  BLOCKCOMMENT.test(character)

function matchFirst(str: string, regex: RegExp) {
  const theMatch = str.match(regex)
  if (!theMatch) {
    throw new Error('Should always be a match:' + str)
  }
  return theMatch[0]
}

export interface Token {
  type:
    | 'number'
    | 'word'
    | 'operator'
    | 'string'
    | 'brace'
    | 'whitespace'
    | 'comma'
    | 'colon'
    | 'period'
    | 'linecomment'
    | 'blockcomment'
  value: string
  start: number
  end: number
}

const makeToken = (
  type: Token['type'],
  value: string,
  start: number
): Token => ({
  type,
  value,
  start,
  end: start + value.length,
})

const returnTokenAtIndex = (str: string, startIndex: number): Token | null => {
  const strFromIndex = str.slice(startIndex)
  if (isString(strFromIndex)) {
    return makeToken('string', matchFirst(strFromIndex, STRING), startIndex)
  }
  const isLineCommentBool = isLineComment(strFromIndex)
  if (isLineCommentBool || isBlockComment(strFromIndex)) {
    return makeToken(
      isLineCommentBool ? 'linecomment' : 'blockcomment',
      matchFirst(strFromIndex, isLineCommentBool ? LINECOMMENT : BLOCKCOMMENT),
      startIndex
    )
  }
  if (isParanEnd(strFromIndex)) {
    return makeToken('brace', matchFirst(strFromIndex, PARAN_END), startIndex)
  }
  if (isParanStart(strFromIndex)) {
    return makeToken('brace', matchFirst(strFromIndex, PARAN_START), startIndex)
  }
  if (isBlockStart(strFromIndex)) {
    return makeToken('brace', matchFirst(strFromIndex, BLOCK_START), startIndex)
  }
  if (isBlockEnd(strFromIndex)) {
    return makeToken('brace', matchFirst(strFromIndex, BLOCK_END), startIndex)
  }
  if (isArrayStart(strFromIndex)) {
    return makeToken('brace', matchFirst(strFromIndex, ARRAY_START), startIndex)
  }
  if (isArrayEnd(strFromIndex)) {
    return makeToken('brace', matchFirst(strFromIndex, ARRAY_END), startIndex)
  }
  if (isComma(strFromIndex)) {
    return makeToken('comma', matchFirst(strFromIndex, COMMA), startIndex)
  }
  if (isNumber(strFromIndex)) {
    return makeToken('number', matchFirst(strFromIndex, NUMBER), startIndex)
  }
  if (isOperator(strFromIndex)) {
    return makeToken('operator', matchFirst(strFromIndex, OPERATOR), startIndex)
  }
  if (isWord(strFromIndex)) {
    return makeToken('word', matchFirst(strFromIndex, WORD), startIndex)
  }
  if (isColon(strFromIndex))
    return makeToken('colon', matchFirst(strFromIndex, COLON), startIndex)
  if (isPeriod(strFromIndex))
    return makeToken('period', matchFirst(strFromIndex, PERIOD), startIndex)
  if (isWhitespace(strFromIndex)) {
    return makeToken(
      'whitespace',
      matchFirst(strFromIndex, WHITESPACE),
      startIndex
    )
  }
  return null
}

export const lexer = (str: string): Token[] => {
  const recursivelyTokenise = (
    str: string,
    currentIndex: number = 0,
    previousTokens: Token[] = []
  ): Token[] => {
    if (currentIndex >= str.length) {
      return previousTokens
    }
    const token = returnTokenAtIndex(str, currentIndex)
    if (!token) {
      return recursivelyTokenise(str, currentIndex + 1, previousTokens)
    }
    const nextIndex = currentIndex + token.value.length
    return recursivelyTokenise(str, nextIndex, [...previousTokens, token])
  }
  return recursivelyTokenise(str)
}
