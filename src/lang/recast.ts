import {
  Program,
  BinaryExpression,
  BinaryPart,
  Literal,
  CallExpression,
  Value,
  FunctionExpression,
  SketchExpression,
  ArrayExpression,
  ObjectExpression,
  MemberExpression,
} from './abstractSyntaxTree'
import { precedence } from './astMathExpressions'
import { Token } from './tokeniser'
import { getNonCodeString, getStartNonCodeString } from './nonAstTokenHelpers'

export const processTokens = (tokens: Token[]): Token[] => {
  return tokens.filter((token) => {
    if (token.type === 'linecomment' || token.type === 'blockcomment')
      return true
    if (token.type === 'whitespace') {
      if (token.value.includes('\n')) return true
    }
    return false
  })
}

export function recast(
  ast: Program,
  tokens: Token[] = [],
  previousWrittenCode = '',
  indentation = ''
): string {
  let startComments = getStartNonCodeString(ast?.body?.[0], tokens)
  return (
    startComments +
    ast.body
      .map((statement) => {
        if (statement.type === 'ExpressionStatement') {
          if (statement.expression.type === 'BinaryExpression') {
            return recastBinaryExpression(statement.expression)
          } else if (statement.expression.type === 'ArrayExpression') {
            return recastArrayExpression(statement.expression)
          } else if (statement.expression.type === 'ObjectExpression') {
            return recastObjectExpression(statement.expression)
          } else if (statement.expression.type === 'CallExpression') {
            return recastCallExpression(statement.expression, tokens)
          }
        } else if (statement.type === 'VariableDeclaration') {
          return statement.declarations
            .map((declaration) => {
              const isSketchOrFirstPipeExpressionIsSketch =
                declaration.init.type === 'SketchExpression' ||
                (declaration.init.type === 'PipeExpression' &&
                  declaration.init.body[0].type === 'SketchExpression')

              const assignmentString = isSketchOrFirstPipeExpressionIsSketch
                ? ' '
                : ' = '
              return `${statement.kind} ${
                declaration.id.name
              }${assignmentString}${recastValue(declaration.init, '', tokens)}`
            })
            .join('')
        } else if (statement.type === 'ReturnStatement') {
          return `return ${recastArgument(statement.argument, tokens)}`
        }
        return statement.type
      })
      .map(
        (statementString, index) =>
          indentation +
          statementString +
          getNonCodeString(ast.body, index, tokens)
      )
      .join('\n')
  )
}

function recastBinaryExpression(expression: BinaryExpression): string {
  const maybeWrapIt = (a: string, doit: boolean) => (doit ? `(${a})` : a)

  const shouldWrapRight =
    expression.right.type === 'BinaryExpression' &&
    precedence(expression.operator) > precedence(expression.right.operator)
  const shouldWrapLeft =
    expression.left.type === 'BinaryExpression' &&
    precedence(expression.operator) > precedence(expression.left.operator)

  return `${maybeWrapIt(recastBinaryPart(expression.left), shouldWrapLeft)} ${
    expression.operator
  } ${maybeWrapIt(recastBinaryPart(expression.right), shouldWrapRight)}`
}

function recastArrayExpression(
  expression: ArrayExpression,
  indentation = ''
): string {
  const flatRecast = `[${expression.elements
    .map((el) => recastValue(el))
    .join(', ')}]`
  const maxArrayLength = 40
  if (flatRecast.length > maxArrayLength) {
    const _indentation = indentation + '  '
    return `[
${_indentation}${expression.elements
      .map((el) => recastValue(el))
      .join(`,\n${_indentation}`)}
]`
  }
  return flatRecast
}

function recastObjectExpression(
  expression: ObjectExpression,
  indentation = ''
): string {
  const flatRecast = `{ ${expression.properties
    .map((prop) => `${prop.key.name}: ${recastValue(prop.value)}`)
    .join(', ')} }`
  const maxArrayLength = 40
  if (flatRecast.length > maxArrayLength) {
    const _indentation = indentation + '  '
    return `{
${_indentation}${expression.properties
      .map((prop) => `${prop.key.name}: ${recastValue(prop.value)}`)
      .join(`,\n${_indentation}`)}
}`
  }
  return flatRecast
}

function recastBinaryPart(part: BinaryPart): string {
  if (part.type === 'Literal') {
    return recastLiteral(part)
  } else if (part.type === 'Identifier') {
    return part.name
  } else if (part.type === 'BinaryExpression') {
    return recastBinaryExpression(part)
  }
  return ''
  // throw new Error(`Cannot recast BinaryPart ${part}`)
}

function recastLiteral(literal: Literal): string {
  if (typeof literal.value === 'string') {
    const quote = literal.raw.trim().startsWith('"') ? '"' : "'"
    return `${quote}${literal.value}${quote}`
  }
  return String(literal?.value)
}

function recastCallExpression(
  expression: CallExpression,
  tokens: Token[] = []
): string {
  return `${expression.callee.name}(${expression.arguments
    .map((arg) => recastArgument(arg, tokens))
    .join(', ')})`
}

function recastArgument(argument: Value, tokens: Token[] = []): string {
  if (argument.type === 'Literal') {
    return recastLiteral(argument)
  } else if (argument.type === 'Identifier') {
    return argument.name
  } else if (argument.type === 'BinaryExpression') {
    return recastBinaryExpression(argument)
  } else if (argument.type === 'ArrayExpression') {
    return recastArrayExpression(argument)
  } else if (argument.type === 'ObjectExpression') {
    return recastObjectExpression(argument)
  } else if (argument.type === 'CallExpression') {
    return recastCallExpression(argument, tokens)
  } else if (argument.type === 'FunctionExpression') {
    return recastFunction(argument, tokens)
  } else if (argument.type === 'PipeSubstitution') {
    return '%'
  }
  throw new Error(`Cannot recast argument ${argument}`)
}

function recastFunction(
  expression: FunctionExpression,
  tokens: Token[] = [],
  indentation = ''
): string {
  return `(${expression.params.map((param) => param.name).join(', ')}) => {
${recast(expression.body, tokens, '', indentation + '  ')}
}`
}

function recastSketchExpression(
  expression: SketchExpression,
  indentation: string,
  tokens: Token[] = []
): string {
  return `{
${recast(expression.body, tokens, '', indentation + '  ').trimEnd()}
}`
}

function recastMemberExpression(
  expression: MemberExpression,
  indentation: string
): string {
  // TODO handle breaking into multiple lines if too long
  let keyString =
    expression.computed && expression.property.type === 'Identifier'
      ? `[${expression.property.name}]`
      : expression.property.type !== 'Identifier'
      ? `[${expression.property.raw}]`
      : `.${expression.property.name}`
  if (expression.object.type === 'MemberExpression') {
    return recastMemberExpression(expression.object, indentation) + keyString
  }
  return expression.object.name + keyString
}

function recastValue(
  node: Value,
  indentation = '',
  tokens: Token[] = []
): string {
  if (node.type === 'BinaryExpression') {
    return recastBinaryExpression(node)
  } else if (node.type === 'ArrayExpression') {
    return recastArrayExpression(node, indentation)
  } else if (node.type === 'ObjectExpression') {
    return recastObjectExpression(node, indentation)
  } else if (node.type === 'MemberExpression') {
    return recastMemberExpression(node, indentation)
  } else if (node.type === 'Literal') {
    return recastLiteral(node)
  } else if (node.type === 'FunctionExpression') {
    return recastFunction(node, tokens)
  } else if (node.type === 'CallExpression') {
    return recastCallExpression(node, tokens)
  } else if (node.type === 'Identifier') {
    return node.name
  } else if (node.type === 'SketchExpression') {
    return recastSketchExpression(node, indentation, tokens)
  } else if (node.type === 'PipeExpression') {
    return node.body
      .map((statement): string => recastValue(statement, indentation, tokens))
      .join('\n  |> ')
  }
  return ''
}
