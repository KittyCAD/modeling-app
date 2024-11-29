import { ToolTip } from 'lang/langHelpers'
import { Selection, Selections } from 'lib/selections'
import {
  ArrayExpression,
  BinaryExpression,
  CallExpression,
  Expr,
  ExpressionStatement,
  ObjectExpression,
  ObjectProperty,
  PathToNode,
  PipeExpression,
  Program,
  ProgramMemory,
  ReturnStatement,
  sketchFromKclValue,
  sketchFromKclValueOptional,
  SourceRange,
  SyntaxType,
  VariableDeclaration,
  VariableDeclarator,
} from './wasm'
import { createIdentifier, splitPathAtLastIndex } from './modifyAst'
import { getSketchSegmentFromSourceRange } from './std/sketchConstraints'
import { getAngle } from '../lib/utils'
import { getFirstArg } from './std/sketch'
import {
  getConstraintLevelFromSourceRange,
  getConstraintType,
} from './std/sketchcombos'
import { err, Reason } from 'lib/trap'
import { ImportStatement } from 'wasm-lib/kcl/bindings/ImportStatement'
import { Node } from 'wasm-lib/kcl/bindings/Node'
import { ArtifactGraph, codeRefFromRange } from './std/artifactGraph'

/**
 * Retrieves a node from a given path within a Program node structure, optionally stopping at a specified node type.
 * This function navigates through the AST (Abstract Syntax Tree) based on the provided path, attempting to locate
 * and return the node at the end of this path.
 * By default it will return the node of the deepest "stopAt" type encountered, or the node at the end of the path if no "stopAt" type is provided.
 * If the "returnEarly" flag is set to true, the function will return as soon as a node of the specified type is found.
 */
export function getNodeFromPath<T>(
  node: Program,
  path: PathToNode,
  stopAt?: SyntaxType | SyntaxType[],
  returnEarly = false
):
  | {
      node: T
      shallowPath: PathToNode
      deepPath: PathToNode
    }
  | Error {
  let currentNode = node as any
  let stopAtNode = null
  let successfulPaths: PathToNode = []
  let pathsExplored: PathToNode = []
  for (const pathItem of path) {
    if (typeof currentNode[pathItem[0]] !== 'object') {
      if (stopAtNode) {
        return {
          node: stopAtNode,
          shallowPath: pathsExplored,
          deepPath: successfulPaths,
        }
      }
      return new Error('not an object')
    }
    currentNode = currentNode?.[pathItem[0]]
    successfulPaths.push(pathItem)
    if (!stopAtNode) {
      pathsExplored.push(pathItem)
    }
    if (
      typeof stopAt !== 'undefined' &&
      (Array.isArray(stopAt)
        ? stopAt.includes(currentNode.type)
        : currentNode.type === stopAt)
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
  }
  return {
    node: stopAtNode || currentNode,
    shallowPath: pathsExplored,
    deepPath: successfulPaths,
  }
}

/**
 * Functions the same as getNodeFromPath, but returns a curried function that can be called with the stopAt and returnEarly arguments.
 */
export function getNodeFromPathCurry(
  node: Program,
  path: PathToNode
): <T>(
  stopAt?: SyntaxType | SyntaxType[],
  returnEarly?: boolean
) =>
  | {
      node: T
      path: PathToNode
    }
  | Error {
  return <T>(stopAt?: SyntaxType | SyntaxType[], returnEarly = false) => {
    const _node1 = getNodeFromPath<T>(node, path, stopAt, returnEarly)
    if (err(_node1)) return _node1
    const { node: _node, shallowPath } = _node1
    return {
      node: _node,
      path: shallowPath,
    }
  }
}

function moreNodePathFromSourceRange(
  node: Node<
    | Expr
    | ImportStatement
    | ExpressionStatement
    | VariableDeclaration
    | ReturnStatement
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
    (_node.type === 'Identifier' ||
      _node.type === 'Literal' ||
      _node.type === 'TagDeclarator') &&
    isInRange
  ) {
    return path
  }

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
    const { items } = _node
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.start <= start && item.end >= end) {
        path.push(['items', 'ImportStatement'])
        path.push([i, 'index'])
        if (item.name.start <= start && item.name.end >= end) {
          path.push(['name', 'ImportItem'])
          return path
        }
        if (item.alias && item.alias.start <= start && item.alias.end >= end) {
          path.push(['alias', 'ImportItem'])
          return path
        }
        return path
      }
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

type KCLNode = Node<
  | Expr
  | ExpressionStatement
  | VariableDeclaration
  | VariableDeclarator
  | ReturnStatement
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
    _node.declarations.forEach((declaration, index) =>
      _traverse(declaration, [
        ...pathToNode,
        ['declarations', 'VariableDeclaration'],
        [index, 'index'],
      ])
    )
  } else if (_node.type === 'VariableDeclarator') {
    _traverse(_node.init, [...pathToNode, ['init', '']])
  } else if (_node.type === 'PipeExpression') {
    _node.body.forEach((expression, index) =>
      _traverse(expression, [
        ...pathToNode,
        ['body', 'PipeExpression'],
        [index, 'index'],
      ])
    )
  } else if (_node.type === 'CallExpression') {
    _traverse(_node.callee, [...pathToNode, ['callee', 'CallExpression']])
    _node.arguments.forEach((arg, index) =>
      _traverse(arg, [
        ...pathToNode,
        ['arguments', 'CallExpression'],
        [index, 'index'],
      ])
    )
  } else if (_node.type === 'BinaryExpression') {
    _traverse(_node.left, [...pathToNode, ['left', 'BinaryExpression']])
    _traverse(_node.right, [...pathToNode, ['right', 'BinaryExpression']])
  } else if (_node.type === 'Identifier') {
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
    // hmm this smell
    _traverse(_node.object, [...pathToNode, ['object', 'MemberExpression']])
    _traverse(_node.property, [...pathToNode, ['property', 'MemberExpression']])
  } else if ('body' in _node && Array.isArray(_node.body)) {
    _node.body.forEach((expression, index) =>
      _traverse(expression, [...pathToNode, ['body', ''], [index, 'index']])
    )
  }
  option?.leave?.(_node)
}

export interface PrevVariable<T> {
  key: string
  value: T
}

export function findAllPreviousVariablesPath(
  ast: Program,
  programMemory: ProgramMemory,
  path: PathToNode,
  type: 'number' | 'string' = 'number'
): {
  variables: PrevVariable<typeof type extends 'number' ? number : string>[]
  bodyPath: PathToNode
  insertIndex: number
} {
  const _node1 = getNodeFromPath(ast, path, 'VariableDeclaration')
  if (err(_node1)) {
    console.error(_node1)
    return {
      variables: [],
      bodyPath: [],
      insertIndex: 0,
    }
  }
  const { shallowPath: pathToDec, node } = _node1

  const startRange = (node as any).start

  const { index: insertIndex, path: bodyPath } = splitPathAtLastIndex(pathToDec)

  const _node2 = getNodeFromPath<Program['body']>(ast, bodyPath)
  if (err(_node2)) {
    console.error(_node2)
    return {
      variables: [],
      bodyPath: [],
      insertIndex: 0,
    }
  }
  const { node: bodyItems } = _node2

  const variables: PrevVariable<any>[] = []
  bodyItems?.forEach?.((item) => {
    if (item.type !== 'VariableDeclaration' || item.end > startRange) return
    const varName = item.declarations[0].id.name
    const varValue = programMemory?.get(varName)
    if (!varValue || typeof varValue?.value !== type) return
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

export function findAllPreviousVariables(
  ast: Program,
  programMemory: ProgramMemory,
  sourceRange: SourceRange,
  type: 'number' | 'string' = 'number'
): {
  variables: PrevVariable<typeof type extends 'number' ? number : string>[]
  bodyPath: PathToNode
  insertIndex: number
} {
  const path = getNodePathFromSourceRange(ast, sourceRange)
  return findAllPreviousVariablesPath(ast, programMemory, path, type)
}

type ReplacerFn = (
  _ast: Node<Program>,
  varName: string
) => { modifiedAst: Node<Program>; pathToReplaced: PathToNode } | Error

export function isNodeSafeToReplacePath(
  ast: Program,
  path: PathToNode
):
  | {
      isSafe: boolean
      value: Expr
      replacer: ReplacerFn
    }
  | Error {
  if (path[path.length - 1][0] === 'callee') {
    path = path.slice(0, -1)
  }
  const acceptedNodeTypes: SyntaxType[] = [
    'BinaryExpression',
    'Identifier',
    'CallExpression',
    'Literal',
    'UnaryExpression',
  ]
  const _node1 = getNodeFromPath(ast, path, acceptedNodeTypes)
  if (err(_node1)) return _node1
  const { node: value, deepPath: outPath } = _node1

  const _node2 = getNodeFromPath(ast, path, 'BinaryExpression')
  if (err(_node2)) return _node2
  const { node: binValue, shallowPath: outBinPath } = _node2

  // binaryExpression should take precedence
  const [finVal, finPath] =
    (binValue as Expr)?.type === 'BinaryExpression'
      ? [binValue, outBinPath]
      : [value, outPath]

  const replaceNodeWithIdentifier: ReplacerFn = (_ast, varName) => {
    const identifier = createIdentifier(varName)
    const last = finPath[finPath.length - 1]
    const pathToReplaced = structuredClone(finPath)
    const index = pathToReplaced[1][0]
    if (typeof index !== 'number') {
      return new Error(
        `Expected number index, but found: ${typeof index} ${index}`
      )
    }
    pathToReplaced[1][0] = index + 1
    const startPath = finPath.slice(0, -1)
    const _nodeToReplace = getNodeFromPath(_ast, startPath)
    if (err(_nodeToReplace)) return _nodeToReplace
    const nodeToReplace = _nodeToReplace.node as any
    nodeToReplace[last[0]] = identifier
    return { modifiedAst: _ast, pathToReplaced }
  }

  const hasPipeSub = isTypeInValue(finVal as Expr, 'PipeSubstitution')
  const isIdentifierCallee = path[path.length - 1][0] !== 'callee'
  return {
    isSafe:
      !hasPipeSub &&
      isIdentifierCallee &&
      acceptedNodeTypes.includes((finVal as any)?.type) &&
      finPath.map(([_, type]) => type).includes('VariableDeclaration'),
    value: finVal as Expr,
    replacer: replaceNodeWithIdentifier,
  }
}

export function isNodeSafeToReplace(
  ast: Node<Program>,
  sourceRange: [number, number]
):
  | {
      isSafe: boolean
      value: Node<Expr>
      replacer: ReplacerFn
    }
  | Error {
  let path = getNodePathFromSourceRange(ast, sourceRange)
  return isNodeSafeToReplacePath(ast, path)
}

export function isTypeInValue(node: Expr, syntaxType: SyntaxType): boolean {
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

export function isValueZero(val?: Expr): boolean {
  return (
    (val?.type === 'Literal' && Number(val.value) === 0) ||
    (val?.type === 'UnaryExpression' &&
      val.operator === '-' &&
      val.argument.type === 'Literal' &&
      Number(val.argument.value) === 0)
  )
}

export function isLinesParallelAndConstrained(
  ast: Program,
  artifactGraph: ArtifactGraph,
  programMemory: ProgramMemory,
  primaryLine: Selection,
  secondaryLine: Selection
):
  | {
      isParallelAndConstrained: boolean
      selection: Selection | null
    }
  | Error {
  try {
    const EPSILON = 0.005
    const primaryPath = getNodePathFromSourceRange(
      ast,
      primaryLine?.codeRef?.range
    )
    const secondaryPath = getNodePathFromSourceRange(
      ast,
      secondaryLine?.codeRef?.range
    )
    const _secondaryNode = getNodeFromPath<CallExpression>(
      ast,
      secondaryPath,
      'CallExpression'
    )
    if (err(_secondaryNode)) return _secondaryNode
    const secondaryNode = _secondaryNode.node
    const _varDec = getNodeFromPath(ast, primaryPath, 'VariableDeclaration')
    if (err(_varDec)) return _varDec
    const varDec = _varDec.node
    const varName = (varDec as VariableDeclaration)?.declarations[0]?.id?.name
    const sg = sketchFromKclValue(programMemory?.get(varName), varName)
    if (err(sg)) return sg
    const _primarySegment = getSketchSegmentFromSourceRange(
      sg,
      primaryLine?.codeRef?.range
    )
    if (err(_primarySegment)) return _primarySegment
    const primarySegment = _primarySegment.segment

    const _segment = getSketchSegmentFromSourceRange(
      sg,
      secondaryLine?.codeRef?.range
    )
    if (err(_segment)) return _segment
    const { segment: secondarySegment, index: secondaryIndex } = _segment
    const primaryAngle = getAngle(primarySegment.from, primarySegment.to)
    const secondaryAngle = getAngle(secondarySegment.from, secondarySegment.to)
    const secondaryAngleAlt = getAngle(
      secondarySegment.to,
      secondarySegment.from
    )
    const isParallel =
      Math.abs(primaryAngle - secondaryAngle) < EPSILON ||
      Math.abs(primaryAngle - secondaryAngleAlt) < EPSILON

    // is secondary line fully constrain, or has constrain type of 'angle'
    const secondaryFirstArg = getFirstArg(secondaryNode)
    if (err(secondaryFirstArg)) return secondaryFirstArg

    const constraintType = getConstraintType(
      secondaryFirstArg.val,
      secondaryNode.callee.name as ToolTip
    )

    const constraintLevelMeta = getConstraintLevelFromSourceRange(
      secondaryLine?.codeRef.range,
      ast
    )
    if (err(constraintLevelMeta)) {
      console.error(constraintLevelMeta)
      return {
        isParallelAndConstrained: false,
        selection: null,
      }
    }
    const constraintLevel = constraintLevelMeta.level

    const isConstrained =
      constraintType === 'angle' || constraintLevel === 'full'

    // get the previous segment
    const prevSegment = sg.paths[secondaryIndex - 1]
    const prevSourceRange = prevSegment.__geoMeta.sourceRange

    const isParallelAndConstrained =
      isParallel && isConstrained && !!prevSourceRange

    return {
      isParallelAndConstrained,
      selection: {
        codeRef: codeRefFromRange(prevSourceRange, ast),
        artifact: artifactGraph.get(prevSegment.__geoMeta.id),
      },
    }
  } catch (e) {
    return {
      isParallelAndConstrained: false,
      selection: null,
    }
  }
}

export function doesPipeHaveCallExp({
  ast,
  selection,
  calleeName,
}: {
  calleeName: string
  ast: Program
  selection: Selection
}): boolean {
  const pipeExpressionMeta = getNodeFromPath<PipeExpression>(
    ast,
    selection?.codeRef?.pathToNode,
    'PipeExpression'
  )
  if (err(pipeExpressionMeta)) {
    console.error(pipeExpressionMeta)
    return false
  }
  const pipeExpression = pipeExpressionMeta.node
  if (pipeExpression.type !== 'PipeExpression') return false
  return pipeExpression.body.some(
    (expression) =>
      expression.type === 'CallExpression' &&
      expression.callee.name === calleeName
  )
}

export function hasExtrudeSketch({
  ast,
  selection,
  programMemory,
}: {
  ast: Program
  selection: Selection
  programMemory: ProgramMemory
}): boolean {
  const varDecMeta = getNodeFromPath<VariableDeclaration>(
    ast,
    selection?.codeRef?.pathToNode,
    'VariableDeclaration'
  )
  if (err(varDecMeta)) {
    console.error(varDecMeta)
    return false
  }
  const varDec = varDecMeta.node
  if (varDec.type !== 'VariableDeclaration') return false
  const varName = varDec.declarations[0].id.name
  const varValue = programMemory?.get(varName)
  return (
    varValue?.type === 'Solid' ||
    !(sketchFromKclValueOptional(varValue, varName) instanceof Reason)
  )
}

export function isSingleCursorInPipe(
  selectionRanges: Selections,
  ast: Program
) {
  if (selectionRanges.graphSelections.length !== 1) return false
  const selection = selectionRanges.graphSelections[0]
  const pathToNode = getNodePathFromSourceRange(ast, selection?.codeRef?.range)
  const nodeTypes = pathToNode.map(([, type]) => type)
  if (nodeTypes.includes('FunctionExpression')) return false
  if (!nodeTypes.includes('VariableDeclaration')) return false
  if (nodeTypes.includes('PipeExpression')) return true
  return false
}

export function findUsesOfTagInPipe(
  ast: Program,
  pathToNode: PathToNode
): SourceRange[] {
  const stdlibFunctionsThatTakeTagInputs = [
    'segAng',
    'segEndX',
    'segEndY',
    'segLen',
  ]
  const nodeMeta = getNodeFromPath<CallExpression>(
    ast,
    pathToNode,
    'CallExpression'
  )
  if (err(nodeMeta)) {
    console.error(nodeMeta)
    return []
  }
  const node = nodeMeta.node
  if (node.type !== 'CallExpression') return []
  const tagIndex = node.callee.name === 'close' ? 1 : 2
  const thirdParam = node.arguments[tagIndex]
  if (
    !(thirdParam?.type === 'TagDeclarator' || thirdParam?.type === 'Identifier')
  )
    return []
  const tag =
    thirdParam?.type === 'TagDeclarator'
      ? String(thirdParam.value)
      : thirdParam.name

  const varDec = getNodeFromPath<Node<VariableDeclaration>>(
    ast,
    pathToNode,
    'VariableDeclaration'
  )
  if (err(varDec)) {
    console.error(varDec)
    return []
  }
  const dependentRanges: SourceRange[] = []

  traverse(varDec.node, {
    enter: (node) => {
      if (
        node.type !== 'CallExpression' ||
        !stdlibFunctionsThatTakeTagInputs.includes(node.callee.name)
      )
        return
      const tagArg = node.arguments[0]
      if (!(tagArg.type === 'TagDeclarator' || tagArg.type === 'Identifier'))
        return
      const tagArgValue =
        tagArg.type === 'TagDeclarator' ? String(tagArg.value) : tagArg.name
      if (tagArgValue === tag) dependentRanges.push([node.start, node.end])
    },
  })
  return dependentRanges
}

export function hasSketchPipeBeenExtruded(selection: Selection, ast: Program) {
  const _node = getNodeFromPath<Node<PipeExpression>>(
    ast,
    selection.codeRef.pathToNode,
    'PipeExpression'
  )
  if (err(_node)) return false
  const { node: pipeExpression } = _node
  if (pipeExpression.type !== 'PipeExpression') return false
  const _varDec = getNodeFromPath<VariableDeclarator>(
    ast,
    selection.codeRef.pathToNode,
    'VariableDeclarator'
  )
  if (err(_varDec)) return false
  const varDec = _varDec.node
  if (varDec.type !== 'VariableDeclarator') return false
  let extruded = false
  // option 1: extrude or revolve is called in the sketch pipe
  traverse(pipeExpression, {
    enter(node) {
      if (
        node.type === 'CallExpression' &&
        (node.callee.name === 'extrude' || node.callee.name === 'revolve')
      ) {
        extruded = true
      }
    },
  })
  // option 2: extrude or revolve is called in the separate pipe
  if (!extruded) {
    traverse(ast as any, {
      enter(node) {
        if (
          node.type === 'CallExpression' &&
          node.callee.type === 'Identifier' &&
          (node.callee.name === 'extrude' ||
            node.callee.name === 'revolve' ||
            node.callee.name === 'loft') &&
          node.arguments?.[1]?.type === 'Identifier' &&
          node.arguments[1].name === varDec.id.name
        ) {
          extruded = true
        }
      },
    })
  }
  return extruded
}

/** File must contain at least one sketch that has not been extruded already */
export function doesSceneHaveSweepableSketch(ast: Node<Program>, count = 1) {
  const theMap: any = {}
  traverse(ast as any, {
    enter(node) {
      if (
        node.type === 'VariableDeclarator' &&
        node.init?.type === 'PipeExpression'
      ) {
        let hasStartProfileAt = false
        let hasStartSketchOn = false
        let hasClose = false
        let hasCircle = false
        for (const pipe of node.init.body) {
          if (
            pipe.type === 'CallExpression' &&
            pipe.callee.name === 'startProfileAt'
          ) {
            hasStartProfileAt = true
          }
          if (
            pipe.type === 'CallExpression' &&
            pipe.callee.name === 'startSketchOn'
          ) {
            hasStartSketchOn = true
          }
          if (pipe.type === 'CallExpression' && pipe.callee.name === 'close') {
            hasClose = true
          }
          if (pipe.type === 'CallExpression' && pipe.callee.name === 'circle') {
            hasCircle = true
          }
        }
        if (
          (hasStartProfileAt || hasCircle) &&
          hasStartSketchOn &&
          (hasClose || hasCircle)
        ) {
          theMap[node.id.name] = true
        }
      } else if (
        node.type === 'CallExpression' &&
        (node.callee.name === 'extrude' || node.callee.name === 'revolve') &&
        node.arguments[1]?.type === 'Identifier' &&
        theMap?.[node?.arguments?.[1]?.name]
      ) {
        delete theMap[node.arguments[1].name]
      }
    },
  })
  return Object.keys(theMap).length >= count
}

export function getObjExprProperty(
  node: ObjectExpression,
  propName: string
): { expr: ObjectProperty['value']; index: number } | null {
  const index = node.properties.findIndex(({ key }) => key.name === propName)
  if (index === -1) return null
  return { expr: node.properties[index].value, index }
}
