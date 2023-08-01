import { Token } from './tokeniser'
import { parseExpression } from './astMathExpressions'
import { KCLSyntaxError, KCLUnimplementedError } from './errors'
import {
  BinaryPart,
  BodyItem,
  Identifier,
  Literal,
  NoneCodeMeta,
  NoneCodeNode,
  ObjectKeyInfo,
  ObjectProperty,
  PipeSubstitution,
  Program,
  Value,
  VariableDeclaration,
  VariableDeclarator,
  ArrayExpression,
  BinaryExpression,
  CallExpression,
  FunctionExpression,
  MemberExpression,
  ObjectExpression,
  PipeExpression,
  UnaryExpression,
  BlockStatement,
  ExpressionStatement,
  ReturnStatement,
} from './abstractSyntaxTreeTypes'

function makeNoneCodeNode(
  tokens: Token[],
  index: number
): { node?: NoneCodeNode; lastIndex: number } {
  const currentToken = tokens[index]
  const endIndex = findEndOfNonCodeNode(tokens, index)
  const nonCodeTokens = tokens.slice(index, endIndex)
  let value = nonCodeTokens.map((t) => t.value).join('')

  const node: NoneCodeNode = {
    type: 'NoneCodeNode',
    start: currentToken.start,
    end: tokens[endIndex - 1].end,
    value,
  }
  return { node, lastIndex: endIndex - 1 }
}

function findEndOfNonCodeNode(tokens: Token[], index: number): number {
  const currentToken = tokens[index]
  if (isNotCodeToken(currentToken)) {
    return findEndOfNonCodeNode(tokens, index + 1)
  }
  return index
}

function makeExpressionStatement(
  tokens: Token[],
  index: number
): { expression: ExpressionStatement; lastIndex: number } {
  const currentToken = tokens[index]
  const { token: nextToken } = nextMeaningfulToken(tokens, index)
  if (nextToken.type === 'brace' && nextToken.value === '(') {
    const { expression, lastIndex } = makeCallExpression(tokens, index)
    return {
      expression: {
        type: 'ExpressionStatement',
        start: currentToken.start,
        end: expression.end,
        expression,
      },
      lastIndex,
    }
  }

  const { expression, lastIndex } = makeBinaryExpression(tokens, index)
  return {
    expression: {
      type: 'ExpressionStatement',
      start: currentToken.start,
      end: expression.end,
      expression,
    },
    lastIndex,
  }
}

export function makeCallExpression(
  tokens: Token[],
  index: number
): {
  expression: CallExpression
  lastIndex: number
} {
  const currentToken = tokens[index]
  const braceToken = nextMeaningfulToken(tokens, index)
  const callee = makeIdentifier(tokens, index)
  const args = makeArguments(tokens, braceToken.index)
  const closingBraceToken = tokens[args.lastIndex]
  return {
    expression: {
      type: 'CallExpression',
      start: currentToken.start,
      end: closingBraceToken.end,
      callee,
      arguments: args.arguments,
      optional: false,
    },
    lastIndex: args.lastIndex,
  }
}

function makeArguments(
  tokens: Token[],
  index: number,
  previousArgs: Value[] = []
): {
  arguments: Value[]
  lastIndex: number
} {
  const braceOrCommaToken = tokens[index]
  const argumentToken = nextMeaningfulToken(tokens, index)
  const shouldFinishRecursion =
    braceOrCommaToken.type === 'brace' && braceOrCommaToken.value === ')'
  if (shouldFinishRecursion) {
    return {
      arguments: previousArgs,
      lastIndex: index,
    }
  }
  const nextBraceOrCommaToken = nextMeaningfulToken(tokens, argumentToken.index)
  if (nextBraceOrCommaToken.token == undefined) {
    throw new KCLSyntaxError(
      'Expected argument',
      rangeOfToken(argumentToken.token)
    )
  }
  const isIdentifierOrLiteral =
    nextBraceOrCommaToken.token.type === 'comma' ||
    nextBraceOrCommaToken.token.type === 'brace'
  if (
    argumentToken.token.type === 'brace' &&
    argumentToken.token.value === '['
  ) {
    const { expression, lastIndex } = makeArrayExpression(
      tokens,
      argumentToken.index
    )
    const nextCommarOrBraceTokenIndex = nextMeaningfulToken(
      tokens,
      lastIndex
    ).index
    return makeArguments(tokens, nextCommarOrBraceTokenIndex, [
      ...previousArgs,
      expression,
    ])
  }
  if (
    argumentToken.token.type === 'operator' &&
    argumentToken.token.value === '-'
  ) {
    const { expression, lastIndex } = makeUnaryExpression(
      tokens,
      argumentToken.index
    )
    const nextCommarOrBraceTokenIndex = nextMeaningfulToken(
      tokens,
      lastIndex
    ).index
    return makeArguments(tokens, nextCommarOrBraceTokenIndex, [
      ...previousArgs,
      expression,
    ])
  }
  if (
    argumentToken.token.type === 'brace' &&
    argumentToken.token.value === '{'
  ) {
    const { expression, lastIndex } = makeObjectExpression(
      tokens,
      argumentToken.index
    )
    const nextCommarOrBraceTokenIndex = nextMeaningfulToken(
      tokens,
      lastIndex
    ).index
    return makeArguments(tokens, nextCommarOrBraceTokenIndex, [
      ...previousArgs,
      expression,
    ])
  }
  if (
    (argumentToken.token.type === 'word' ||
      argumentToken.token.type === 'number' ||
      argumentToken.token.type === 'string') &&
    nextBraceOrCommaToken.token.type === 'operator'
  ) {
    const { expression, lastIndex } = makeBinaryExpression(
      tokens,
      argumentToken.index
    )
    const nextCommarOrBraceTokenIndex = nextMeaningfulToken(
      tokens,
      lastIndex
    ).index
    return makeArguments(tokens, nextCommarOrBraceTokenIndex, [
      ...previousArgs,
      expression,
    ])
  }
  if (!isIdentifierOrLiteral) {
    // I think this if statement might be dead code
    const { expression, lastIndex } = makeBinaryExpression(
      tokens,
      nextBraceOrCommaToken.index
    )
    return makeArguments(tokens, lastIndex, [...previousArgs, expression])
  }
  if (
    argumentToken.token.type === 'operator' &&
    argumentToken.token.value === '%'
  ) {
    const value: PipeSubstitution = {
      type: 'PipeSubstitution',
      start: argumentToken.token.start,
      end: argumentToken.token.end,
    }
    return makeArguments(tokens, nextBraceOrCommaToken.index, [
      ...previousArgs,
      value,
    ])
  }

  if (
    argumentToken.token.type === 'word' &&
    nextBraceOrCommaToken.token.type === 'brace' &&
    nextBraceOrCommaToken.token.value === '('
  ) {
    const closingBrace = findClosingBrace(tokens, nextBraceOrCommaToken.index)
    const tokenAfterClosingBrace = nextMeaningfulToken(tokens, closingBrace)
    if (
      tokenAfterClosingBrace.token.type === 'operator' &&
      tokenAfterClosingBrace.token.value !== '|>'
    ) {
      const { expression, lastIndex } = makeBinaryExpression(
        tokens,
        argumentToken.index
      )
      const nextCommarOrBraceTokenIndex = nextMeaningfulToken(
        tokens,
        lastIndex
      ).index
      return makeArguments(tokens, nextCommarOrBraceTokenIndex, [
        ...previousArgs,
        expression,
      ])
    }
    const { expression, lastIndex } = makeCallExpression(
      tokens,
      argumentToken.index
    )
    const nextCommarOrBraceTokenIndex = nextMeaningfulToken(
      tokens,
      lastIndex
    ).index
    return makeArguments(tokens, nextCommarOrBraceTokenIndex, [
      ...previousArgs,
      expression,
    ])
  }
  if (argumentToken.token.type === 'word') {
    const identifier = makeIdentifier(tokens, argumentToken.index)
    return makeArguments(tokens, nextBraceOrCommaToken.index, [
      ...previousArgs,
      identifier,
    ])
  } else if (
    argumentToken.token.type === 'number' ||
    argumentToken.token.type === 'string'
  ) {
    const literal = makeLiteral(tokens, argumentToken.index)
    return makeArguments(tokens, nextBraceOrCommaToken.index, [
      ...previousArgs,
      literal,
    ])
  } else if (
    argumentToken.token.type === 'brace' &&
    argumentToken.token.value === ')'
  ) {
    return makeArguments(tokens, argumentToken.index, previousArgs)
  }
  throw new KCLSyntaxError(
    'Expected a previous Argument if statement to match',
    rangeOfToken(argumentToken.token)
  )
}

function makeVariableDeclaration(
  tokens: Token[],
  index: number
): { declaration: VariableDeclaration; lastIndex: number } {
  // token index should point to a declaration keyword i.e. const, fn
  const currentToken = tokens[index]
  const declarationStartToken = nextMeaningfulToken(tokens, index)
  const { declarations, lastIndex } = makeVariableDeclarators(
    tokens,
    declarationStartToken.index
  )
  return {
    declaration: {
      type: 'VariableDeclaration',
      start: currentToken.start,
      end: declarations[declarations.length - 1].end,
      kind:
        currentToken.value === 'const'
          ? 'const'
          : currentToken.value === 'fn'
          ? 'fn'
          : 'unknown',
      declarations,
    },
    lastIndex,
  }
}

function makeValue(
  tokens: Token[],
  index: number
): { value: Value; lastIndex: number } {
  const currentToken = tokens[index]
  const { token: nextToken, index: nextTokenIndex } = nextMeaningfulToken(
    tokens,
    index
  )
  if (nextToken?.type === 'brace' && nextToken.value === '(') {
    const endIndex = findClosingBrace(tokens, nextTokenIndex)
    const tokenAfterCallExpression = nextMeaningfulToken(tokens, endIndex)
    if (
      tokenAfterCallExpression?.token?.type === 'operator' &&
      tokenAfterCallExpression.token.value !== '|>'
    ) {
      const { expression, lastIndex } = makeBinaryExpression(tokens, index)
      return {
        value: expression,
        lastIndex,
      }
    }
    const { expression, lastIndex } = makeCallExpression(tokens, index)
    return {
      value: expression,
      lastIndex,
    }
  }
  if (
    (currentToken.type === 'word' ||
      currentToken.type === 'number' ||
      currentToken.type === 'string') &&
    nextToken?.type === 'operator'
  ) {
    const { expression, lastIndex } = makeBinaryExpression(tokens, index)
    return {
      value: expression,
      lastIndex,
    }
  }
  if (currentToken.type === 'brace' && currentToken.value === '{') {
    const objExp = makeObjectExpression(tokens, index)
    return {
      value: objExp.expression,
      lastIndex: objExp.lastIndex,
    }
  }
  if (currentToken.type === 'brace' && currentToken.value === '[') {
    const arrExp = makeArrayExpression(tokens, index)
    return {
      value: arrExp.expression,
      lastIndex: arrExp.lastIndex,
    }
  }
  if (
    currentToken.type === 'word' &&
    (nextToken.type === 'period' ||
      (nextToken.type === 'brace' && nextToken.value === '['))
  ) {
    const memberExpression = makeMemberExpression(tokens, index)
    return {
      value: memberExpression.expression,
      lastIndex: memberExpression.lastIndex,
    }
  }
  if (currentToken.type === 'word') {
    const identifier = makeIdentifier(tokens, index)
    return {
      value: identifier,
      lastIndex: index,
    }
  }
  if (currentToken.type === 'number' || currentToken.type === 'string') {
    const literal = makeLiteral(tokens, index)
    return {
      value: literal,
      lastIndex: index,
    }
  }
  if (currentToken.type === 'brace' && currentToken.value === '(') {
    const closingBraceIndex = findClosingBrace(tokens, index)
    const arrowToken = nextMeaningfulToken(tokens, closingBraceIndex)
    if (
      arrowToken.token.type === 'operator' &&
      arrowToken.token.value === '=>'
    ) {
      const { expression, lastIndex: arrowFunctionLastIndex } =
        makeFunctionExpression(tokens, index)
      return {
        value: expression,
        lastIndex: arrowFunctionLastIndex,
      }
    } else {
      throw new KCLUnimplementedError(
        'expression with braces',
        rangeOfToken(currentToken)
      )
    }
  }
  if (currentToken.type === 'operator' && currentToken.value === '-') {
    const { expression, lastIndex } = makeUnaryExpression(tokens, index)
    return { value: expression, lastIndex }
  }
  throw new KCLSyntaxError(
    'Expected a previous Value if statement to match',
    rangeOfToken(currentToken)
  )
}

function makeVariableDeclarators(
  tokens: Token[],
  index: number,
  previousDeclarators: VariableDeclarator[] = []
): {
  declarations: VariableDeclarator[]
  lastIndex: number
} {
  const currentToken = tokens[index]
  const assignmentToken = nextMeaningfulToken(tokens, index)
  const declarationToken = previousMeaningfulToken(tokens, index)
  const contentsStartToken = nextMeaningfulToken(tokens, assignmentToken.index)
  const pipeStartIndex =
    assignmentToken?.token?.type === 'operator'
      ? contentsStartToken.index
      : assignmentToken.index
  const nextPipeOperator = hasPipeOperator(tokens, pipeStartIndex)
  let init: Value
  let lastIndex = contentsStartToken.index
  if (nextPipeOperator) {
    const { expression, lastIndex: pipeLastIndex } = makePipeExpression(
      tokens,
      assignmentToken.index
    )
    init = expression
    lastIndex = pipeLastIndex
  } else {
    const { value, lastIndex: valueLastIndex } = makeValue(
      tokens,
      contentsStartToken.index
    )
    init = value
    lastIndex = valueLastIndex
  }
  const currentDeclarator: VariableDeclarator = {
    type: 'VariableDeclarator',
    start: currentToken.start,
    end: tokens[lastIndex].end,
    id: makeIdentifier(tokens, index),
    init,
  }
  return {
    declarations: [...previousDeclarators, currentDeclarator],
    lastIndex,
  }
}

function makeIdentifier(token: Token[], index: number): Identifier {
  const currentToken = token[index]
  return {
    type: 'Identifier',
    start: currentToken.start,
    end: currentToken.end,
    name: currentToken.value,
  }
}

function makeLiteral(tokens: Token[], index: number): Literal {
  const token = tokens[index]
  const value =
    token.type === 'number' ? Number(token.value) : token.value.slice(1, -1)
  return {
    type: 'Literal',
    start: token.start,
    end: token.end,
    value,
    raw: token.value,
  }
}

function makeArrayElements(
  tokens: Token[],
  index: number,
  previousElements: Value[] = []
): { elements: ArrayExpression['elements']; lastIndex: number } {
  // should be called with the first token after the opening brace
  const firstElementToken = tokens[index]
  if (firstElementToken.type === 'brace' && firstElementToken.value === ']') {
    return {
      elements: previousElements,
      lastIndex: index,
    }
  }
  const currentElement = makeValue(tokens, index)
  const nextToken = nextMeaningfulToken(tokens, currentElement.lastIndex)
  const isClosingBrace =
    nextToken.token.type === 'brace' && nextToken.token.value === ']'
  const isComma = nextToken.token.type === 'comma'
  if (!isClosingBrace && !isComma) {
    throw new KCLSyntaxError(
      'Expected a comma or closing brace',
      rangeOfToken(nextToken.token)
    )
  }
  const nextCallIndex = isClosingBrace
    ? nextToken.index
    : nextMeaningfulToken(tokens, nextToken.index).index
  return makeArrayElements(tokens, nextCallIndex, [
    ...previousElements,
    currentElement.value,
  ])
}

function makeArrayExpression(
  tokens: Token[],
  index: number
): {
  expression: ArrayExpression
  lastIndex: number
} {
  // should be called with index to an array opening brace '['
  const openingBraceToken = tokens[index]
  const firstElementToken = nextMeaningfulToken(tokens, index)
  const { elements, lastIndex } = makeArrayElements(
    tokens,
    firstElementToken.index
  )
  return {
    expression: {
      type: 'ArrayExpression',
      start: openingBraceToken.start,
      end: tokens[lastIndex].end,
      elements,
    },
    lastIndex,
  }
}

function makeObjectExpression(
  tokens: Token[],
  index: number
): {
  expression: ObjectExpression
  lastIndex: number
} {
  // should be called with the opening brace '{' index
  const openingBraceToken = tokens[index]
  const firstPropertyToken = nextMeaningfulToken(tokens, index)
  const { properties, lastIndex } = makeObjectProperties(
    tokens,
    firstPropertyToken.index
  )
  return {
    expression: {
      type: 'ObjectExpression',
      start: openingBraceToken.start,
      end: tokens[lastIndex].end,
      properties,
    },
    lastIndex,
  }
}

function makeObjectProperties(
  tokens: Token[],
  index: number,
  previousProperties: ObjectProperty[] = []
): { properties: ObjectProperty[]; lastIndex: number } {
  // should be called with the key after the opening brace '{'
  const propertyKeyToken = tokens[index]
  if (propertyKeyToken.type === 'brace' && propertyKeyToken.value === '}') {
    return {
      properties: previousProperties,
      lastIndex: index,
    }
  }
  const colonToken = nextMeaningfulToken(tokens, index)
  const valueStartToken = nextMeaningfulToken(tokens, colonToken.index)

  const val = makeValue(tokens, valueStartToken.index)

  const value = val.value
  const valueLastIndex = val.lastIndex
  const commaOrClosingBraceToken = nextMeaningfulToken(tokens, valueLastIndex)
  let objectProperty: ObjectProperty = {
    type: 'ObjectProperty',
    start: propertyKeyToken.start,
    end: value.end,
    key: makeIdentifier(tokens, index),
    value,
  }
  const nextKeyToken = nextMeaningfulToken(
    tokens,
    commaOrClosingBraceToken.index
  )
  const nextKeyIndex =
    commaOrClosingBraceToken.token.type === 'brace' &&
    commaOrClosingBraceToken.token.value === '}'
      ? commaOrClosingBraceToken.index
      : nextKeyToken.index
  return makeObjectProperties(tokens, nextKeyIndex, [
    ...previousProperties,
    objectProperty,
  ])
}

function makeMemberExpression(
  tokens: Token[],
  index: number
): { expression: MemberExpression; lastIndex: number } {
  const currentToken = tokens[index]
  const keysInfo = collectObjectKeys(tokens, index)
  const lastKey = keysInfo[keysInfo.length - 1]
  const firstKey = keysInfo.shift()
  if (!firstKey)
    throw new KCLSyntaxError('Expected a key', rangeOfToken(currentToken))
  const root = makeIdentifier(tokens, index)
  let memberExpression: MemberExpression = {
    type: 'MemberExpression',
    start: currentToken.start,
    end: tokens[firstKey.index].end,
    object: root,
    property: firstKey.key,
    computed: firstKey.computed,
  }
  keysInfo.forEach(({ key, computed, index }, i) => {
    const endToken = tokens[index]
    memberExpression = {
      type: 'MemberExpression',
      start: currentToken.start,
      end: endToken.end,
      object: memberExpression,
      property: key,
      computed,
    }
  })

  return {
    expression: memberExpression,
    lastIndex: lastKey.index,
  }
}

function collectObjectKeys(
  tokens: Token[],
  index: number,
  previousKeys: ObjectKeyInfo[] = []
): ObjectKeyInfo[] {
  const nextToken = nextMeaningfulToken(tokens, index)
  const periodOrOpeningBracketToken =
    nextToken?.token?.type === 'brace' && nextToken.token.value === ']'
      ? nextMeaningfulToken(tokens, nextToken.index)
      : nextToken
  if (
    periodOrOpeningBracketToken?.token?.type !== 'period' &&
    periodOrOpeningBracketToken?.token?.type !== 'brace'
  ) {
    return previousKeys
  }
  const keyToken = nextMeaningfulToken(
    tokens,
    periodOrOpeningBracketToken.index
  )
  const nextPeriodOrOpeningBracketToken = nextMeaningfulToken(
    tokens,
    keyToken.index
  )
  const isBraced =
    nextPeriodOrOpeningBracketToken?.token?.type === 'brace' &&
    nextPeriodOrOpeningBracketToken?.token?.value === ']'
  const endIndex = isBraced
    ? nextPeriodOrOpeningBracketToken.index
    : keyToken.index
  const key =
    keyToken.token.type === 'word'
      ? makeIdentifier(tokens, keyToken.index)
      : makeLiteral(tokens, keyToken.index)
  const computed = isBraced && keyToken.token.type === 'word' ? true : false
  return collectObjectKeys(tokens, keyToken.index, [
    ...previousKeys,
    {
      key,
      index: endIndex,
      computed,
    },
  ])
}

export function findEndOfBinaryExpression(
  tokens: Token[],
  index: number
): number {
  const currentToken = tokens[index]
  if (currentToken.type === 'brace' && currentToken.value === '(') {
    const closingParenthesis = findClosingBrace(tokens, index)
    const maybeAnotherOperator = nextMeaningfulToken(tokens, closingParenthesis)
    if (
      maybeAnotherOperator?.token?.type !== 'operator' ||
      maybeAnotherOperator?.token?.value === '|>'
    ) {
      return closingParenthesis
    }
    const nextRight = nextMeaningfulToken(tokens, maybeAnotherOperator.index)
    return findEndOfBinaryExpression(tokens, nextRight.index)
  }
  if (
    currentToken.type === 'word' &&
    tokens?.[index + 1]?.type === 'brace' &&
    tokens[index + 1].value === '('
  ) {
    const closingParenthesis = findClosingBrace(tokens, index + 1)
    const maybeAnotherOperator = nextMeaningfulToken(tokens, closingParenthesis)
    if (
      maybeAnotherOperator?.token?.type !== 'operator' ||
      maybeAnotherOperator?.token?.value === '|>'
    ) {
      return closingParenthesis
    }
    const nextRight = nextMeaningfulToken(tokens, maybeAnotherOperator.index)
    return findEndOfBinaryExpression(tokens, nextRight.index)
  }
  const maybeOperator = nextMeaningfulToken(tokens, index)
  if (
    maybeOperator?.token?.type !== 'operator' ||
    maybeOperator?.token?.value === '|>'
  ) {
    return index
  }
  const nextRight = nextMeaningfulToken(tokens, maybeOperator.index)
  return findEndOfBinaryExpression(tokens, nextRight.index)
}

function makeBinaryExpression(
  tokens: Token[],
  index: number
): { expression: BinaryExpression; lastIndex: number } {
  const endIndex = findEndOfBinaryExpression(tokens, index)
  const expression = parseExpression(tokens.slice(index, endIndex + 1))
  return {
    expression,
    lastIndex: endIndex,
  }
}

function makeUnaryExpression(
  tokens: Token[],
  index: number
): { expression: UnaryExpression; lastIndex: number } {
  const currentToken = tokens[index]
  const nextToken = nextMeaningfulToken(tokens, index)
  const { value: argument, lastIndex: argumentLastIndex } = makeValue(
    tokens,
    nextToken.index
  )
  return {
    expression: {
      type: 'UnaryExpression',
      operator: currentToken.value === '!' ? '!' : '-',
      start: currentToken.start,
      end: tokens[argumentLastIndex].end,
      argument: argument as BinaryPart,
    },
    lastIndex: argumentLastIndex,
  }
}

function makePipeExpression(
  tokens: Token[],
  index: number
): { expression: PipeExpression; lastIndex: number } {
  const currentToken = tokens[index]
  const {
    body,
    lastIndex: bodyLastIndex,
    nonCodeMeta,
  } = makePipeBody(tokens, index)
  const endToken = tokens[bodyLastIndex]
  return {
    expression: {
      type: 'PipeExpression',
      start: currentToken.start,
      end: endToken.end,
      body,
      nonCodeMeta,
    },
    lastIndex: bodyLastIndex,
  }
}

function makePipeBody(
  tokens: Token[],
  index: number,
  previousValues: Value[] = [],
  previousNonCodeMeta: NoneCodeMeta = { noneCodeNodes: {} }
): { body: Value[]; lastIndex: number; nonCodeMeta: NoneCodeMeta } {
  const nonCodeMeta = { ...previousNonCodeMeta }
  const currentToken = tokens[index]
  const expressionStart = nextMeaningfulToken(tokens, index)
  let value: Value
  let lastIndex: number
  if (currentToken.type === 'operator') {
    const val = makeValue(tokens, expressionStart.index)
    value = val.value
    lastIndex = val.lastIndex
  } else {
    throw new KCLSyntaxError(
      'Expected a previous PipeValue if statement to match',
      rangeOfToken(currentToken)
    )
  }

  const nextPipeToken = hasPipeOperator(tokens, index)
  if (!nextPipeToken) {
    return {
      body: [...previousValues, value],
      lastIndex,
      nonCodeMeta,
    }
  }
  if (nextPipeToken.bonusNonCodeNode) {
    nonCodeMeta.noneCodeNodes[previousValues.length] =
      nextPipeToken.bonusNonCodeNode
  }
  return makePipeBody(
    tokens,
    nextPipeToken.index,
    [...previousValues, value],
    nonCodeMeta
  )
}

function makeFunctionExpression(
  tokens: Token[],
  index: number
): { expression: FunctionExpression; lastIndex: number } {
  const currentToken = tokens[index]
  const closingBraceIndex = findClosingBrace(tokens, index)
  const arrowToken = nextMeaningfulToken(tokens, closingBraceIndex)
  const bodyStartToken = nextMeaningfulToken(tokens, arrowToken.index)
  const { params } = makeParams(tokens, index)
  const { block, lastIndex: bodyLastIndex } = makeBlockStatement(
    tokens,
    bodyStartToken.index
  )
  return {
    expression: {
      type: 'FunctionExpression',
      start: currentToken.start,
      end: tokens[bodyLastIndex].end,
      id: null,
      params,
      body: block,
    },
    lastIndex: bodyLastIndex,
  }
}

function makeParams(
  tokens: Token[],
  index: number,
  previousParams: Identifier[] = []
): { params: Identifier[]; lastIndex: number } {
  const braceOrCommaToken = tokens[index]
  const argumentToken = nextMeaningfulToken(tokens, index)
  const shouldFinishRecursion =
    (argumentToken.token.type === 'brace' &&
      argumentToken.token.value === ')') ||
    (braceOrCommaToken.type === 'brace' && braceOrCommaToken.value === ')')
  if (shouldFinishRecursion) {
    return { params: previousParams, lastIndex: index }
  }
  const nextBraceOrCommaToken = nextMeaningfulToken(tokens, argumentToken.index)
  const identifier = makeIdentifier(tokens, argumentToken.index)
  return makeParams(tokens, nextBraceOrCommaToken.index, [
    ...previousParams,
    identifier,
  ])
}

function makeBlockStatement(
  tokens: Token[],
  index: number
): { block: BlockStatement; lastIndex: number } {
  const openingCurly = tokens[index]
  const nextToken = { token: tokens[index + 1], index: index + 1 }
  const { body, lastIndex, nonCodeMeta } =
    nextToken.token.value === '}'
      ? {
          body: [],
          lastIndex: nextToken.index,
          nonCodeMeta: { noneCodeNodes: {} },
        }
      : makeBody({ tokens, tokenIndex: nextToken.index })
  return {
    block: {
      type: 'BlockStatement',
      start: openingCurly.start,
      end: tokens[lastIndex]?.end || 0,
      body,
      nonCodeMeta,
    },
    lastIndex,
  }
}

function makeReturnStatement(
  tokens: Token[],
  index: number
): { statement: ReturnStatement; lastIndex: number } {
  const currentToken = tokens[index]
  const nextToken = nextMeaningfulToken(tokens, index)
  const { value, lastIndex } = makeValue(tokens, nextToken.index)
  return {
    statement: {
      type: 'ReturnStatement',
      start: currentToken.start,
      end: tokens[lastIndex].end,
      argument: value,
    },
    lastIndex,
  }
}

function nextMeaningfulToken(
  tokens: Token[],
  index: number,
  offset: number = 1
): { token: Token; index: number; bonusNonCodeNode?: NoneCodeNode } {
  const newIndex = index + offset
  const token = tokens[newIndex]
  if (!token) {
    return { token, index: tokens.length }
  }
  if (isNotCodeToken(token)) {
    const nonCodeNode = makeNoneCodeNode(tokens, newIndex)
    const newnewIndex = nonCodeNode.lastIndex + 1
    return {
      token: tokens[newnewIndex],
      index: newnewIndex,
      bonusNonCodeNode: nonCodeNode?.node?.value ? nonCodeNode.node : undefined,
    }
  }
  return { token, index: newIndex }
}

function previousMeaningfulToken(
  tokens: Token[],
  index: number,
  offset: number = 1
): { token: Token; index: number } {
  const newIndex = index - offset
  const token = tokens[newIndex]
  if (!token) {
    return { token, index: 0 }
  }
  if (isNotCodeToken(token)) {
    return previousMeaningfulToken(tokens, index, offset + 1)
  }
  return { token, index: newIndex }
}

function makeBody(
  {
    tokens,
    tokenIndex = 0,
  }: {
    tokens: Token[]
    tokenIndex?: number
  },
  previousBody: BodyItem[] = [],
  previousNonCodeMeta: NoneCodeMeta = { noneCodeNodes: {} }
): { body: BodyItem[]; lastIndex: number; nonCodeMeta: NoneCodeMeta } {
  const nonCodeMeta = { ...previousNonCodeMeta }
  if (tokenIndex >= tokens.length) {
    return { body: previousBody, lastIndex: tokenIndex, nonCodeMeta }
  }

  const token = tokens[tokenIndex]
  if (token.type === 'brace' && token.value === '}') {
    return { body: previousBody, lastIndex: tokenIndex, nonCodeMeta }
  }
  if (isNotCodeToken(token)) {
    const nextToken = nextMeaningfulToken(tokens, tokenIndex, 0)
    if (nextToken.bonusNonCodeNode) {
      if (previousBody.length === 0) {
        nonCodeMeta.start = nextToken.bonusNonCodeNode
      } else {
        nonCodeMeta.noneCodeNodes[previousBody.length] =
          nextToken.bonusNonCodeNode
      }
    }
    return makeBody(
      { tokens, tokenIndex: nextToken.index },
      previousBody,
      nonCodeMeta
    )
  }
  const nextToken = nextMeaningfulToken(tokens, tokenIndex)
  nextToken.bonusNonCodeNode &&
    (nonCodeMeta.noneCodeNodes[previousBody.length] =
      nextToken.bonusNonCodeNode)

  if (
    token.type === 'word' &&
    (token.value === 'const' || token.value === 'fn')
  ) {
    const { declaration, lastIndex } = makeVariableDeclaration(
      tokens,
      tokenIndex
    )
    const nextThing = nextMeaningfulToken(tokens, lastIndex)
    nextThing.bonusNonCodeNode &&
      (nonCodeMeta.noneCodeNodes[previousBody.length] =
        nextThing.bonusNonCodeNode)

    return makeBody(
      { tokens, tokenIndex: nextThing.index },
      [...previousBody, declaration],
      nonCodeMeta
    )
  }
  if (token.type === 'word' && token.value === 'return') {
    const { statement, lastIndex } = makeReturnStatement(tokens, tokenIndex)
    const nextThing = nextMeaningfulToken(tokens, lastIndex)
    nextThing.bonusNonCodeNode &&
      (nonCodeMeta.noneCodeNodes[previousBody.length] =
        nextThing.bonusNonCodeNode)

    return makeBody(
      { tokens, tokenIndex: nextThing.index },
      [...previousBody, statement],
      nonCodeMeta
    )
  }
  if (
    token.type === 'word' &&
    nextToken.token.type === 'brace' &&
    nextToken.token.value === '('
  ) {
    const { expression, lastIndex } = makeExpressionStatement(
      tokens,
      tokenIndex
    )
    const nextThing = nextMeaningfulToken(tokens, lastIndex)
    if (nextThing.bonusNonCodeNode) {
      nonCodeMeta.noneCodeNodes[previousBody.length] =
        nextThing.bonusNonCodeNode
    }

    return makeBody(
      { tokens, tokenIndex: nextThing.index },
      [...previousBody, expression],
      nonCodeMeta
    )
  }
  const nextThing = nextMeaningfulToken(tokens, tokenIndex)
  if (
    (token.type === 'number' || token.type === 'word') &&
    nextThing.token.type === 'operator'
  ) {
    if (nextThing.bonusNonCodeNode) {
      nonCodeMeta.noneCodeNodes[previousBody.length] =
        nextThing.bonusNonCodeNode
    }
    const { expression, lastIndex } = makeExpressionStatement(
      tokens,
      tokenIndex
    )
    return {
      body: [...previousBody, expression],
      nonCodeMeta: nonCodeMeta,
      lastIndex,
    }
  }
  throw new KCLSyntaxError('Unexpected token', rangeOfToken(token))
}
export const abstractSyntaxTree = (tokens: Token[]): Program => {
  const { body, nonCodeMeta } = makeBody({ tokens })
  const program: Program = {
    type: 'Program',
    start: 0,
    end: body[body.length - 1].end,
    body: body,
    nonCodeMeta,
  }
  return program
}

function findNextDeclarationKeyword(
  tokens: Token[],
  index: number
): { token: Token | null; index: number } {
  const nextToken = nextMeaningfulToken(tokens, index)
  if (nextToken.index >= tokens.length) {
    return { token: null, index: tokens.length - 1 }
  }
  if (
    nextToken.token.type === 'word' &&
    (nextToken.token.value === 'const' || nextToken.token.value === 'fn')
  ) {
    return nextToken
  }
  if (nextToken.token.type === 'brace' && nextToken.token.value === '(') {
    const closingBraceIndex = findClosingBrace(tokens, nextToken.index)
    const arrowToken = nextMeaningfulToken(tokens, closingBraceIndex)
    if (
      arrowToken?.token?.type === 'operator' &&
      arrowToken.token.value === '=>'
    ) {
      return nextToken
    }
    // probably should do something else here
    // throw new Error('Unexpected token')
  }
  return findNextDeclarationKeyword(tokens, nextToken.index)
}

function findNextCallExpression(
  tokens: Token[],
  index: number
): { token: Token | null; index: number } {
  const nextToken = nextMeaningfulToken(tokens, index)
  const veryNextToken = tokens[nextToken.index + 1] // i.e. without whitespace
  if (nextToken.index >= tokens.length) {
    return { token: null, index: tokens.length - 1 }
  }
  if (
    nextToken.token.type === 'word' &&
    veryNextToken?.type === 'brace' &&
    veryNextToken?.value === '('
  ) {
    return nextToken
  }
  return findNextCallExpression(tokens, nextToken.index)
}

function findNextClosingCurlyBrace(
  tokens: Token[],
  index: number
): { token: Token | null; index: number } {
  const nextToken = nextMeaningfulToken(tokens, index)
  if (nextToken.index >= tokens.length) {
    return { token: null, index: tokens.length - 1 }
  }
  if (nextToken.token.type === 'brace' && nextToken.token.value === '}') {
    return nextToken
  }
  if (nextToken.token.type === 'brace' && nextToken.token.value === '{') {
    const closingBraceIndex = findClosingBrace(tokens, nextToken.index)
    const tokenAfterClosingBrace = nextMeaningfulToken(
      tokens,
      closingBraceIndex
    )
    return findNextClosingCurlyBrace(tokens, tokenAfterClosingBrace.index)
  }
  return findNextClosingCurlyBrace(tokens, nextToken.index)
}

export function hasPipeOperator(
  tokens: Token[],
  index: number,
  _limitIndex = -1
): ReturnType<typeof nextMeaningfulToken> | false {
  // this probably still needs some work
  // should be called on expression statuments (i.e "lineTo" for lineTo(10, 10))
  let limitIndex = _limitIndex
  if (limitIndex === -1) {
    const callExpressionEnd = isCallExpression(tokens, index)
    if (callExpressionEnd !== -1) {
      const tokenAfterCallExpression = nextMeaningfulToken(
        tokens,
        callExpressionEnd
      )
      if (
        tokenAfterCallExpression?.token?.type === 'operator' &&
        tokenAfterCallExpression.token.value === '|>'
      ) {
        return tokenAfterCallExpression
      }
      return false
    }
    const currentToken = tokens[index]
    if (currentToken?.type === 'brace' && currentToken?.value === '{') {
      const closingBraceIndex = findClosingBrace(tokens, index)
      const tokenAfterClosingBrace = nextMeaningfulToken(
        tokens,
        closingBraceIndex
      )
      if (
        tokenAfterClosingBrace?.token?.type === 'operator' &&
        tokenAfterClosingBrace.token.value === '|>'
      ) {
        return tokenAfterClosingBrace
      }
      return false
    }
    const nextDeclaration = findNextDeclarationKeyword(tokens, index)
    limitIndex = nextDeclaration.index
  }
  const nextToken = nextMeaningfulToken(tokens, index)
  if (nextToken.index >= limitIndex) {
    return false
  }
  if (nextToken.token.type === 'operator' && nextToken.token.value === '|>') {
    return nextToken
  }
  return hasPipeOperator(tokens, nextToken.index, limitIndex)
}

export function findClosingBrace(
  tokens: Token[],
  index: number,
  _braceCount: number = 0,
  _searchOpeningBrace: string = ''
): number {
  // should be called with the index of the opening brace
  const closingBraceMap: { [key: string]: string } = {
    '(': ')',
    '{': '}',
    '[': ']',
  }
  const currentToken = tokens[index]
  let searchOpeningBrace = _searchOpeningBrace

  const isFirstCall = !searchOpeningBrace && _braceCount === 0
  if (isFirstCall) {
    searchOpeningBrace = currentToken.value
    if (!['(', '{', '['].includes(searchOpeningBrace)) {
      throw new KCLSyntaxError(
        `expected to be started on a opening brace ( { [, instead found '${searchOpeningBrace}'`,
        rangeOfToken(currentToken)
      )
    }
  }

  const foundClosingBrace = (() => {
    try {
      return (
        _braceCount === 1 &&
        currentToken.value === closingBraceMap[searchOpeningBrace]
      )
    } catch (e: any) {
      throw new KCLSyntaxError(
        'Missing a closing brace',
        rangeOfToken(currentToken)
      )
    }
  })()

  const foundAnotherOpeningBrace = currentToken.value === searchOpeningBrace
  const foundAnotherClosingBrace =
    currentToken.value === closingBraceMap[searchOpeningBrace]

  if (foundClosingBrace) {
    return index
  }
  if (foundAnotherOpeningBrace) {
    return findClosingBrace(
      tokens,
      index + 1,
      _braceCount + 1,
      searchOpeningBrace
    )
  }
  if (foundAnotherClosingBrace) {
    return findClosingBrace(
      tokens,
      index + 1,
      _braceCount - 1,
      searchOpeningBrace
    )
  }
  // non-brace token, increment and continue
  return findClosingBrace(tokens, index + 1, _braceCount, searchOpeningBrace)
}

function isCallExpression(tokens: Token[], index: number): number {
  const currentToken = tokens[index]
  const veryNextToken = tokens[index + 1] // i.e. no whitespace
  if (
    currentToken.type === 'word' &&
    veryNextToken.type === 'brace' &&
    veryNextToken.value === '('
  ) {
    return findClosingBrace(tokens, index + 1)
  }
  return -1
}

function debuggerr(tokens: Token[], indexes: number[], msg = ''): string {
  // return ''
  const sortedIndexes = [...indexes].sort((a, b) => a - b)
  const min = Math.min(...indexes)
  const start = Math.min(Math.abs(min - 1), 0)
  const max = Math.max(...indexes)
  const end = Math.min(Math.abs(max + 1), tokens.length)
  const debugTokens = tokens.slice(start, end)
  const debugIndexes = indexes.map((i) => i - start)
  const debugStrings: [string, string][] = debugTokens.map((token, index) => {
    if (debugIndexes.includes(index)) {
      return [
        `${token.value.replaceAll('\n', ' ')}`,
        '^'.padEnd(token.value.length, '_'),
      ]
    }
    return [
      token.value.replaceAll('\n', ' '),
      ' '.padEnd(token.value.length, ' '),
    ]
  })
  let topString = ''
  let bottomString = ''
  debugStrings.forEach(([top, bottom]) => {
    topString += top
    bottomString += bottom
  })
  const debugResult = [
    `${msg} - debuggerr: ${sortedIndexes}`,
    topString,
    bottomString,
  ].join('\n')
  console.log(debugResult)
  return debugResult
}

export function isNotCodeToken(token: Token): boolean {
  return (
    token?.type === 'whitespace' ||
    token?.type === 'linecomment' ||
    token?.type === 'blockcomment'
  )
}

export function rangeOfToken(token: Token | undefined): [number, number][] {
  return token === undefined ? [] : [[token.start, token.end]]
}
