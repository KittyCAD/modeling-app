import { Token } from './tokeniser'

type syntaxType =
  | 'Program'
  | 'ExpressionStatement'
  | 'BinaryExpression'
  | 'NumberLiteral'
  | 'StringLiteral'
  | 'CallExpression'
  | 'Identifier'
  | 'BlockStatement'
  | 'IfStatement'
  | 'WhileStatement'
  | 'FunctionDeclaration'
  | 'ReturnStatement'
  | 'VariableDeclaration'
  | 'VariableDeclarator'
  | 'AssignmentExpression'
  | 'UnaryExpression'
  | 'MemberExpression'
  | 'ArrayExpression'
  | 'ObjectExpression'
  | 'ObjectProperty'
  | 'Property'
  | 'LogicalExpression'
  | 'ConditionalExpression'
  | 'ForStatement'
  | 'ForInStatement'
  | 'ForOfStatement'
  | 'BreakStatement'
  | 'ContinueStatement'
  | 'SwitchStatement'
  | 'SwitchCase'
  | 'ThrowStatement'
  | 'TryStatement'
  | 'CatchClause'
  | 'ClassDeclaration'
  | 'ClassBody'
  | 'MethodDefinition'
  | 'NewExpression'
  | 'ThisExpression'
  | 'UpdateExpression'
  // | "ArrowFunctionExpression"
  | 'FunctionExpression'
  | 'SketchExpression'
  | 'PipeExpression'
  | 'PipeSubstitution'
  | 'YieldExpression'
  | 'AwaitExpression'
  | 'ImportDeclaration'
  | 'ImportSpecifier'
  | 'ImportDefaultSpecifier'
  | 'ImportNamespaceSpecifier'
  | 'ExportNamedDeclaration'
  | 'ExportDefaultDeclaration'
  | 'ExportAllDeclaration'
  | 'ExportSpecifier'
  | 'TaggedTemplateExpression'
  | 'TemplateLiteral'
  | 'TemplateElement'
  | 'SpreadElement'
  | 'RestElement'
  | 'SequenceExpression'
  | 'DebuggerStatement'
  | 'LabeledStatement'
  | 'DoWhileStatement'
  | 'WithStatement'
  | 'EmptyStatement'
  | 'Literal'
  | 'ArrayPattern'
  | 'ObjectPattern'
  | 'AssignmentPattern'
  | 'MetaProperty'
  | 'Super'
  | 'Import'
  | 'RegExpLiteral'
  | 'BooleanLiteral'
  | 'NullLiteral'
  | 'TypeAnnotation'

export interface Program {
  type: syntaxType
  start: number
  end: number
  body: Body[]
}
interface GeneralStatement {
  type: syntaxType
  start: number
  end: number
}

interface ExpressionStatement extends GeneralStatement {
  type: 'ExpressionStatement'
  expression: Value
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

export interface CallExpression extends GeneralStatement {
  type: 'CallExpression'
  callee: Identifier
  arguments: Value[]
  optional: boolean
}

function makeCallExpression(
  tokens: Token[],
  index: number
): {
  expression: CallExpression
  lastIndex: number
} {
  const currentToken = tokens[index]
  const braceToken = nextMeaningfulToken(tokens, index)
  // const firstArgumentToken = nextMeaningfulToken(tokens, braceToken.index);
  const callee = makeIdentifier(tokens, index)
  const args = makeArguments(tokens, braceToken.index)
  // const closingBraceToken = nextMeaningfulToken(tokens, args.lastIndex);
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
  if (!isIdentifierOrLiteral) {
    const { expression, lastIndex } = makeBinaryExpression(tokens, index)
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
  throw new Error('Expected a previous Argument if statement to match')
}

interface VariableDeclaration extends GeneralStatement {
  type: 'VariableDeclaration'
  declarations: VariableDeclarator[]
  kind: 'const' | 'unknown' | 'fn' | 'sketch' | 'path' //| "solid" | "surface" | "face"
}

function makeVariableDeclaration(
  tokens: Token[],
  index: number
): { declaration: VariableDeclaration; lastIndex: number } {
  // token index should point to a declaration keyword i.e. const, fn, sketch, path
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
          : currentToken.value === 'sketch'
          ? 'sketch'
          : currentToken.value === 'path'
          ? 'path'
          : 'unknown',
      declarations,
    },
    lastIndex,
  }
}

export type Value =
  | Literal
  | Identifier
  | BinaryExpression
  | FunctionExpression
  | CallExpression
  | SketchExpression
  | PipeExpression
  | PipeSubstitution
  | ArrayExpression
  | ObjectExpression
  | MemberExpression

function makeValue(
  tokens: Token[],
  index: number
): { value: Value; lastIndex: number } {
  const currentToken = tokens[index]
  const { token: nextToken } = nextMeaningfulToken(tokens, index)
  // nextToken might be empty if it's at the end of the file
  if (nextToken?.type === 'brace' && nextToken.value === '(') {
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
      throw new Error('TODO - handle expression with braces')
    }
  }
  throw new Error('Expected a previous Value if statement to match')
}

export interface VariableDeclarator extends GeneralStatement {
  type: 'VariableDeclarator'
  id: Identifier
  init: Value
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
  } else if (
    declarationToken.token.type === 'word' &&
    declarationToken.token.value === 'sketch'
  ) {
    const sketchExp = makeSketchExpression(tokens, assignmentToken.index)
    init = sketchExp.expression
    lastIndex = sketchExp.lastIndex
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

export type BinaryPart = Literal | Identifier
// | BinaryExpression
// | CallExpression
// | MemberExpression
// | ArrayExpression
// | ObjectExpression
// | UnaryExpression
// | LogicalExpression
// | ConditionalExpression

export interface Literal extends GeneralStatement {
  type: 'Literal'
  value: string | number | boolean | null
  raw: string
}

interface Identifier extends GeneralStatement {
  type: 'Identifier'
  name: string
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

interface PipeSubstitution extends GeneralStatement {
  type: 'PipeSubstitution'
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

export interface ArrayExpression extends GeneralStatement {
  type: 'ArrayExpression'
  elements: Value[]
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
    throw new Error('Expected a comma or closing brace')
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
  // should be called array opening brace '[' index
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

export interface ObjectExpression extends GeneralStatement {
  type: 'ObjectExpression'
  properties: ObjectProperty[]
}

interface ObjectProperty extends GeneralStatement {
  type: 'ObjectProperty'
  key: Identifier
  value: Value
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

export interface MemberExpression extends GeneralStatement {
  type: 'MemberExpression'
  object: MemberExpression | Identifier
  property: Identifier | Literal
  computed: boolean
}

function makeMemberExpression(
  tokens: Token[],
  index: number
): { expression: MemberExpression; lastIndex: number } {
  const currentToken = tokens[index]
  const keysInfo = collectObjectKeys(tokens, index)
  const lastKey = keysInfo[keysInfo.length - 1]
  const firstKey = keysInfo.shift()
  if (!firstKey) throw new Error('Expected a key')
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

interface ObjectKeyInfo {
  key: Identifier | Literal
  index: number
  computed: boolean
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

export interface BinaryExpression extends GeneralStatement {
  type: 'BinaryExpression'
  operator: string
  left: BinaryPart
  right: BinaryPart
}

function makeBinaryPart(
  tokens: Token[],
  index: number
): { part: BinaryPart; lastIndex: number } {
  const currentToken = tokens[index]
  if (currentToken.type === 'word') {
    const identifier = makeIdentifier(tokens, index)
    return {
      part: identifier,
      lastIndex: index,
    }
  }
  if (currentToken.type === 'number' || currentToken.type === 'string') {
    const literal = makeLiteral(tokens, index)
    return {
      part: literal,
      lastIndex: index,
    }
  }
  throw new Error('Expected a previous BinaryPart if statement to match')
}

function makeBinaryExpression(
  tokens: Token[],
  index: number
): { expression: BinaryExpression; lastIndex: number } {
  const currentToken = tokens[index]
  const { part: left } = makeBinaryPart(tokens, index)
  const { token: operatorToken, index: operatorIndex } = nextMeaningfulToken(
    tokens,
    index
  )
  const rightToken = nextMeaningfulToken(tokens, operatorIndex)
  const { part: right } = makeBinaryPart(tokens, rightToken.index)
  return {
    expression: {
      type: 'BinaryExpression',
      start: currentToken.start,
      end: right.end,
      left,
      operator: operatorToken.value,
      right,
    },
    lastIndex: rightToken.index,
  }
}

export interface SketchExpression extends GeneralStatement {
  type: 'SketchExpression'
  body: BlockStatement
}

function makeSketchExpression(
  tokens: Token[],
  index: number
): { expression: SketchExpression; lastIndex: number } {
  const currentToken = tokens[index]
  const { block, lastIndex: bodyLastIndex } = makeBlockStatement(tokens, index)
  const endToken = tokens[bodyLastIndex]

  return {
    expression: {
      type: 'SketchExpression',
      start: currentToken.start,
      end: endToken.end,
      body: block,
    },
    lastIndex: bodyLastIndex,
  }
}

export interface PipeExpression extends GeneralStatement {
  type: 'PipeExpression'
  body: Value[]
}

function makePipeExpression(
  tokens: Token[],
  index: number
): { expression: PipeExpression; lastIndex: number } {
  const currentToken = tokens[index]
  const { body, lastIndex: bodyLastIndex } = makePipeBody(tokens, index)
  const endToken = tokens[bodyLastIndex]
  return {
    expression: {
      type: 'PipeExpression',
      start: currentToken.start,
      end: endToken.end,
      body,
    },
    lastIndex: bodyLastIndex,
  }
}

function makePipeBody(
  tokens: Token[],
  index: number,
  previousValues: Value[] = []
): { body: Value[]; lastIndex: number } {
  const currentToken = tokens[index]
  const expressionStart = nextMeaningfulToken(tokens, index)
  let value: Value
  let lastIndex: number
  if (currentToken.type === 'operator') {
    const val = makeValue(tokens, expressionStart.index)
    value = val.value
    lastIndex = val.lastIndex
  } else if (currentToken.type === 'brace' && currentToken.value === '{') {
    const sketch = makeSketchExpression(tokens, index)
    value = sketch.expression
    lastIndex = sketch.lastIndex
  } else {
    throw new Error('Expected a previous PipeValue if statement to match')
  }

  const nextPipeToken = hasPipeOperator(tokens, index)
  if (!nextPipeToken) {
    return {
      body: [...previousValues, value],
      lastIndex,
    }
  }
  // const nextToken = nextMeaningfulToken(tokens, nextPipeToken.index + 1)
  return makePipeBody(tokens, nextPipeToken.index, [...previousValues, value])
}

export interface FunctionExpression extends GeneralStatement {
  type: 'FunctionExpression'
  id: Identifier | null
  params: Identifier[]
  body: BlockStatement
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

interface BlockStatement extends GeneralStatement {
  type: 'BlockStatement'
  body: Body[]
}

function makeBlockStatement(
  tokens: Token[],
  index: number
): { block: BlockStatement; lastIndex: number } {
  const openingCurly = tokens[index]
  const nextToken = nextMeaningfulToken(tokens, index)
  const { body, lastIndex } =
    nextToken.token.value === '}'
      ? { body: [], lastIndex: nextToken.index }
      : makeBody({ tokens, tokenIndex: nextToken.index })
  return {
    block: {
      type: 'BlockStatement',
      start: openingCurly.start,
      end: tokens[lastIndex]?.end || 0,
      body,
    },
    lastIndex,
  }
}

interface ReturnStatement extends GeneralStatement {
  type: 'ReturnStatement'
  argument: Value
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

export type All = Program | ExpressionStatement[] | BinaryExpression | Literal

function nextMeaningfulToken(
  tokens: Token[],
  index: number,
  offset: number = 1
): { token: Token; index: number } {
  const newIndex = index + offset
  const token = tokens[newIndex]
  if (!token) {
    return { token, index: tokens.length }
  }
  if (token.type === 'whitespace') {
    return nextMeaningfulToken(tokens, index, offset + 1)
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
  if (token.type === 'whitespace') {
    return previousMeaningfulToken(tokens, index, offset + 1)
  }
  return { token, index: newIndex }
}

type Body = ExpressionStatement | VariableDeclaration | ReturnStatement

function makeBody(
  {
    tokens,
    tokenIndex = 0,
  }: {
    tokens: Token[]
    tokenIndex?: number
  },
  previousBody: Body[] = []
): { body: Body[]; lastIndex: number } {
  if (tokenIndex >= tokens.length) {
    return { body: previousBody, lastIndex: tokenIndex }
  }

  const token = tokens[tokenIndex]
  if (token.type === 'brace' && token.value === '}') {
    return { body: previousBody, lastIndex: tokenIndex }
  }
  if (typeof token === 'undefined') {
    console.log('probably should throw')
  }
  if (token.type === 'whitespace') {
    return makeBody({ tokens, tokenIndex: tokenIndex + 1 }, previousBody)
  }
  const nextToken = nextMeaningfulToken(tokens, tokenIndex)
  if (
    token.type === 'word' &&
    (token.value === 'const' ||
      token.value === 'fn' ||
      token.value === 'sketch' ||
      token.value === 'path')
  ) {
    const { declaration, lastIndex } = makeVariableDeclaration(
      tokens,
      tokenIndex
    )
    const nextThing = nextMeaningfulToken(tokens, lastIndex)
    return makeBody({ tokens, tokenIndex: nextThing.index }, [
      ...previousBody,
      declaration,
    ])
  }
  if (token.type === 'word' && token.value === 'return') {
    const { statement, lastIndex } = makeReturnStatement(tokens, tokenIndex)
    const nextThing = nextMeaningfulToken(tokens, lastIndex)
    return makeBody({ tokens, tokenIndex: nextThing.index }, [
      ...previousBody,
      statement,
    ])
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
    return makeBody({ tokens, tokenIndex: nextThing.index }, [
      ...previousBody,
      expression,
    ])
  }
  if (
    (token.type === 'number' || token.type === 'word') &&
    nextMeaningfulToken(tokens, tokenIndex).token.type === 'operator'
  ) {
    const { expression, lastIndex } = makeExpressionStatement(
      tokens,
      tokenIndex
    )
    // return startTree(tokens, tokenIndex, [...previousBody, makeExpressionStatement(tokens, tokenIndex)]);
    return { body: [...previousBody, expression], lastIndex }
  }
  throw new Error('Unexpected token')
}
export const abstractSyntaxTree = (tokens: Token[]): Program => {
  const { body } = makeBody({ tokens })
  const program: Program = {
    type: 'Program',
    start: 0,
    end: body[body.length - 1].end,
    body: body,
  }
  return program
}

export function findNextDeclarationKeyword(
  tokens: Token[],
  index: number
): { token: Token | null; index: number } {
  const nextToken = nextMeaningfulToken(tokens, index)
  if (nextToken.index >= tokens.length) {
    return { token: null, index: tokens.length - 1 }
  }
  if (
    nextToken.token.type === 'word' &&
    (nextToken.token.value === 'const' ||
      nextToken.token.value === 'fn' ||
      nextToken.token.value === 'sketch' ||
      nextToken.token.value === 'path')
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
    // return findNextDeclarationKeyword(tokens, nextToken.index)
    // probably should do something else here
    // throw new Error('Unexpected token')
  }
  return findNextDeclarationKeyword(tokens, nextToken.index)
}

export function findNextCallExpression(
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

export function findNextClosingCurlyBrace(
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
): { token: Token; index: number } | false {
  // this probably still needs some work
  // should be called on expression statuments (i.e "lineTo" for lineTo(10, 10)) or "{" for sketch declarations
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
      throw new Error(
        `expected to be started on a opening brace ( { [, instead found '${searchOpeningBrace}'`
      )
    }
  }

  const foundClosingBrace =
    _braceCount === 1 &&
    currentToken.value === closingBraceMap[searchOpeningBrace]
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

export function addSketchTo(
  node: Program,
  axis: 'xy' | 'xz' | 'yz',
  name = ''
): { modifiedAst: Program; id: string; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const _name = name || findUniqueName(node, 'mySketch')
  const sketchBody: BlockStatement = {
    type: 'BlockStatement',
    ...dumbyStartend,
    body: [],
  }
  const sketch: SketchExpression = {
    type: 'SketchExpression',
    ...dumbyStartend,
    body: sketchBody,
  }

  const rotate: CallExpression = {
    type: 'CallExpression',
    ...dumbyStartend,
    callee: {
      type: 'Identifier',
      ...dumbyStartend,
      name: axis === 'xz' ? 'rx' : 'ry',
    },
    arguments: [
      {
        type: 'Literal',
        ...dumbyStartend,
        value: axis === 'yz' ? 90 : 90,
        raw: axis === 'yz' ? '90' : '90',
      },
      {
        type: 'PipeSubstitution',
        ...dumbyStartend,
      },
    ],
    optional: false,
  }

  const pipChain: PipeExpression = {
    type: 'PipeExpression',
    ...dumbyStartend,
    body: [sketch, rotate],
  }

  const sketchVariableDeclaration: VariableDeclaration = {
    type: 'VariableDeclaration',
    ...dumbyStartend,
    kind: 'sketch',
    declarations: [
      {
        type: 'VariableDeclarator',
        ...dumbyStartend,
        id: {
          type: 'Identifier',
          ...dumbyStartend,
          name: _name,
        },
        init: axis === 'xy' ? sketch : pipChain,
      },
    ],
  }
  const showCallIndex = getShowIndex(_node)
  let sketchIndex = showCallIndex
  if (showCallIndex === -1) {
    _node.body = [...node.body, sketchVariableDeclaration]
    sketchIndex = _node.body.length - 1
  } else {
    const newBody = [...node.body]
    newBody.splice(showCallIndex, 0, sketchVariableDeclaration)
    _node.body = newBody
  }
  let pathToNode: (string | number)[] = [
    'body',
    sketchIndex,
    'declarations',
    '0',
    'init',
  ]
  if (axis !== 'xy') {
    pathToNode = [...pathToNode, 'body', '0']
  }

  return {
    modifiedAst: addToShow(_node, _name),
    id: _name,
    pathToNode,
  }
}

function findUniqueName(
  ast: Program | string,
  name: string,
  index = 1
): string {
  let searchStr = ''
  if (typeof ast === 'string') {
    searchStr = ast
  } else {
    searchStr = JSON.stringify(ast)
  }
  const indexStr = `${index}`.padStart(3, '0')
  const newName = `${name}${indexStr}`
  const isInString = searchStr.includes(newName)
  if (!isInString) {
    return newName
  }
  return findUniqueName(searchStr, name, index + 1)
}

function addToShow(node: Program, name: string): Program {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const showCallIndex = getShowIndex(_node)
  if (showCallIndex === -1) {
    const showCall: CallExpression = {
      type: 'CallExpression',
      ...dumbyStartend,
      callee: {
        type: 'Identifier',
        ...dumbyStartend,
        name: 'show',
      },
      optional: false,
      arguments: [
        {
          type: 'Identifier',
          ...dumbyStartend,
          name,
        },
      ],
    }
    const showExpressionStatement: ExpressionStatement = {
      type: 'ExpressionStatement',
      ...dumbyStartend,
      expression: showCall,
    }
    _node.body = [..._node.body, showExpressionStatement]
    return _node
  }
  const showCall = { ..._node.body[showCallIndex] } as ExpressionStatement
  const showCallArgs = (showCall.expression as CallExpression).arguments
  const newShowCallArgs: Value[] = [
    ...showCallArgs,
    {
      type: 'Identifier',
      ...dumbyStartend,
      name,
    },
  ]
  const newShowExpression: CallExpression = {
    type: 'CallExpression',
    ...dumbyStartend,
    callee: {
      type: 'Identifier',
      ...dumbyStartend,
      name: 'show',
    },
    optional: false,
    arguments: newShowCallArgs,
  }

  _node.body[showCallIndex] = {
    ...showCall,
    expression: newShowExpression,
  }
  return _node
}

function getShowIndex(node: Program): number {
  return node.body.findIndex(
    (statement) =>
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'CallExpression' &&
      statement.expression.callee.type === 'Identifier' &&
      statement.expression.callee.name === 'show'
  )
}

export function addLine(
  node: Program,
  pathToNode: (string | number)[],
  to: [number, number]
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const sketchExpression = getNodeFromPath(
    _node,
    pathToNode,
    'SketchExpression'
  ) as SketchExpression
  const line: ExpressionStatement = {
    type: 'ExpressionStatement',
    ...dumbyStartend,
    expression: {
      type: 'CallExpression',
      ...dumbyStartend,
      callee: {
        type: 'Identifier',
        ...dumbyStartend,
        name: 'lineTo',
      },
      optional: false,
      arguments: [
        {
          type: 'Literal',
          ...dumbyStartend,
          value: to[0],
          raw: `${to[0]}`,
        },
        {
          type: 'Literal',
          ...dumbyStartend,
          value: to[1],
          raw: `${to[1]}`,
        },
      ],
    },
  }
  const newBody = [...sketchExpression.body.body, line]
  sketchExpression.body.body = newBody
  return {
    modifiedAst: _node,
    pathToNode,
  }
}

export function changeArguments(
  node: Program,
  pathToNode: (string | number)[],
  args: [number, number]
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  // const thePath = getNodePathFromSourceRange(_node, sourceRange)
  const callExpression = getNodeFromPath(_node, pathToNode) as CallExpression
  const newXArg: CallExpression['arguments'][number] =
    callExpression.arguments[0].type === 'Literal'
      ? {
          type: 'Literal',
          ...dumbyStartend,
          value: args[0],
          raw: `${args[0]}`,
        }
      : {
          ...callExpression.arguments[0],
        }
  const newYArg: CallExpression['arguments'][number] =
    callExpression.arguments[1].type === 'Literal'
      ? {
          type: 'Literal',
          ...dumbyStartend,
          value: args[1],
          raw: `${args[1]}`,
        }
      : {
          ...callExpression.arguments[1],
        }
  callExpression.arguments = [newXArg, newYArg]
  return {
    modifiedAst: _node,
    pathToNode,
  }
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

export function getNodeFromPath(
  node: Program,
  path: (string | number)[],
  stopAt: string = ''
) {
  let currentNode = node as any
  let stopAtNode = null
  let successfulPaths: (string | number)[] = []
  for (const pathItem of path) {
    try {
      if (typeof currentNode[pathItem] !== 'object')
        throw new Error('not an object')
      currentNode = currentNode[pathItem]
      successfulPaths.push(pathItem)
      if (currentNode.type === stopAt) {
        // it will match the deepest node of the type
        // instead of returning at the first match
        stopAtNode = currentNode
      }
    } catch (e) {
      throw new Error(
        `Could not find path ${pathItem} in node ${JSON.stringify(
          currentNode,
          null,
          2
        )}, successful path was ${successfulPaths}`
      )
    }
  }
  return stopAtNode || currentNode
}

type Path = (string | number)[]

export function getNodePathFromSourceRange(
  node: Program,
  sourceRange: [number, number],
  previousPath: Path = []
): Path {
  const [start, end] = sourceRange
  let path: Path = [...previousPath, 'body']
  const _node = { ...node }
  // loop over each statement in body getting the index with a for loop
  for (
    let statementIndex = 0;
    statementIndex < _node.body.length;
    statementIndex++
  ) {
    const statement = _node.body[statementIndex]
    if (statement.start <= start && statement.end >= end) {
      path.push(statementIndex)
      if (statement.type === 'ExpressionStatement') {
        const expression = statement.expression
        if (expression.start <= start && expression.end >= end) {
          path.push('expression')
          if (expression.type === 'CallExpression') {
            const callee = expression.callee
            if (callee.start <= start && callee.end >= end) {
              path.push('callee')
              if (callee.type === 'Identifier') {
              }
            }
          }
        }
      } else if (statement.type === 'VariableDeclaration') {
        const declarations = statement.declarations

        for (let decIndex = 0; decIndex < declarations.length; decIndex++) {
          const declaration = declarations[decIndex]

          if (declaration.start <= start && declaration.end >= end) {
            path.push('declarations')
            path.push(decIndex)
            const init = declaration.init
            if (init.start <= start && init.end >= end) {
              path.push('init')
              if (init.type === 'SketchExpression') {
                const body = init.body
                if (body.start <= start && body.end >= end) {
                  path.push('body')
                  if (body.type === 'BlockStatement') {
                    path = getNodePathFromSourceRange(body, sourceRange, path)
                  }
                }
              } else if (init.type === 'PipeExpression') {
                const body = init.body
                for (let pipeIndex = 0; pipeIndex < body.length; pipeIndex++) {
                  const pipe = body[pipeIndex]
                  if (pipe.start <= start && pipe.end >= end) {
                    path.push('body')
                    path.push(pipeIndex)
                    if (pipe.type === 'SketchExpression') {
                      const body = pipe.body
                      if (body.start <= start && body.end >= end) {
                        path.push('body')
                        if (body.type === 'BlockStatement') {
                          path = getNodePathFromSourceRange(
                            body,
                            sourceRange,
                            path
                          )
                        }
                      }
                    }
                  }
                }
              } else if (init.type === 'CallExpression') {
                const callee = init.callee
                if (callee.start <= start && callee.end >= end) {
                  path.push('callee')
                  if (callee.type === 'Identifier') {
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return path
}
