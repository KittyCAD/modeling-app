import { PathToNode, ProgramMemory } from './executor'
import { Selection } from '../useStore'
import {
  BinaryExpression,
  Program,
  SyntaxType,
  Value,
  CallExpression,
  ExpressionStatement,
  VariableDeclaration,
  ReturnStatement,
  ArrayExpression,
  Identifier,
} from './abstractSyntaxTree'
import { createIdentifier, splitPathAtLastIndex } from './modifyAst'

export function getNodeFromPath<T>(
  node: Program,
  path: PathToNode,
  stopAt: string | string[] = '',
  returnEarly = false
): {
  node: T
  shallowPath: PathToNode
  deepPath: PathToNode
} {
  let currentNode = node as any
  let stopAtNode = null
  let successfulPaths: PathToNode = []
  let pathsExplored: PathToNode = []
  for (const pathItem of path) {
    try {
      if (typeof currentNode[pathItem[0]] !== 'object')
        throw new Error('not an object')
      currentNode = currentNode?.[pathItem[0]]
      successfulPaths.push(pathItem)
      if (!stopAtNode) {
        pathsExplored.push(pathItem)
      }
      if (
        Array.isArray(stopAt)
          ? stopAt.includes(currentNode.type)
          : currentNode.type === stopAt
      ) {
        // it will match the deepest node of the type
        // instead of returning at the first match
        stopAtNode = currentNode
        if (returnEarly) {
          return {
            node: stopAtNode,
            shallowPath: pathsExplored,
            deepPath: successfulPaths,
          }
        }
      }
    } catch (e) {
      console.error(
        `Could not find path ${pathItem} in node ${JSON.stringify(
          currentNode,
          null,
          2
        )}, successful path was ${successfulPaths}`
      )
    }
  }
  return {
    node: stopAtNode || currentNode,
    shallowPath: pathsExplored,
    deepPath: successfulPaths,
  }
}

export function getNodeFromPathCurry(
  node: Program,
  path: PathToNode
): <T>(
  stopAt: string,
  returnEarly?: boolean
) => {
  node: T
  path: PathToNode
} {
  return <T>(stopAt: string = '', returnEarly = false) => {
    const { node: _node, shallowPath } = getNodeFromPath<T>(
      node,
      path,
      stopAt,
      returnEarly
    )
    return {
      node: _node,
      path: shallowPath,
    }
  }
}

function moreNodePathFromSourceRange(
  node: Value | ExpressionStatement | VariableDeclaration | ReturnStatement,
  sourceRange: Selection['range'],
  previousPath: PathToNode = [['body', '']]
): PathToNode {
  const [start, end] = sourceRange
  let path: PathToNode = [...previousPath]
  const _node = { ...node }

  if (start < _node.start || end > _node.end) return path

  const isInRange = _node.start <= start && _node.end >= end

  if ((_node.type === 'Identifier' || _node.type === 'Literal') && isInRange)
    return path

  if (_node.type === 'CallExpression' && isInRange) {
    const { callee, arguments: args } = _node
    if (
      callee.type === 'Identifier' &&
      callee.start <= start &&
      callee.end >= end
    ) {
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
    const declarations = _node.declarations

    for (let decIndex = 0; decIndex < declarations.length; decIndex++) {
      const declaration = declarations[decIndex]
      if (declaration.start <= start && declaration.end >= end) {
        path.push(['declarations', 'VariableDeclaration'])
        path.push([decIndex, 'index'])
        const init = declaration.init
        if (init.start <= start && init.end >= end) {
          path.push(['init', ''])
          return moreNodePathFromSourceRange(init, sourceRange, path)
        }
      }
    }
  }
  if (_node.type === 'VariableDeclaration' && isInRange) {
    const declarations = _node.declarations

    for (let decIndex = 0; decIndex < declarations.length; decIndex++) {
      const declaration = declarations[decIndex]
      if (declaration.start <= start && declaration.end >= end) {
        const init = declaration.init
        if (init.start <= start && init.end >= end) {
          path.push(['declarations', 'VariableDeclaration'])
          path.push([decIndex, 'index'])
          path.push(['init', ''])
          return moreNodePathFromSourceRange(init, sourceRange, path)
        }
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
  console.error('not implemented')
  return path
}

export function getNodePathFromSourceRange(
  node: Program,
  sourceRange: Selection['range'],
  previousPath: PathToNode = [['body', '']]
): PathToNode {
  const [start, end] = sourceRange
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

export interface PrevVariable<T> {
  key: string
  value: T
}

export function findAllPreviousVariables(
  ast: Program,
  programMemory: ProgramMemory,
  sourceRange: Selection['range'],
  type: 'number' | 'string' = 'number'
): {
  variables: PrevVariable<typeof type extends 'number' ? number : string>[]
  bodyPath: PathToNode
  insertIndex: number
} {
  const path = getNodePathFromSourceRange(ast, sourceRange)
  const { shallowPath: pathToDec } = getNodeFromPath(
    ast,
    path,
    'VariableDeclaration'
  )
  const { index: insertIndex, path: bodyPath } = splitPathAtLastIndex(pathToDec)

  const { node: bodyItems } = getNodeFromPath<Program['body']>(ast, bodyPath)

  const variables: PrevVariable<any>[] = []
  bodyItems?.forEach?.((item) => {
    if (item.type !== 'VariableDeclaration' || item.end > sourceRange[0]) return
    const varName = item.declarations[0].id.name
    const varValue = programMemory?.root[varName]
    if (typeof varValue?.value !== type) return
    variables.push({
      key: varName,
      value: varValue.value,
    })
  })

  return {
    insertIndex,
    bodyPath: bodyPath,
    variables,
  }
}

type ReplacerFn = (_ast: Program, varName: string) => { modifiedAst: Program }

export function isNodeSafeToReplace(
  ast: Program,
  sourceRange: [number, number]
): {
  isSafe: boolean
  value: Value
  replacer: ReplacerFn
} {
  let path = getNodePathFromSourceRange(ast, sourceRange)
  if (path[path.length - 1][0] === 'callee') {
    path = path.slice(0, -1)
  }
  const acceptedNodeTypes = [
    'BinaryExpression',
    'Identifier',
    'CallExpression',
    'Literal',
  ]
  const { node: value, deepPath: outPath } = getNodeFromPath(
    ast,
    path,
    acceptedNodeTypes
  )
  const { node: binValue, shallowPath: outBinPath } = getNodeFromPath(
    ast,
    path,
    'BinaryExpression'
  )
  // binaryExpression should take precedence
  const [finVal, finPath] =
    (binValue as Value)?.type === 'BinaryExpression'
      ? [binValue, outBinPath]
      : [value, outPath]

  const replaceNodeWithIdentifier: ReplacerFn = (_ast, varName) => {
    const identifier = createIdentifier(varName)
    const last = finPath[finPath.length - 1]
    const startPath = finPath.slice(0, -1)
    const nodeToReplace = getNodeFromPath(_ast, startPath).node as any
    nodeToReplace[last[0]] = identifier
    return { modifiedAst: _ast }
  }

  const hasPipeSub = isTypeInValue(finVal as Value, 'PipeSubstitution')
  const isIdentifierCallee = path[path.length - 1][0] !== 'callee'
  return {
    isSafe:
      !hasPipeSub &&
      isIdentifierCallee &&
      acceptedNodeTypes.includes((finVal as any)?.type) &&
      finPath.map(([_, type]) => type).includes('VariableDeclaration'),
    value: finVal as Value,
    replacer: replaceNodeWithIdentifier,
  }
}

export function isTypeInValue(node: Value, syntaxType: SyntaxType): boolean {
  if (node.type === syntaxType) return true
  if (node.type === 'BinaryExpression') return isTypeInBinExp(node, syntaxType)
  if (node.type === 'CallExpression') return isTypeInCallExp(node, syntaxType)
  if (node.type === 'ArrayExpression') return isTypeInArrayExp(node, syntaxType)
  return false
}

function isTypeInBinExp(
  node: BinaryExpression,
  syntaxType: SyntaxType
): boolean {
  if (node.type === syntaxType) return true
  if (node.left.type === syntaxType) return true
  if (node.right.type === syntaxType) return true

  return (
    isTypeInValue(node.left, syntaxType) ||
    isTypeInValue(node.right, syntaxType)
  )
}

function isTypeInCallExp(
  node: CallExpression,
  syntaxType: SyntaxType
): boolean {
  if (node.callee.type === syntaxType) return true
  return node.arguments.some((arg) => isTypeInValue(arg, syntaxType))
}

function isTypeInArrayExp(
  node: ArrayExpression,
  syntaxType: SyntaxType
): boolean {
  return node.elements.some((el) => isTypeInValue(el, syntaxType))
}
