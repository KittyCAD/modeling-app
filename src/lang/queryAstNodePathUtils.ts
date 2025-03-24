import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { TypeDeclaration } from '@rust/kcl-lib/bindings/TypeDeclaration'

import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import type {
  Expr,
  ExpressionStatement,
  Identifier,
  PathToNode,
  Program,
  ReturnStatement,
  SourceRange,
  VariableDeclaration,
} from '@src/lang/wasm'

function moreNodePathFromSourceRange(
  node: Node<
    | Expr
    | ImportStatement
    | ExpressionStatement
    | VariableDeclaration
    | TypeDeclaration
    | ReturnStatement
    | Identifier
  >,
  sourceRange: SourceRange,
  previousPath: PathToNode = [['body', '']]
): PathToNode {
  const [start, end] = sourceRange
  let path: PathToNode = [...previousPath]
  const _node = { ...node }

  if (start < _node.start || end > _node.end) return path

  const isInRange = _node.start <= start && _node.end >= end

  if (
    (_node.type === 'Name' ||
      _node.type === 'Literal' ||
      _node.type === 'TagDeclarator') &&
    isInRange
  ) {
    return path
  }

  if (_node.type === 'CallExpression' && isInRange) {
    const { callee, arguments: args } = _node
    if (callee.type === 'Name' && callee.start <= start && callee.end >= end) {
      path.push(['callee', 'CallExpression'])
      return path
    }
    if (args.length > 0) {
      for (let argIndex = 0; argIndex < args.length; argIndex++) {
        const arg = args[argIndex]
        if (arg.start <= start && arg.end >= end) {
          path.push(['arguments', 'CallExpression'])
          path.push([argIndex, 'index'])
          return moreNodePathFromSourceRange(arg, sourceRange, path)
        }
      }
    }
    return path
  }

  if (_node.type === 'CallExpressionKw' && isInRange) {
    const { callee, arguments: args } = _node
    if (callee.type === 'Name' && callee.start <= start && callee.end >= end) {
      path.push(['callee', 'CallExpressionKw'])
      return path
    }
    if (args.length > 0) {
      for (let argIndex = 0; argIndex < args.length; argIndex++) {
        const arg = args[argIndex].arg
        if (arg.start <= start && arg.end >= end) {
          path.push(['arguments', 'CallExpressionKw'])
          path.push([argIndex, ARG_INDEX_FIELD])
          path.push(['arg', LABELED_ARG_FIELD])
          return moreNodePathFromSourceRange(arg, sourceRange, path)
        }
      }
      return path
    }
    return path
  }

  if (_node.type === 'BinaryExpression' && isInRange) {
    const { left, right } = _node
    if (left.start <= start && left.end >= end) {
      path.push(['left', 'BinaryExpression'])
      return moreNodePathFromSourceRange(left, sourceRange, path)
    }
    if (right.start <= start && right.end >= end) {
      path.push(['right', 'BinaryExpression'])
      return moreNodePathFromSourceRange(right, sourceRange, path)
    }
    return path
  }
  if (_node.type === 'PipeExpression' && isInRange) {
    const { body } = _node
    for (let i = 0; i < body.length; i++) {
      const pipe = body[i]
      if (pipe.start <= start && pipe.end >= end) {
        path.push(['body', 'PipeExpression'])
        path.push([i, 'index'])
        return moreNodePathFromSourceRange(pipe, sourceRange, path)
      }
    }
    return path
  }
  if (_node.type === 'ArrayExpression' && isInRange) {
    const { elements } = _node
    for (let elIndex = 0; elIndex < elements.length; elIndex++) {
      const element = elements[elIndex]
      if (element.start <= start && element.end >= end) {
        path.push(['elements', 'ArrayExpression'])
        path.push([elIndex, 'index'])
        return moreNodePathFromSourceRange(element, sourceRange, path)
      }
    }
    return path
  }
  if (_node.type === 'ObjectExpression' && isInRange) {
    const { properties } = _node
    for (let propIndex = 0; propIndex < properties.length; propIndex++) {
      const property = properties[propIndex]
      if (property.start <= start && property.end >= end) {
        path.push(['properties', 'ObjectExpression'])
        path.push([propIndex, 'index'])
        if (property.key.start <= start && property.key.end >= end) {
          path.push(['key', 'Property'])
          return moreNodePathFromSourceRange(property.key, sourceRange, path)
        }
        if (property.value.start <= start && property.value.end >= end) {
          path.push(['value', 'Property'])
          return moreNodePathFromSourceRange(property.value, sourceRange, path)
        }
      }
    }
    return path
  }
  if (_node.type === 'ExpressionStatement' && isInRange) {
    const { expression } = _node
    path.push(['expression', 'ExpressionStatement'])
    return moreNodePathFromSourceRange(expression, sourceRange, path)
  }
  if (_node.type === 'VariableDeclaration' && isInRange) {
    const declaration = _node.declaration

    if (declaration.start <= start && declaration.end >= end) {
      path.push(['declaration', 'VariableDeclaration'])
      const init = declaration.init
      if (init.start <= start && init.end >= end) {
        path.push(['init', ''])
        return moreNodePathFromSourceRange(init, sourceRange, path)
      }
    }
  }
  if (_node.type === 'VariableDeclaration' && isInRange) {
    const declaration = _node.declaration

    if (declaration.start <= start && declaration.end >= end) {
      const init = declaration.init
      if (init.start <= start && init.end >= end) {
        path.push(['declaration', 'VariableDeclaration'])
        path.push(['init', ''])
        return moreNodePathFromSourceRange(init, sourceRange, path)
      }
    }
    return path
  }
  if (_node.type === 'UnaryExpression' && isInRange) {
    const { argument } = _node
    if (argument.start <= start && argument.end >= end) {
      path.push(['argument', 'UnaryExpression'])
      return moreNodePathFromSourceRange(argument, sourceRange, path)
    }
    return path
  }
  if (_node.type === 'FunctionExpression' && isInRange) {
    for (let i = 0; i < _node.params.length; i++) {
      const param = _node.params[i]
      if (param.identifier.start <= start && param.identifier.end >= end) {
        path.push(['params', 'FunctionExpression'])
        path.push([i, 'index'])
        return moreNodePathFromSourceRange(param.identifier, sourceRange, path)
      }
    }
    if (_node.body.start <= start && _node.body.end >= end) {
      path.push(['body', 'FunctionExpression'])
      const fnBody = _node.body.body
      for (let i = 0; i < fnBody.length; i++) {
        const statement = fnBody[i]
        if (statement.start <= start && statement.end >= end) {
          path.push(['body', 'FunctionExpression'])
          path.push([i, 'index'])
          return moreNodePathFromSourceRange(statement, sourceRange, path)
        }
      }
    }
    return path
  }
  if (_node.type === 'ReturnStatement' && isInRange) {
    const { argument } = _node
    if (argument.start <= start && argument.end >= end) {
      path.push(['argument', 'ReturnStatement'])
      return moreNodePathFromSourceRange(argument, sourceRange, path)
    }
    return path
  }
  if (_node.type === 'MemberExpression' && isInRange) {
    const { object, property } = _node
    if (object.start <= start && object.end >= end) {
      path.push(['object', 'MemberExpression'])
      return moreNodePathFromSourceRange(object, sourceRange, path)
    }
    if (property.start <= start && property.end >= end) {
      path.push(['property', 'MemberExpression'])
      return moreNodePathFromSourceRange(property, sourceRange, path)
    }
    return path
  }

  if (_node.type === 'PipeSubstitution' && isInRange) return path

  if (_node.type === 'IfExpression' && isInRange) {
    const { cond, then_val, else_ifs, final_else } = _node
    if (cond.start <= start && cond.end >= end) {
      path.push(['cond', 'IfExpression'])
      return moreNodePathFromSourceRange(cond, sourceRange, path)
    }
    if (then_val.start <= start && then_val.end >= end) {
      path.push(['then_val', 'IfExpression'])
      path.push(['body', 'IfExpression'])
      return getNodePathFromSourceRange(then_val, sourceRange, path)
    }
    for (let i = 0; i < else_ifs.length; i++) {
      const else_if = else_ifs[i]
      if (else_if.start <= start && else_if.end >= end) {
        path.push(['else_ifs', 'IfExpression'])
        path.push([i, 'index'])
        const { cond, then_val } = else_if
        if (cond.start <= start && cond.end >= end) {
          path.push(['cond', 'IfExpression'])
          return moreNodePathFromSourceRange(cond, sourceRange, path)
        }
        path.push(['then_val', 'IfExpression'])
        path.push(['body', 'IfExpression'])
        return getNodePathFromSourceRange(then_val, sourceRange, path)
      }
    }
    if (final_else.start <= start && final_else.end >= end) {
      path.push(['final_else', 'IfExpression'])
      path.push(['body', 'IfExpression'])
      return getNodePathFromSourceRange(final_else, sourceRange, path)
    }
    return path
  }

  if (_node.type === 'ImportStatement' && isInRange) {
    if (_node.selector && _node.selector.type === 'List') {
      path.push(['selector', 'ImportStatement'])
      const { items } = _node.selector
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.start <= start && item.end >= end) {
          path.push(['items', 'ImportSelector'])
          path.push([i, 'index'])
          if (item.name.start <= start && item.name.end >= end) {
            path.push(['name', 'ImportItem'])
            return path
          }
          if (
            item.alias &&
            item.alias.start <= start &&
            item.alias.end >= end
          ) {
            path.push(['alias', 'ImportItem'])
            return path
          }
          return path
        }
      }
      return path
    }
    return path
  }

  console.error('not implemented: ' + node.type)

  return path
}

export function getNodePathFromSourceRange(
  node: Program,
  sourceRange: SourceRange,
  previousPath: PathToNode = [['body', '']]
): PathToNode {
  const [start, end] = sourceRange || []
  let path: PathToNode = [...previousPath]
  const _node = { ...node }

  // loop over each statement in body getting the index with a for loop
  for (
    let statementIndex = 0;
    statementIndex < _node.body.length;
    statementIndex++
  ) {
    const statement = _node.body[statementIndex]
    if (statement.start <= start && statement.end >= end) {
      path.push([statementIndex, 'index'])
      return moreNodePathFromSourceRange(statement, sourceRange, path)
    }
  }
  return path
}
