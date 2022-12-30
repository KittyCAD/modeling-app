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
} from './abstractSyntaxTree'

export function recast(
  ast: Program,
  previousWrittenCode = '',
  indentation = ''
): string {
  return ast.body
    .map((statement) => {
      if (statement.type === 'ExpressionStatement') {
        if (statement.expression.type === 'BinaryExpression') {
          return indentation + recastBinaryExpression(statement.expression)
        } else if (statement.expression.type === 'ArrayExpression') {
          return indentation + recastArrayExpression(statement.expression)
        } else if (statement.expression.type === 'CallExpression') {
          return indentation + recastCallExpression(statement.expression)
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
            return `${indentation}${statement.kind} ${
              declaration.id.name
            }${assignmentString}${recastValue(declaration.init)}`
          })
          .join('')
      } else if (statement.type === 'ReturnStatement') {
        return `${indentation}return ${recastArgument(statement.argument)}`
      }
      return statement.type
    })
    .join('\n')
}

function recastBinaryExpression(expression: BinaryExpression): string {
  return `${recastBinaryPart(expression.left)} ${
    expression.operator
  } ${recastBinaryPart(expression.right)}`
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

function recastBinaryPart(part: BinaryPart): string {
  if (part.type === 'Literal') {
    return recastLiteral(part)
  } else if (part.type === 'Identifier') {
    return part.name
  }
  throw new Error(`Cannot recast BinaryPart ${part}`)
}

function recastLiteral(literal: Literal): string {
  if (typeof literal.value === 'string') {
    const quote = literal.raw.trim().startsWith('"') ? '"' : "'"
    return `${quote}${literal.value}${quote}`
  }
  return String(literal?.value)
}

function recastCallExpression(expression: CallExpression): string {
  return `${expression.callee.name}(${expression.arguments
    .map(recastArgument)
    .join(', ')})`
}

function recastArgument(argument: Value): string {
  if (argument.type === 'Literal') {
    return recastLiteral(argument)
  } else if (argument.type === 'Identifier') {
    return argument.name
  } else if (argument.type === 'BinaryExpression') {
    return recastBinaryExpression(argument)
  } else if (argument.type === 'ArrayExpression') {
    return recastArrayExpression(argument)
  } else if (argument.type === 'CallExpression') {
    return recastCallExpression(argument)
  } else if (argument.type === 'FunctionExpression') {
    return recastFunction(argument)
  } else if (argument.type === 'PipeSubstitution') {
    return '%'
  }
  throw new Error(`Cannot recast argument ${argument}`)
}

function recastFunction(expression: FunctionExpression): string {
  return `(${expression.params.map((param) => param.name).join(', ')}) => {
  ${recast(expression.body)}
}`
}

function recastSketchExpression(
  expression: SketchExpression,
  indentation: string
): string {
  return `{
${recast(expression.body, '', indentation + '  ')}
}`
}

function recastValue(node: Value, indentation = ''): string {
  if (node.type === 'BinaryExpression') {
    return recastBinaryExpression(node)
  } else if (node.type === 'ArrayExpression') {
    return recastArrayExpression(node, indentation)
  } else if (node.type === 'Literal') {
    return recastLiteral(node)
  } else if (node.type === 'FunctionExpression') {
    return recastFunction(node)
  } else if (node.type === 'CallExpression') {
    return recastCallExpression(node)
  } else if (node.type === 'Identifier') {
    return node.name
  } else if (node.type === 'SketchExpression') {
    return recastSketchExpression(node, indentation)
  } else if (node.type === 'PipeExpression') {
    return node.body
      .map((statement): string => recastValue(statement, indentation))
      .join('\n  |> ')
  }
  return ''
}
