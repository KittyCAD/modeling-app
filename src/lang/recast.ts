import {
  Program,
  BinaryExpression,
  BinaryPart,
  Literal,
  CallExpression,
  Value,
  FunctionExpression,
  SketchExpression,
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
        } else if (statement.expression.type === 'CallExpression') {
          return indentation + recastCallExpression(statement.expression)
        }
      } else if (statement.type === 'VariableDeclaration') {
        return statement.declarations
          .map((declaration) => {
            if (declaration.init.type === 'BinaryExpression') {
              return `${indentation}${statement.kind} ${
                declaration.id.name
              } = ${recastBinaryExpression(declaration.init)}`
            } else if (declaration.init.type === 'Literal') {
              return `${indentation}${statement.kind} ${
                declaration.id.name
              } = ${recastLiteral(declaration.init)}`
            } else if (declaration.init.type === 'FunctionExpression') {
              return `${indentation}${statement.kind} ${
                declaration.id.name
              } = ${recastFunction(declaration.init)}`
            } else if (declaration.init.type === 'CallExpression') {
              return `${indentation}${statement.kind} ${
                declaration.id.name
              } = ${recastCallExpression(declaration.init)}`
            } else if (declaration.init.type === 'SketchExpression') {
              return `${indentation}${statement.kind} ${
                declaration.id.name
              } ${recastSketchExpression(declaration.init, indentation)}`
            }
            return ''
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

function recastBinaryPart(part: BinaryPart): string {
  if (part.type === 'Literal') {
    return recastLiteral(part)
  } else if (part.type === 'Identifier') {
    return part.name
  }
  throw new Error(`Cannot recast ${part}`)
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
  } else if (argument.type === 'CallExpression') {
    return recastCallExpression(argument)
  } else if (argument.type === 'FunctionExpression') {
    return recastFunction(argument)
  }
  throw new Error(`Cannot recast ${argument}`)
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
