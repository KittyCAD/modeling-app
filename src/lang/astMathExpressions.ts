import {
  BinaryExpression,
  Literal,
  Identifier,
  CallExpression,
} from './abstractSyntaxTreeTypes'
import {
  findClosingBrace,
  makeCallExpression,
  isNotCodeToken,
} from './abstractSyntaxTree'
import { Token } from './tokeniser'

export function reversePolishNotation(
  tokens: Token[],
  previousPostfix: Token[] = [],
  operators: Token[] = []
): Token[] {
  if (tokens.length === 0) {
    return [...previousPostfix, ...operators.slice().reverse()] // reverse mutates, so slice/clone is needed
  }
  const currentToken = tokens[0]
  if (
    currentToken.type === 'word' &&
    tokens?.[1]?.type === 'brace' &&
    tokens?.[1]?.value === '('
  ) {
    const closingBrace = findClosingBrace(tokens, 1)
    return reversePolishNotation(
      tokens.slice(closingBrace + 1),
      [...previousPostfix, ...tokens.slice(0, closingBrace + 1)],
      operators
    )
  } else if (
    currentToken.type === 'number' ||
    currentToken.type === 'word' ||
    currentToken.type === 'string'
  ) {
    return reversePolishNotation(
      tokens.slice(1),
      [...previousPostfix, currentToken],
      operators
    )
  } else if (['+', '-', '*', '/', '%'].includes(currentToken.value)) {
    if (
      operators.length > 0 &&
      _precedence(operators[operators.length - 1]) >= _precedence(currentToken)
    ) {
      return reversePolishNotation(
        tokens,
        [...previousPostfix, operators[operators.length - 1]],
        operators.slice(0, -1)
      )
    }
    return reversePolishNotation(tokens.slice(1), previousPostfix, [
      ...operators,
      currentToken,
    ])
  } else if (currentToken.value === '(') {
    // push current token to both stacks as it is a legitimate operator
    // but later we'll need to pop other operators off the stack until we find the matching ')'
    return reversePolishNotation(
      tokens.slice(1),
      [...previousPostfix, currentToken],
      [...operators, currentToken]
    )
  } else if (currentToken.value === ')') {
    if (operators[operators.length - 1]?.value !== '(') {
      // pop operators off the stack and push them to postFix until we find the matching '('
      return reversePolishNotation(
        tokens,
        [...previousPostfix, operators[operators.length - 1]],
        operators.slice(0, -1)
      )
    }
    return reversePolishNotation(
      tokens.slice(1),
      [...previousPostfix, currentToken],
      operators.slice(0, -1)
    )
  }
  if (isNotCodeToken(currentToken)) {
    return reversePolishNotation(tokens.slice(1), previousPostfix, operators)
  }
  throw new Error('Unknown token')
}

interface ParenthesisToken {
  type: 'parenthesis'
  value: '(' | ')'
  start: number
  end: number
}

interface ExtendedBinaryExpression extends BinaryExpression {
  startExtended?: number
  endExtended?: number
}

const buildTree = (
  reversePolishNotationTokens: Token[],
  stack: (
    | ExtendedBinaryExpression
    | Literal
    | Identifier
    | ParenthesisToken
    | CallExpression
  )[] = []
): BinaryExpression => {
  if (reversePolishNotationTokens.length === 0) {
    return stack[0] as BinaryExpression
  }
  const currentToken = reversePolishNotationTokens[0]
  if (currentToken.type === 'number' || currentToken.type === 'string') {
    return buildTree(reversePolishNotationTokens.slice(1), [
      ...stack,
      {
        type: 'Literal',
        value:
          currentToken.type === 'number'
            ? Number(currentToken.value)
            : currentToken.value.slice(1, -1),
        raw: currentToken.value,
        start: currentToken.start,
        end: currentToken.end,
      },
    ])
  } else if (currentToken.type === 'word') {
    if (
      reversePolishNotationTokens?.[1]?.type === 'brace' &&
      reversePolishNotationTokens?.[1]?.value === '('
    ) {
      const closingBrace = findClosingBrace(reversePolishNotationTokens, 1)
      return buildTree(reversePolishNotationTokens.slice(closingBrace + 1), [
        ...stack,
        makeCallExpression(reversePolishNotationTokens, 0).expression,
      ])
    }
    return buildTree(reversePolishNotationTokens.slice(1), [
      ...stack,
      {
        type: 'Identifier',
        name: currentToken.value,
        start: currentToken.start,
        end: currentToken.end,
      },
    ])
  } else if (currentToken.type === 'brace' && currentToken.value === '(') {
    const paranToken: ParenthesisToken = {
      type: 'parenthesis',
      value: '(',
      start: currentToken.start,
      end: currentToken.end,
    }
    return buildTree(reversePolishNotationTokens.slice(1), [
      ...stack,
      paranToken,
    ])
  } else if (currentToken.type === 'brace' && currentToken.value === ')') {
    const innerNode = stack[stack.length - 1]

    const paran = stack[stack.length - 2]

    const binExp: ExtendedBinaryExpression = {
      ...innerNode,
      startExtended: paran.start,
      endExtended: currentToken.end,
    } as ExtendedBinaryExpression

    return buildTree(reversePolishNotationTokens.slice(1), [
      ...stack.slice(0, -2),
      binExp,
    ])
  }

  const left = { ...stack[stack.length - 2] }
  let start = left.start
  if (left.type === 'BinaryExpression') {
    start = left?.startExtended || left.start
    delete left.startExtended
    delete left.endExtended
  }

  const right = { ...stack[stack.length - 1] }
  let end = right.end
  if (right.type === 'BinaryExpression') {
    end = right?.endExtended || right.end
    delete right.startExtended
    delete right.endExtended
  }

  const binExp: BinaryExpression = {
    type: 'BinaryExpression',
    operator: currentToken.value,
    start,
    end,
    left: left as any,
    right: right as any,
  }
  return buildTree(reversePolishNotationTokens.slice(1), [
    ...stack.slice(0, -2),
    binExp,
  ])
}

export function parseExpression(tokens: Token[]): BinaryExpression {
  const treeWithMabyeBadTopLevelStartEnd = buildTree(
    reversePolishNotation(tokens)
  )
  const left = treeWithMabyeBadTopLevelStartEnd?.left as any
  const start = left?.startExtended || treeWithMabyeBadTopLevelStartEnd?.start
  delete left.startExtended
  delete left.endExtended

  const right = treeWithMabyeBadTopLevelStartEnd?.right as any
  const end = right?.endExtended || treeWithMabyeBadTopLevelStartEnd?.end
  delete right.startExtended
  delete right.endExtended

  const tree: BinaryExpression = {
    ...treeWithMabyeBadTopLevelStartEnd,
    start,
    end,
    left,
    right,
  }
  return tree
}

function _precedence(operator: Token): number {
  return precedence(operator.value)
}

export function precedence(operator: string): number {
  // might be useful for refenecne to make it match
  // another commonly used lang https://www.w3schools.com/js/js_precedence.asp
  if (['+', '-'].includes(operator)) {
    return 11
  } else if (['*', '/', '%'].includes(operator)) {
    return 12
  } else {
    return 0
  }
}
