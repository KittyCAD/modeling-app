import type { Identifier } from '@rust/kcl-lib/bindings/Identifier'
import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { TypeDeclaration } from '@rust/kcl-lib/bindings/TypeDeclaration'
import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import type {
  Expr,
  ExpressionStatement,
  PathToNode,
  Program,
  ReturnStatement,
  VariableDeclaration,
  VariableDeclarator,
} from '@src/lang/wasm'
import { isArray } from '@src/lib/utils'

type KCLNode = Node<
  | Expr
  | ExpressionStatement
  | ImportStatement
  | VariableDeclaration
  | VariableDeclarator
  | TypeDeclaration
  | ReturnStatement
  | Identifier
>

export function traverse(
  node: KCLNode | Node<Program>,
  option: {
    enter?: (node: KCLNode, pathToNode: PathToNode) => void
    leave?: (node: KCLNode) => void
  },
  pathToNode: PathToNode = []
) {
  const _node = node as KCLNode
  option?.enter?.(_node, pathToNode)
  const _traverse = (node: KCLNode, pathToNode: PathToNode) =>
    traverse(node, option, pathToNode)

  if (_node.type === 'VariableDeclaration') {
    _traverse(_node.declaration, [
      ...pathToNode,
      ['declaration', 'VariableDeclaration'],
    ])
  } else if (_node.type === 'VariableDeclarator') {
    _traverse(_node.init, [...pathToNode, ['init', '']])
  } else if (_node.type === 'ExpressionStatement') {
    _traverse(_node.expression, [
      ...pathToNode,
      ['expression', 'ExpressionStatement'],
    ])
  } else if (_node.type === 'PipeExpression') {
    _node.body.forEach((expression, index) =>
      _traverse(expression, [
        ...pathToNode,
        ['body', 'PipeExpression'],
        [index, 'index'],
      ])
    )
  } else if (_node.type === 'CallExpressionKw') {
    _traverse(_node.callee, [...pathToNode, ['callee', 'CallExpressionKw']])
    if (_node.unlabeled !== null) {
      _traverse(_node.unlabeled, [
        ...pathToNode,
        ['unlabeled', 'Unlabeled arg'],
      ])
    }
    if (_node.arguments) {
      _node.arguments.forEach((arg, index) =>
        _traverse(arg.arg, [
          ...pathToNode,
          ['arguments', 'CallExpressionKw'],
          [index, ARG_INDEX_FIELD],
          ['arg', LABELED_ARG_FIELD],
        ])
      )
    }
  } else if (_node.type === 'BinaryExpression') {
    _traverse(_node.left, [...pathToNode, ['left', 'BinaryExpression']])
    _traverse(_node.right, [...pathToNode, ['right', 'BinaryExpression']])
  } else if (_node.type === 'Name') {
    // do nothing
  } else if (_node.type === 'Literal') {
    // do nothing
  } else if (_node.type === 'TagDeclarator') {
    // do nothing
  } else if (_node.type === 'ArrayExpression') {
    _node.elements.forEach((el, index) =>
      _traverse(el, [
        ...pathToNode,
        ['elements', 'ArrayExpression'],
        [index, 'index'],
      ])
    )
  } else if (_node.type === 'ObjectExpression') {
    _node.properties.forEach(({ key, value }, index) => {
      _traverse(key, [
        ...pathToNode,
        ['properties', 'ObjectExpression'],
        [index, 'index'],
        ['key', 'Property'],
      ])
      _traverse(value, [
        ...pathToNode,
        ['properties', 'ObjectExpression'],
        [index, 'index'],
        ['value', 'Property'],
      ])
    })
  } else if (_node.type === 'UnaryExpression') {
    _traverse(_node.argument, [...pathToNode, ['argument', 'UnaryExpression']])
  } else if (_node.type === 'MemberExpression') {
    _traverse(_node.object, [...pathToNode, ['object', 'MemberExpression']])
    _traverse(_node.property, [...pathToNode, ['property', 'MemberExpression']])
  } else if (_node.type === 'ImportStatement') {
    // Do nothing.
  } else if ('body' in _node && isArray(_node.body)) {
    const program = node as Node<Program>
    program.body.forEach((expression, index) => {
      _traverse(expression, [...pathToNode, ['body', ''], [index, 'index']])
    })
  }
  option?.leave?.(_node)
}
