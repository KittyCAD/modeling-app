import { Token } from './tokeniser'
import { Program, BodyItem } from './abstractSyntaxTree'

export function findTokensBetweenStatements(
  statement1: { start: number; end: number },
  statement2: { start: number; end: number },
  tokens: Token[]
): Token[] {
  // Find the start index of the range using binary search
  let startIndex = firstGreaterThanBinarySearch(tokens, statement1.end, 'start')
  if (startIndex < 0) {
    startIndex = ~startIndex
  }

  // Find the end index of the range using binary search
  let endIndex = firstGreaterThanBinarySearch(tokens, statement2.end, 'start')
  if (endIndex < 0) {
    endIndex = ~endIndex
  }

  // Return the tokens between the start and end index
  return tokens.slice(startIndex, endIndex)
}

function firstGreaterThanBinarySearch(
  tokens: { start: number; end: number }[],
  target: number,
  property: 'start' | 'end'
): number {
  let left = 0

  // has trouble with including tokens at the end of the range
  const paddedTokens = [
    {
      type: 'whitespace',
      value: '',
      start: 0,
      end: 0,
    },
    ...tokens,
    {
      type: 'whitespace',
      value: '',
      start: tokens[tokens.length - 1]?.end + 1000,
      end: tokens[tokens.length - 1]?.end + 1001,
    },
  ]

  let right = paddedTokens.length - 1

  while (left <= right) {
    const middle = left + Math.floor((right - left) / 2)
    if (paddedTokens[middle]?.[property] >= target) {
      if (middle === 1 || paddedTokens[middle - 1]?.[property] < target) {
        // minus 1 because of the padding
        return middle - 1
      }
      right = middle - 1
    } else {
      left = middle + 1
    }
  }
  return -1
}

export function getNonCodeString(
  body: Program['body'],
  index: number,
  tokens: Token[]
): string {
  let tokensToIntegrate: Token[] = []
  const currentStatement = body[index]
  const nextStatement = body[index + 1]
  if (nextStatement && nextStatement.start && currentStatement.end) {
    tokensToIntegrate = findTokensBetweenStatements(
      currentStatement,
      nextStatement,
      tokens
    )
  } else if (index === body.length - 1) {
    const tokensAfter = firstGreaterThanBinarySearch(
      tokens,
      currentStatement?.end,
      'start'
    )
    if (tokensAfter > 0) {
      tokensToIntegrate = tokens.slice(tokensAfter)
    }
  }

  if (tokensToIntegrate.length > 0) {
    const nonCodeString = tokensToIntegrate.map((token) => token.value).join('')
    // check it extra ends with a line break followed by spaces (only spaces not new lines)
    const hasWhitespaceOnEnd = nonCodeString.match(/(\n *)$/)
    if (hasWhitespaceOnEnd) {
      // we always put each statement on a new line, so this prevents it adding an extra line
      // however if the user puts more than one line break between statements, we'll respect it since
      // we're only removing the last one
      return nonCodeString.slice(0, -hasWhitespaceOnEnd[0].length)
    }

    return nonCodeString
  }
  return ''
}

export function getStartNonCodeString(
  firstStatement: BodyItem,
  tokens: Token[]
): string {
  if (!firstStatement) return ''
  const tokensBeforeIndex = tokens.length
    ? firstGreaterThanBinarySearch(tokens, firstStatement.start, 'end')
    : 0
  let nonCodeString = ''
  if (tokensBeforeIndex > 0) {
    nonCodeString = tokens
      .slice(0, tokensBeforeIndex)
      .map((token) => token.value)
      .join('')
  }
  return nonCodeString.trim() ? nonCodeString.trim() + '\n' : ''
}
