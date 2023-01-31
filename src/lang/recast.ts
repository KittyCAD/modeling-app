import { start } from 'repl'
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
  PipeExpression,
} from './abstractSyntaxTree'
import { precedence } from './astMathExpressions'

export function recast(
  ast: Program,
  previousWrittenCode = '',
  indentation = '',
  isWithBlock = false
): string {
  return ast.body
    .map((statement) => {
      if (statement.type === 'ExpressionStatement') {
        if (statement.expression.type === 'BinaryExpression') {
          return recastBinaryExpression(statement.expression)
        } else if (statement.expression.type === 'ArrayExpression') {
          return recastArrayExpression(statement.expression)
        } else if (statement.expression.type === 'ObjectExpression') {
          return recastObjectExpression(statement.expression)
        } else if (statement.expression.type === 'CallExpression') {
          return recastCallExpression(statement.expression)
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
            }${assignmentString}${recastValue(declaration.init)}`
          })
          .join('')
      } else if (statement.type === 'ReturnStatement') {
        return `return ${recastArgument(statement.argument)}`
      }
      return statement.type
    })
    .map((recastStr, index, arr) => {
      const isLegitCustomWhitespaceOrComment = (str: string) =>
        str !== ' ' && str !== '\n' && str !== '  '

      // determine the value of startString
      const lastWhiteSpaceOrComment =
        index > 0 ? ast?.nonCodeMeta?.[index - 1]?.value : ' '
      // indentation of this line will be covered by the previous if we're using a custom whitespace or comment
      let startString = isLegitCustomWhitespaceOrComment(
        lastWhiteSpaceOrComment
      )
        ? ''
        : indentation
      if (index === 0) {
        startString = ast?.nonCodeMeta?.start?.value || indentation
      }
      if (startString.endsWith('\n')) {
        startString += indentation
      }

      // determine the value of endString
      const maybeLineBreak: string =
        index === arr.length - 1 && !isWithBlock ? '' : '\n'
      let customWhiteSpaceOrComment = ast?.nonCodeMeta?.[index]?.value
      if (!isLegitCustomWhitespaceOrComment(customWhiteSpaceOrComment))
        customWhiteSpaceOrComment = ''
      let endString = customWhiteSpaceOrComment || maybeLineBreak

      return startString + recastStr + endString
    })
    .join('')
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
  } else if (argument.type === 'ObjectExpression') {
    return recastObjectExpression(argument)
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
  return `(${expression.params
    .map((param) => param.name)
    .join(', ')}) => {${recast(expression.body, '', '', true)}}`
}

function recastSketchExpression(
  expression: SketchExpression,
  indentation: string
): string {
  return `{${recast(expression.body, '', indentation + '  ', true) || '\n  \n'}}`
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

function recastValue(node: Value, indentation = ''): string {
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
    return recastFunction(node)
  } else if (node.type === 'CallExpression') {
    return recastCallExpression(node)
  } else if (node.type === 'Identifier') {
    return node.name
  } else if (node.type === 'SketchExpression') {
    return recastSketchExpression(node, indentation)
  } else if (node.type === 'PipeExpression') {
    return recastPipeExpression(node)
  }
  return ''
}

function recastPipeExpression(expression: PipeExpression): string {
  return expression.body
    .map((statement, index, arr): string => {
      let str = ''
      let indentation = '  '
      let maybeLineBreak = '\n'
      str = recastValue(statement)
      if (
        expression.nonCodeMeta?.[index]?.value &&
        expression.nonCodeMeta?.[index].value !== ' '
      ) {
        str += expression.nonCodeMeta[index]?.value
        indentation = ''
        maybeLineBreak = ''
      }
      if (index !== arr.length - 1) {
        str += maybeLineBreak + indentation + '|> '
      }
      return str
    })
    .join('')
}
