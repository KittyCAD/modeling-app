import { Program, BinaryExpression, BinaryPart } from './abstractSyntaxTree'

export function recast(ast: Program, previousWrittenCode = ''): string {
  return ast.body
    .map((statement) => {
      if (statement.type === 'ExpressionStatement') {
        if (statement.expression.type === 'BinaryExpression') {
          return recastBinaryExpression(statement.expression)
        }
      } else if (statement.type === 'VariableDeclaration') {
        return statement.declarations
          .map((declaration) => {
            if (declaration.init.type === 'BinaryExpression') {
              return `${statement.kind} ${
                declaration.id.name
              } = ${recastBinaryExpression(declaration.init)}`
            } else if (declaration.init.type === 'Literal') {
              return `${statement.kind} ${declaration.id.name} = ${declaration.init.value}`
            }
            return ''
          })
          .join('')
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
    if (typeof part.value === 'string') {
      const quote = part.raw.includes('"') ? '"' : "'"
      return `${quote}${part.value}${quote}`
    }
    return String(part?.value)
  } else if (part.type === 'Identifier') {
    return part.name
  }
  throw new Error(`Cannot recast ${part}`)
}
