import type { Block } from '@rust/kcl-lib/bindings/Block'
import type { ElseIf } from '@rust/kcl-lib/bindings/ElseIf'
import type { FunctionExpression } from '@rust/kcl-lib/bindings/FunctionExpression'
import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { NumericLiteral } from '@rust/kcl-lib/bindings/NumericLiteral'
import type { TypeDeclaration } from '@rust/kcl-lib/bindings/TypeDeclaration'
import {
  createLiteral,
  createLocalName,
  createMemberExpression,
  createPipeSubstitution,
} from '@src/lang/create'
import { splitPathAtLastIndex } from '@src/lang/modifyAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { sourceRangeContains } from '@src/lang/sourceRange'
import {
  codeRefFromRange,
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getFaceCodeRef,
  getPatternArtifactForCopyId,
} from '@src/lang/std/artifactGraph'
import { getArgForEnd, sketchLineHelperMapKw } from '@src/lang/std/sketch'
import { getSketchSegmentFromSourceRange } from '@src/lang/std/sketchConstraints'
import {
  getConstraintLevelFromSourceRange,
  getConstraintType,
} from '@src/lang/std/sketchcombos'
import type { ToolTip } from '@src/lang/toolTips'
import { topLevelRange } from '@src/lang/util'
import type {
  ArrayExpression,
  ArtifactGraph,
  BinaryExpression,
  CallExpressionKw,
  Expr,
  ExpressionStatement,
  Identifier,
  Literal,
  Name,
  PathToNode,
  PipeExpression,
  Program,
  ReturnStatement,
  SegmentArtifact,
  SourceRange,
  SyntaxType,
  UnaryExpression,
  VariableDeclaration,
  VariableDeclarator,
  VariableMap,
} from '@src/lang/wasm'
import { kclSettings, recast, sketchFromKclValue } from '@src/lang/wasm'
import type { KclSettingsAnnotation } from '@src/lib/settings/settingsTypes'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import {
  isParallel as areVectorsParallel,
  deg2Rad,
  subVec,
} from '@src/lib/utils2d'

import type { Artifact, Plane } from '@rust/kcl-lib/bindings/Artifact'
import type { NumericType } from '@rust/kcl-lib/bindings/NumericType'
import type { OpArg, Operation } from '@rust/kcl-lib/bindings/Operation'
import type { SketchBlock } from '@rust/kcl-lib/bindings/SketchBlock'
import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EdgeCutInfo,
  EnginePrimitiveSelection,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'

/**
 * Retrieves a node from a given path within a Program node structure, optionally stopping at a specified node type.
 * This function navigates through the AST (Abstract Syntax Tree) based on the provided path, attempting to locate
 * and return the node at the end of this path.
 * By default it will return the node of the deepest "stopAt" type encountered, or the node at the end of the path if no "stopAt" type is provided.
 * If the "returnEarly" flag is set to true, the function will return as soon as a node of the specified type is found.
 */
// The generic type T is used to assert the return type is T instead of `any` or
// `unknown`. This is unsafe!
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function getNodeFromPath<T>(
  node: Program,
  path: PathToNode,
  wasmInstance: ModuleType,
  stopAt?: SyntaxType | SyntaxType[],
  returnEarly = false,
  suppressNoise = false,
  replacement?: any
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
  let parent = null as any
  let parentEdge = null
  for (const pathItem of path) {
    if (typeof currentNode[pathItem[0]] !== 'object') {
      if (stopAtNode) {
        if (replacement && parent && parentEdge) {
          parent[parentEdge] = replacement
        }
        return {
          node: stopAtNode,
          shallowPath: pathsExplored,
          deepPath: successfulPaths,
        }
      }
      const stackTraceError = new Error()
      const sourceCode = recast(node, wasmInstance)
      const levels = stackTraceError.stack?.split('\n')
      const aFewFunctionNames: string[] = []
      let tree = ''
      levels?.forEach((val, index) => {
        const fnName = val.trim().split(' ')[1]
        const ending = index === levels.length - 1 ? ' ' : ' > '
        tree += fnName + ending
        if (index < 3) {
          aFewFunctionNames.push(fnName)
        }
      })
      const error = new Error(
        `Failed to stopAt ${stopAt}, ${aFewFunctionNames
          .filter((a) => a)
          .join(' > ')}`
      )
      if (!suppressNoise) {
        console.error(tree)
        console.error(sourceCode)
        console.error(error.stack)
      }
      return error
    }
    parent = currentNode
    parentEdge = pathItem[0]
    const nextNode = currentNode?.[pathItem[0]]
    if (!nextNode) {
      // path to node is bad, return nothing, just return the node and path explored so far
      return {
        node: currentNode,
        shallowPath: pathsExplored,
        deepPath: successfulPaths,
      }
    }
    currentNode = nextNode
    successfulPaths.push(pathItem)
    if (!stopAtNode) {
      pathsExplored.push(pathItem)
    }
    if (
      typeof stopAt !== 'undefined' &&
      currentNode &&
      (isArray(stopAt)
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
  if (replacement && parent && parentEdge) {
    parent[parentEdge] = replacement
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
  path: PathToNode,
  wasmInstance: ModuleType
  // The generic type T is used to assert the return type is T instead of `any`
  // or `unknown`. This is unsafe!
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
): <T>(
  stopAt?: SyntaxType | SyntaxType[],
  returnEarly?: boolean
) =>
  | {
      node: T
      path: PathToNode
    }
  | Error {
  // The generic type T is used to assert the return type is T instead of `any`
  // or `unknown`. This is unsafe!
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  return <T>(stopAt?: SyntaxType | SyntaxType[], returnEarly = false) => {
    const _node1 = getNodeFromPath<T>(
      node,
      path,
      wasmInstance,
      stopAt,
      returnEarly
    )
    if (err(_node1)) return _node1
    const { node: _node, shallowPath } = _node1
    return {
      node: _node,
      path: shallowPath,
    }
  }
}

type KCLNode = Node<
  | Expr
  | ExpressionStatement
  | ImportStatement
  | VariableDeclaration
  | VariableDeclarator
  | TypeDeclaration
  | ReturnStatement
  | Identifier
  | Block
  | ElseIf
  | NumericLiteral
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
  } else if (_node.type === 'FunctionExpression') {
    if (_node.name) {
      _traverse(_node.name, [...pathToNode, ['name', 'FunctionExpression']])
    }
    _node.params.forEach((param, index) =>
      _traverse(param.identifier, [
        ...pathToNode,
        ['params', 'FunctionExpression'],
        [index, 'index'],
        ['identifier', 'Parameter'],
      ])
    )
    _node.body.body.forEach((item, index) =>
      _traverse(item, [
        ...pathToNode,
        ['body', 'FunctionExpression'],
        ['body', 'FunctionExpression'],
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
  } else if (_node.type === 'NumericLiteral') {
    // do nothing
  } else if (_node.type === 'ArrayExpression') {
    _node.elements.forEach((el, index) =>
      _traverse(el, [
        ...pathToNode,
        ['elements', 'ArrayExpression'],
        [index, 'index'],
      ])
    )
  } else if (_node.type === 'ArrayRangeExpression') {
    _traverse(_node.startElement, [
      ...pathToNode,
      ['startElement', 'ArrayRangeExpression'],
    ])
    _traverse(_node.endElement, [
      ...pathToNode,
      ['endElement', 'ArrayRangeExpression'],
    ])
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
  } else if (_node.type === 'IfExpression') {
    _traverse(_node.cond, [...pathToNode, ['cond', 'IfExpression']])
    _node.then_val.body.forEach((item, index) =>
      _traverse(item, [
        ...pathToNode,
        ['then_val', 'IfExpression'],
        ['body', 'IfExpression'],
        [index, 'index'],
      ])
    )
    _node.else_ifs.forEach((elseIf, index) =>
      _traverse(elseIf, [
        ...pathToNode,
        ['else_ifs', 'IfExpression'],
        [index, 'index'],
      ])
    )
    _node.final_else.body.forEach((item, index) =>
      _traverse(item, [
        ...pathToNode,
        ['final_else', 'IfExpression'],
        ['body', 'IfExpression'],
        [index, 'index'],
      ])
    )
  } else if (_node.type === 'ElseIf') {
    _traverse(_node.cond, [...pathToNode, ['cond', 'IfExpression']])
    _node.then_val.body.forEach((item, index) =>
      _traverse(item, [
        ...pathToNode,
        ['then_val', 'IfExpression'],
        ['body', 'IfExpression'],
        [index, 'index'],
      ])
    )
  } else if (_node.type === 'LabelledExpression') {
    _traverse(_node.expr, [...pathToNode, ['expr', 'LabelledExpression']])
    _traverse(_node.label, [...pathToNode, ['label', 'LabelledExpression']])
  } else if (_node.type === 'AscribedExpression') {
    _traverse(_node.expr, [...pathToNode, ['expr', 'AscribedExpression']])
  } else if (_node.type === 'SketchBlock') {
    _node.arguments.forEach((arg, index) =>
      _traverse(arg.arg, [
        ...pathToNode,
        ['arguments', 'SketchBlock'],
        [index, ARG_INDEX_FIELD],
        ['arg', LABELED_ARG_FIELD],
      ])
    )
    _node.body.items.forEach((item, index) =>
      _traverse(item, [
        ...pathToNode,
        ['body', 'SketchBlock'],
        ['items', 'Block'],
        [index, 'index'],
      ])
    )
  } else if (_node.type === 'SketchVar') {
    if (_node.initial) {
      _traverse(_node.initial, [...pathToNode, ['initial', 'SketchVar']])
    }
  } else if (_node.type === 'Block') {
    _node.items.forEach((item, index) =>
      _traverse(item, [...pathToNode, ['items', 'Block'], [index, 'index']])
    )
  } else if (_node.type === 'ImportStatement') {
    // Do nothing.
  } else if ('body' in _node && isArray(_node.body)) {
    // TODO: Program should have a type field, but it currently doesn't.
    const program = node as Node<Program>
    program.body.forEach((expression, index) => {
      _traverse(expression, [...pathToNode, ['body', ''], [index, 'index']])
    })
  }
  option?.leave?.(_node)
}

export interface PrevVariable<T> {
  key: string
  value: T
  ty: NumericType | undefined
}

export function findAllPreviousVariablesPath(
  ast: Program,
  memVars: VariableMap,
  path: PathToNode,
  wasmInstance: ModuleType,
  type: 'number' | 'string' = 'number'
): {
  variables: PrevVariable<typeof type extends 'number' ? number : string>[]
  bodyPath: PathToNode
  insertIndex: number
} {
  const _node1 = getNodeFromPath(ast, path, wasmInstance, 'VariableDeclaration')
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

  const _node2 = getNodeFromPath<Program['body']>(ast, bodyPath, wasmInstance)
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
    const varName = item.declaration.id.name
    const varValue = memVars[varName]
    if (!varValue || !('value' in varValue) || typeof varValue.value !== type) {
      return
    }
    variables.push({
      key: varName,
      value: varValue.value,
      ty: varValue.type === 'Number' ? varValue.ty : undefined,
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
  memVars: VariableMap,
  sourceRange: SourceRange,
  wasmInstance: ModuleType,
  type: 'number' | 'string' = 'number'
): {
  variables: PrevVariable<typeof type extends 'number' ? number : string>[]
  bodyPath: PathToNode
  insertIndex: number
} {
  const path = getNodePathFromSourceRange(ast, sourceRange)
  return findAllPreviousVariablesPath(ast, memVars, path, wasmInstance, type)
}

type ReplacerFn = (
  _ast: Node<Program>,
  varName: string
) =>
  | {
      modifiedAst: Node<Program>
      pathToReplaced: PathToNode
      exprInsertIndex: number
    }
  | Error

export function isNodeSafeToReplacePath(
  ast: Program,
  path: PathToNode,
  wasmInstance: ModuleType
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
    'Name',
    'CallExpressionKw',
    'Literal',
    'UnaryExpression',
  ]
  const _node1 = getNodeFromPath<
    BinaryExpression | Name | CallExpressionKw | Literal | UnaryExpression
  >(ast, path, wasmInstance, acceptedNodeTypes)
  if (err(_node1)) return _node1
  const { node: value, deepPath: outPath } = _node1

  const _node2 = getNodeFromPath(ast, path, wasmInstance, 'BinaryExpression')
  if (err(_node2)) return _node2
  const { node: binValue, shallowPath: outBinPath } = _node2

  // binaryExpression should take precedence
  const [finVal, finPath] =
    (binValue as Expr)?.type === 'BinaryExpression'
      ? [binValue, outBinPath]
      : [value, outPath]

  const replaceNodeWithIdentifier: ReplacerFn = (_ast, varName) => {
    const identifier = createLocalName(varName)
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
    const _nodeToReplace = getNodeFromPath(_ast, startPath, wasmInstance)
    if (err(_nodeToReplace)) return _nodeToReplace
    const nodeToReplace = _nodeToReplace.node as any
    nodeToReplace[last[0]] = identifier
    return { modifiedAst: _ast, pathToReplaced, exprInsertIndex: index }
  }

  const hasPipeSub = isTypeInValue(finVal as Expr, 'PipeSubstitution')
  // TODO:
  // In addition to checking explicitly if there's a %,
  // also check if this function requires an unlabeled param, but the call doesn't set one,
  // so it defaults to %.
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
  sourceRange: SourceRange,
  wasmInstance: ModuleType
):
  | {
      isSafe: boolean
      value: Node<Expr>
      replacer: ReplacerFn
    }
  | Error {
  let path = getNodePathFromSourceRange(ast, sourceRange)
  return isNodeSafeToReplacePath(ast, path, wasmInstance)
}

export function isTypeInValue(node: Expr, syntaxType: SyntaxType): boolean {
  if (node.type === syntaxType) return true
  if (node.type === 'BinaryExpression') return isTypeInBinExp(node, syntaxType)
  if (node.type === 'CallExpressionKw') return isTypeInCallExp(node, syntaxType)
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
  node: CallExpressionKw,
  syntaxType: SyntaxType
): boolean {
  if (node.callee.type === syntaxType) return true
  const matchUnlabeled =
    node.unlabeled !== null && isTypeInValue(node.unlabeled, syntaxType)
  if (matchUnlabeled) {
    return true
  }
  const matchLabeled =
    node.arguments &&
    node.arguments.some((arg) => isTypeInValue(arg.arg, syntaxType))
  return matchLabeled
}

function isTypeInArrayExp(
  node: ArrayExpression,
  syntaxType: SyntaxType
): boolean {
  return node.elements.some((el) => isTypeInValue(el, syntaxType))
}

export function isLinesParallelAndConstrained(
  ast: Program,
  artifactGraph: ArtifactGraph,
  memVars: VariableMap,
  primaryLine: Selection,
  secondaryLine: Selection,
  wasmInstance: ModuleType
):
  | {
      isParallelAndConstrained: boolean
      selection: Selection | null
    }
  | Error {
  try {
    const EPSILON = deg2Rad(0.005)
    const primaryPath = getNodePathFromSourceRange(
      ast,
      primaryLine?.codeRef?.range
    )
    const secondaryPath = getNodePathFromSourceRange(
      ast,
      secondaryLine?.codeRef?.range
    )
    const _secondaryNode = getNodeFromPath<CallExpressionKw>(
      ast,
      secondaryPath,
      wasmInstance,
      ['CallExpressionKw']
    )
    if (err(_secondaryNode)) return _secondaryNode
    const secondaryNode = _secondaryNode.node
    const _varDec = getNodeFromPath(
      ast,
      primaryPath,
      wasmInstance,
      'VariableDeclaration'
    )
    if (err(_varDec)) return _varDec
    const varDec = _varDec.node
    const varName = (varDec as VariableDeclaration)?.declaration.id?.name
    const sg = sketchFromKclValue(memVars[varName], varName)
    if (err(sg)) return sg
    const _primarySegment = getSketchSegmentFromSourceRange(
      sg,
      primaryLine?.codeRef?.range
    )
    if (err(_primarySegment)) return _primarySegment
    const primarySegment = _primarySegment.segment

    const _varDec2 = getNodeFromPath(
      ast,
      secondaryPath,
      wasmInstance,
      'VariableDeclaration'
    )
    if (err(_varDec2)) return _varDec2
    const varDec2 = _varDec2.node
    const varName2 = (varDec2 as VariableDeclaration)?.declaration.id?.name
    const sg2 = sketchFromKclValue(memVars[varName2], varName2)
    if (err(sg2)) return sg2

    const _segment = getSketchSegmentFromSourceRange(
      sg2,
      secondaryLine?.codeRef?.range
    )
    if (err(_segment)) return _segment
    const { segment: secondarySegment, index: secondaryIndex } = _segment
    const isParallel = areVectorsParallel(
      subVec(primarySegment.to, primarySegment.from),
      subVec(secondarySegment.to, secondarySegment.from),
      EPSILON
    )

    // is secondary line fully constrain, or has constrain type of 'angle'
    const secondaryFirstArg = getArgForEnd(secondaryNode)
    if (err(secondaryFirstArg)) return secondaryFirstArg

    const isAbsolute = false // ADAM: TODO
    const constraintType = getConstraintType(
      secondaryFirstArg.val,
      secondaryNode.callee.name.name as ToolTip,
      isAbsolute
    )

    const constraintLevelMeta = getConstraintLevelFromSourceRange(
      secondaryLine?.codeRef.range,
      ast,
      wasmInstance
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    return {
      isParallelAndConstrained: false,
      selection: null,
    }
  }
}

export function artifactIsPlaneWithPaths(selectionRanges: Selections) {
  return (
    selectionRanges.graphSelections.length &&
    selectionRanges.graphSelections[0].artifact?.type === 'plane' &&
    selectionRanges.graphSelections[0].artifact.pathIds.length
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
  pathToNode: PathToNode,
  wasmInstance: ModuleType
): SourceRange[] {
  const stdlibFunctionsThatTakeTagInputs = [
    'segAng',
    'segEndX',
    'segEndY',
    'segLen',
  ]
  const nodeMeta = getNodeFromPath<CallExpressionKw>(
    ast,
    pathToNode,
    wasmInstance,
    ['CallExpressionKw']
  )
  if (err(nodeMeta)) {
    console.error(nodeMeta)
    return []
  }
  const node = nodeMeta.node
  if (node.type !== 'CallExpressionKw') return []
  // TODO: Handle all tags declared in a function, e.g.
  // a function may declare extrude(length = 1, tag = $myShape, tagStart = $myShapeBase)
  const args: Expr[] = node.arguments?.map((labeledArg) => labeledArg.arg) ?? []
  const tagParam = args.find((arg) => arg?.type === 'TagDeclarator')
  if (tagParam === undefined) {
    return []
  }
  const tag = String(tagParam.value)

  const varDec = getNodeFromPath<Node<VariableDeclaration>>(
    ast,
    pathToNode,
    wasmInstance,
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
        node.type !== 'CallExpressionKw' ||
        !stdlibFunctionsThatTakeTagInputs.includes(node.callee.name.name)
      )
        return
      // Get all the args
      const args: Expr[] =
        node.arguments?.map((labeledArg) => labeledArg.arg) ?? []
      if (node.unlabeled !== null) {
        args.push(node.unlabeled)
      }
      for (const tagArg of args) {
        if (!('type' in tagArg)) {
          continue
        }
        // TODO: COnsider removing this 'name' and see if anything breaks.
        if (!(tagArg.type === 'TagDeclarator' || tagArg.type === 'Name')) return
        const tagArgValue =
          tagArg.type === 'TagDeclarator'
            ? String(tagArg.value)
            : tagArg.name.name
        if (tagArgValue === tag)
          dependentRanges.push(topLevelRange(node.start, node.end))
      }
    },
  })
  return dependentRanges
}

export function hasSketchPipeBeenExtruded(
  selection: Selection,
  ast: Program,
  wasmInstance: ModuleType
) {
  const _node = getNodeFromPath<Node<PipeExpression>>(
    ast,
    selection.codeRef.pathToNode,
    wasmInstance,
    'PipeExpression'
  )
  if (err(_node)) return false
  const { node: pipeExpression } = _node
  if (pipeExpression.type !== 'PipeExpression') return false
  const _varDec = getNodeFromPath<VariableDeclarator>(
    ast,
    selection.codeRef.pathToNode,
    wasmInstance,
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
        node.type === 'CallExpressionKw' &&
        (node.callee.name.name === 'extrude' ||
          node.callee.name.name === 'revolve')
      ) {
        extruded = true
      }
    },
  })
  // option 2: extrude or revolve is called in the separate pipe
  if (!extruded) {
    traverse(ast as any, {
      enter(node) {
        // if (
        //   node.type === 'CallExpression' &&
        //   node.callee.type === 'Name' &&
        //   (node.callee.name.name === 'extrude' ||
        //     node.callee.name.name === 'revolve' ||
        //     node.callee.name.name === 'loft') &&
        //   node.arguments?.[1]?.type === 'Name' &&
        //   node.arguments[1].name.name === varDec.id.name
        // ) {
        //   extruded = true
        // }
        if (
          node.type === 'CallExpressionKw' &&
          node.callee.type === 'Name' &&
          (node.callee.name.name === 'extrude' ||
            node.callee.name.name === 'revolve' ||
            node.callee.name.name === 'loft') &&
          node.unlabeled?.type === 'Name' &&
          node.unlabeled?.name.name === varDec.id.name
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
  traverse(ast, {
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
            pipe.type === 'CallExpressionKw' &&
            pipe.callee.name.name === 'startProfile'
          ) {
            hasStartProfileAt = true
          }
          if (
            pipe.type === 'CallExpressionKw' &&
            pipe.callee.name.name === 'startSketchOn'
          ) {
            hasStartSketchOn = true
          }
          if (
            pipe.type === 'CallExpressionKw' &&
            pipe.callee.name.name === 'close'
          ) {
            hasClose = true
          }
          if (
            pipe.type === 'CallExpressionKw' &&
            pipe.callee.name.name === 'circle'
          ) {
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
        // } else if (
        //   node.type === 'CallExpression' &&
        //   (node.callee.name.name === 'extrude' ||
        //     node.callee.name.name === 'revolve') &&
        //   node.arguments[1]?.type === 'Name' &&
        //   theMap?.[node?.arguments?.[1]?.name.name]
        // ) {
        //   delete theMap[node.arguments[1].name.name]
      } else if (
        node.type === 'CallExpressionKw' &&
        (node.callee.name.name === 'extrude' ||
          node.callee.name.name === 'revolve') &&
        node.unlabeled?.type === 'Name' &&
        theMap?.[node?.unlabeled?.name.name]
      ) {
        delete theMap[node.unlabeled.name.name]
      }
    },
  })
  return Object.keys(theMap).length >= count
}

export function doesSceneHaveExtrudedSketch(ast: Node<Program>) {
  const theMap: any = {}
  traverse(ast, {
    enter(node) {
      if (
        node.type === 'VariableDeclarator' &&
        node.init?.type === 'PipeExpression'
      ) {
        for (const pipe of node.init.body) {
          if (
            pipe.type === 'CallExpressionKw' &&
            pipe.callee.name.name === 'extrude'
          ) {
            theMap[node.id.name] = true
            break
          }
        }
      } else if (
        node.type === 'CallExpressionKw' &&
        node.callee.name.name === 'extrude' &&
        node.unlabeled?.type === 'Name'
      ) {
        theMap[node.moduleId] = true
      }
    },
  })
  return Object.keys(theMap).length > 0
}

export function isCursorInFunctionDefinition(
  ast: Node<Program>,
  selectionRanges: Selection,
  wasmInstance: ModuleType
): boolean {
  if (ast.body.length === 0) return false
  if (!selectionRanges?.codeRef?.pathToNode) return false
  const node = getNodeFromPath<FunctionExpression>(
    ast,
    selectionRanges.codeRef.pathToNode,
    wasmInstance,
    'FunctionExpression'
  )
  if (err(node)) return false
  if (node.node.type === 'FunctionExpression') return true
  return false
}

export function getBodyIndex(pathToNode: PathToNode): number | Error {
  const index = Number(pathToNode[1][0])
  if (Number.isInteger(index)) return index
  return new Error('Expected number index')
}

export function isCallExprWithName(
  expr: Expr | CallExpressionKw,
  name: string
): expr is CallExpressionKw {
  if (expr.type === 'CallExpressionKw' && expr.callee.type === 'Name') {
    return expr.callee.name.name === name
  }
  return false
}

export function doesSketchPipeNeedSplitting(
  ast: Node<Program>,
  pathToPipe: PathToNode,
  wasmInstance: ModuleType
): boolean | Error {
  const varDec = getNodeFromPath<VariableDeclarator>(
    ast,
    pathToPipe,
    wasmInstance,
    'VariableDeclarator'
  )
  if (err(varDec)) return varDec
  if (varDec.node.type !== 'VariableDeclarator') return new Error('Not a var')
  const pipeExpression = varDec.node.init
  if (pipeExpression.type !== 'PipeExpression') return false
  const [firstPipe, secondPipe] = pipeExpression.body
  if (!firstPipe || !secondPipe) return false
  if (
    isCallExprWithName(firstPipe, 'startSketchOn') &&
    isCallExprWithName(secondPipe, 'startProfile')
  )
    return true
  return false
}
/**
 * Given KCL, returns the settings annotation object if it exists.
 */
export function getSettingsAnnotation(
  kcl: string | Node<Program>,
  instance: ModuleType
): KclSettingsAnnotation | Error {
  const metaSettings = kclSettings(kcl, instance)
  if (err(metaSettings)) return metaSettings

  const settings: KclSettingsAnnotation = {}
  // No settings in the KCL.
  if (!metaSettings) return settings

  settings.defaultLengthUnit = metaSettings.defaultLengthUnits
  settings.defaultAngleUnit = metaSettings.defaultAngleUnits
  settings.experimentalFeatures = metaSettings.experimentalFeatures

  return settings
}

function pathToNodeKeys(pathToNode: PathToNode): (string | number)[] {
  return pathToNode.map(([key]) => key)
}

export function stringifyPathToNode(pathToNode: PathToNode): string {
  return JSON.stringify(pathToNodeKeys(pathToNode))
}

/**
 * Updates PathToNodes to account for changes in body indices when variables are added/removed above
 * This is specifically for handling the common case where a user adds/removes variables above a node,
 * which changes the body index in the PathToNode
 * @param oldAst The AST before user edits
 * @param newAst The AST after user edits
 * @param pathToUpdate Array of PathToNodes that need to be updated
 * @returns updated PathToNode, or Error if any path couldn't be updated
 */
export function updatePathToNodesAfterEdit(
  oldAst: Node<Program>,
  newAst: Node<Program>,
  pathToUpdate: PathToNode,
  wasmInstance: ModuleType
): PathToNode | Error {
  // First, let's find all topLevel the variable declarations in both ASTs
  // and map their name to their body index
  const oldVarDecls = new Map<string, number>()
  const newVarDecls = new Map<string, number>()

  const maxBodyLength = Math.max(oldAst.body.length, newAst.body.length)
  for (let bodyIndex = 0; bodyIndex < maxBodyLength; bodyIndex++) {
    const oldNode = oldAst.body[bodyIndex]
    const newNode = newAst.body[bodyIndex]
    if (oldNode?.type === 'VariableDeclaration') {
      oldVarDecls.set(oldNode.declaration.id.name, bodyIndex)
    }
    if (newNode?.type === 'VariableDeclaration') {
      newVarDecls.set(newNode.declaration.id.name, bodyIndex)
    }
  }

  // For the path, get the variable name this path points to
  const oldNodeResult = getNodeFromPath<VariableDeclaration>(
    oldAst,
    pathToUpdate,
    wasmInstance,
    'VariableDeclaration'
  )
  if (err(oldNodeResult)) return oldNodeResult
  const oldNode = oldNodeResult.node
  const varName = oldNode.declaration.id.name

  // Find the old and new indices for this variable
  const oldIndex = oldVarDecls.get(varName)
  const newIndex = newVarDecls.get(varName)

  if (oldIndex === undefined || newIndex === undefined) {
    return new Error(`Could not find variable ${varName} in one of the ASTs`)
  }

  // Create a new path with the updated body index
  const newPath = structuredClone(pathToUpdate)
  newPath[1][0] = newIndex // Update the body index
  return newPath
}

export const valueOrVariable = (variable: KclCommandValue) => {
  return 'variableName' in variable
    ? variable.variableIdentifierAst
    : variable.valueAst
}

export function getVariableNameFromNodePath(
  pathToNode: PathToNode,
  program: Program,
  wasmInstance: ModuleType
): string | undefined {
  if (pathToNode.length === 0) {
    return undefined
  }

  const call = getNodeFromPath<CallExpressionKw | SketchBlock>(
    program,
    pathToNode,
    wasmInstance,
    ['CallExpressionKw', 'SketchBlock']
  )
  if (
    err(call) ||
    !(call.node.type === 'CallExpressionKw' || call.node.type === 'SketchBlock')
  ) {
    return undefined
  }
  // Find the var name from the variable declaration.
  const varDec = getNodeFromPath<VariableDeclaration>(
    program,
    pathToNode,
    wasmInstance,
    'VariableDeclaration'
  )
  if (err(varDec)) {
    return undefined
  }
  if (varDec.node.type !== 'VariableDeclaration') {
    // There's no variable declaration for this call.
    return undefined
  }
  const varName = varDec.node.declaration.id.name
  // If the operation is a simple assignment, we can use the variable name.
  if (varDec.node.declaration.init === call.node) {
    return varName
  }
  // If the AST node is in a pipe expression, we can only use the variable
  // name if it's the last operation in the pipe.
  const pipe = getNodeFromPath<PipeExpression>(
    program,
    pathToNode,
    wasmInstance,
    'PipeExpression'
  )
  if (err(pipe)) {
    return undefined
  }
  if (
    pipe.node.type === 'PipeExpression' &&
    pipe.node.body[pipe.node.body.length - 1] === call.node
  ) {
    return varName
  }
  return undefined
}

type GetVariableExprsOptions = {
  lastChildLookup?: boolean
  artifactTypeFilter?: Array<Artifact['type']>
}

// Go from a selection to a list of KCL expressions that
// can be used to create function calls in codemods.
// lastChildLookup will look for the last child of the selection in the artifact graph
export function getVariableExprsFromSelection(
  selection: Selections,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode,
  options: GetVariableExprsOptions = {}
): Error | { exprs: Expr[]; pathIfPipe?: PathToNode } {
  const { lastChildLookup = false, artifactTypeFilter } = options
  let pathIfPipe: PathToNode | undefined
  let exprs: Expr[] = []
  const pushedNames = {} as Record<string, boolean>
  for (const s of selection.graphSelections) {
    const patternCopyExpr = getPatternCopyExprFromSelection(
      s,
      ast,
      wasmInstance
    )
    if (patternCopyExpr) {
      const key = outputExprKey(patternCopyExpr)
      if (pushedNames[key]) {
        continue
      }
      exprs.push(patternCopyExpr)
      pushedNames[key] = true
      continue
    }

    const compositeSolidOutputExpr = getCompositeSolidOutputExprFromSelection(
      s,
      ast,
      wasmInstance,
      artifactTypeFilter
    )
    if (compositeSolidOutputExpr) {
      const key = outputExprKey(compositeSolidOutputExpr)
      if (pushedNames[key]) {
        continue
      }
      exprs.push(compositeSolidOutputExpr)
      pushedNames[key] = true
      continue
    }

    const sweepOutputExpr = getSweepOutputExprFromSelection(
      s,
      artifactGraph,
      ast,
      wasmInstance,
      nodeToEdit
    )
    if (sweepOutputExpr) {
      const key = outputExprKey(sweepOutputExpr)
      if (pushedNames[key]) {
        continue
      }
      exprs.push(sweepOutputExpr)
      pushedNames[key] = true
      continue
    }

    if (s.artifact?.type === 'edgeCut') {
      const edgeCutVariable = getNodeFromPath<VariableDeclaration>(
        ast,
        s.codeRef.pathToNode,
        wasmInstance,
        'VariableDeclaration',
        false,
        true
      )
      if (
        !err(edgeCutVariable) &&
        edgeCutVariable.node.type === 'VariableDeclaration'
      ) {
        const name = edgeCutVariable.node.declaration.id.name
        if (pushedNames[name]) {
          continue
        }
        exprs.push(createLocalName(name))
        pushedNames[name] = true
        continue
      }

      const edgeCutCall = getNodeFromPath<CallExpressionKw>(
        ast,
        s.codeRef.pathToNode,
        wasmInstance,
        'CallExpressionKw',
        false,
        true
      )
      if (!err(edgeCutCall) && edgeCutCall.node.unlabeled) {
        const input = structuredClone(edgeCutCall.node.unlabeled)
        const key = outputExprKey(input)
        if (pushedNames[key]) {
          continue
        }
        exprs.push(input)
        pushedNames[key] = true
        continue
      }
    }

    if (s.artifact?.type === 'segment') {
      const sketchSegmentId = s.artifact.originalSegId ?? s.artifact.id
      const sketchName = getSketchVariableNameForSegment(
        ast,
        sketchSegmentId,
        artifactGraph,
        wasmInstance
      )
      const lineName =
        sketchName &&
        getSketchSegmentName(ast, sketchSegmentId, artifactGraph, wasmInstance)

      if (sketchName && lineName) {
        const memberName = `${sketchName}.${lineName}`
        if (pushedNames[memberName]) {
          continue
        }

        exprs.push(createMemberExpression(sketchName, lineName))
        pushedNames[memberName] = true
        continue
      }
    }

    let variable:
      | {
          node: VariableDeclaration
          shallowPath: PathToNode
          deepPath: PathToNode
        }
      | undefined

    if (lastChildLookup && s.artifact) {
      const children = findAllChildrenAndOrderByPlaceInCode(
        s.artifact,
        artifactGraph
      )

      if (
        artifactTypeFilter?.includes(s.artifact.type) &&
        'consumed' in s.artifact &&
        !s.artifact.consumed &&
        !hasLaterMatchingArtifact(children, s.artifact, artifactTypeFilter)
      ) {
        // Use a selected, unconsumed body directly only when the ordered
        // traversal does not reveal a later matching body derived from it.
        // This keeps selected blends as blend variables, while face commands
        // like shell can still resolve a parent sweep to a downstream sweep.
        const directLookup = getNodeFromPath<VariableDeclaration>(
          ast,
          s.codeRef.pathToNode,
          wasmInstance,
          'VariableDeclaration'
        )
        if (!err(directLookup)) {
          variable = directLookup
        }
      }

      if (!variable) {
        const lastChildVariable = getLastVariable(
          children,
          ast,
          wasmInstance,
          artifactTypeFilter,
          nodeToEdit
        )
        if (!lastChildVariable) {
          continue
        }
        variable = lastChildVariable.variableDeclaration
      }
    } else {
      const directLookup = getNodeFromPath<VariableDeclaration>(
        ast,
        s.codeRef.pathToNode,
        wasmInstance,
        'VariableDeclaration'
      )
      if (err(directLookup)) {
        continue
      }

      variable = directLookup
    }

    if (variable.node.type === 'VariableDeclaration') {
      const name = variable.node.declaration.id.name
      if (nodeToEdit) {
        const result = getNodeFromPath<VariableDeclaration>(
          ast,
          nodeToEdit,
          wasmInstance,
          'VariableDeclaration'
        )
        if (
          !err(result) &&
          result.node.type === 'VariableDeclaration' &&
          name === result.node.declaration.id.name
        ) {
          // Pointing to same variable case
          exprs.push(createPipeSubstitution())
          pathIfPipe = nodeToEdit
          continue
        }
      }

      // Pointing to different variable case
      if (pushedNames[name]) {
        continue
      }
      exprs.push(createLocalName(name))
      pushedNames[name] = true
      continue
    } else if (variable.node.type === 'CallExpressionKw') {
      // no variable assignment in that call and not a pipe yet, we'll need to create it
      exprs.push(createPipeSubstitution())
      pathIfPipe = variable.deepPath
      continue
    }

    // import case
    const importNodeAndAlias = findImportNodeAndAlias(
      ast,
      s.codeRef.pathToNode,
      wasmInstance
    )
    if (importNodeAndAlias) {
      exprs.push(createLocalName(importNodeAndAlias.alias))
      continue
    }

    // No variable case
    if (s.codeRef.pathToNode.length > 0) {
      exprs.push(createPipeSubstitution())
      pathIfPipe = s.codeRef.pathToNode
      continue
    }

    console.warn('No match for selection, likely a bug (or bad selection)', s)
  }

  return { exprs, pathIfPipe }
}

function getPatternCopyExprFromSelection(
  selection: Selection,
  ast: Node<Program>,
  wasmInstance: ModuleType
): Expr | null {
  const artifact = selection.artifact
  if (artifact?.type !== 'pattern') {
    return null
  }

  const patternIndex =
    selection.patternIndex ??
    (selection.engineEntityId
      ? artifact.copyIds.indexOf(selection.engineEntityId) + 1
      : -1)
  if (patternIndex < 0) {
    return null
  }

  const pathCandidates = [
    getNodePathFromSourceRange(ast, artifact.codeRef.range),
    artifact.codeRef.pathToNode,
    selection.codeRef.pathToNode,
  ]

  for (const pathToNode of pathCandidates) {
    const patternVariableName = getVariableNameFromNodePath(
      pathToNode,
      ast,
      wasmInstance
    )
    if (patternVariableName) {
      return createMemberExpression(
        patternVariableName,
        createLiteral(patternIndex, wasmInstance),
        true
      )
    }
  }

  return null
}

function getSweepOutputExprFromSelection(
  selection: Selection,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode
): Expr | null {
  const selectionArtifact = selection.artifact
  let artifact: (Artifact & { type: 'sweep' }) | undefined
  if (selectionArtifact?.type === 'sweep') {
    artifact = selectionArtifact
  } else if (selectionArtifact?.type === 'path' && selectionArtifact.sweepId) {
    const maybeSweep = artifactGraph.get(selectionArtifact.sweepId)
    if (maybeSweep?.type === 'sweep') {
      artifact = maybeSweep
    }
  }

  if (!artifact) {
    return null
  }

  if (
    nodeToEdit &&
    [
      getNodePathFromSourceRange(ast, artifact.codeRef.range),
      artifact.codeRef.pathToNode,
    ].some(
      (pathToNode) =>
        stringifyPathToNode(pathToNode) === stringifyPathToNode(nodeToEdit)
    )
  ) {
    return null
  }

  const siblingSweeps = [...artifactGraph.values()].filter(
    (candidate): candidate is Artifact & { type: 'sweep' } =>
      candidate.type === 'sweep' &&
      sourceRangeContains(candidate.codeRef.range, artifact.codeRef.range) &&
      sourceRangeContains(artifact.codeRef.range, candidate.codeRef.range)
  )
  if (siblingSweeps.length <= 1) {
    return null
  }

  const outputIndex = siblingSweeps.findIndex(
    (sibling) => sibling.id === artifact.id
  )
  if (outputIndex < 0) {
    return null
  }

  const pathCandidates = [
    getNodePathFromSourceRange(ast, artifact.codeRef.range),
    artifact.codeRef.pathToNode,
    selection.codeRef.pathToNode,
  ]

  for (const pathToNode of pathCandidates) {
    const sweepVariableName = getVariableNameFromNodePath(
      pathToNode,
      ast,
      wasmInstance
    )
    if (sweepVariableName) {
      return createMemberExpression(
        sweepVariableName,
        createLiteral(outputIndex, wasmInstance),
        true
      )
    }
  }

  return null
}

function getCompositeSolidOutputExprFromSelection(
  selection: Selection,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  artifactTypeFilter?: Array<Artifact['type']>
): Expr | null {
  if (artifactTypeFilter && !artifactTypeFilter.includes('compositeSolid')) {
    return null
  }
  const artifact = selection.artifact
  if (
    artifact?.type !== 'compositeSolid' ||
    artifact.outputIndex === null ||
    artifact.outputIndex === undefined
  ) {
    return null
  }

  const directLookup = getNodeFromPath<VariableDeclaration>(
    ast,
    selection.codeRef.pathToNode,
    wasmInstance,
    'VariableDeclaration'
  )
  if (err(directLookup) || directLookup.node.type !== 'VariableDeclaration') {
    return null
  }

  return createMemberExpression(
    directLookup.node.declaration.id.name,
    createLiteral(artifact.outputIndex, wasmInstance),
    true
  )
}

function outputExprKey(expr: Expr): string {
  if (
    expr.type === 'MemberExpression' &&
    expr.object.type === 'Name' &&
    expr.property.type === 'Literal' &&
    typeof expr.property.value === 'object' &&
    'value' in expr.property.value
  ) {
    return `${expr.object.name.name}[${expr.property.value.value}]`
  }

  return JSON.stringify(expr)
}

function hasLaterMatchingArtifact(
  children: Artifact[],
  artifact: Artifact,
  filter: Array<Artifact['type']>
): boolean {
  let foundLaterMatchingArtifact = false

  for (const child of children) {
    if (child.id === artifact.id) {
      return foundLaterMatchingArtifact
    }

    if (filter.includes(child.type)) {
      foundLaterMatchingArtifact = true
    }
  }

  return false
}

function getSketchVariableNameForSegment(
  ast: Node<Program>,
  segmentId: string,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): string | null {
  const segment = getArtifactOfTypes(
    { key: segmentId, types: ['segment'] },
    artifactGraph
  )
  if (err(segment)) {
    return null
  }

  const sketchPath = getArtifactOfTypes(
    { key: segment.pathId, types: ['path'] },
    artifactGraph
  )
  if (err(sketchPath)) {
    return null
  }

  const sketchVarDec = getNodeFromPath<VariableDeclaration>(
    ast,
    sketchPath.codeRef.pathToNode,
    wasmInstance,
    'VariableDeclaration'
  )
  if (
    err(sketchVarDec) ||
    sketchVarDec.node.type !== 'VariableDeclaration' ||
    sketchVarDec.node.declaration.init.type !== 'SketchBlock'
  ) {
    return null
  }

  return sketchVarDec.node.declaration.id.name
}

// Go from the sketches argument in a KCL call declaration
// to a list of graph selections, useful for edit flows.
// Somewhat of an inverse of getVariableExprsFromSelection.
export function retrieveSelectionsFromOpArg(
  opArg: OpArg,
  artifactGraph: ArtifactGraph
): Error | Selections {
  const error = new Error("Couldn't retrieve sketches from operation")
  let artifactIds: string[] = []
  if (
    opArg.value.type === 'Solid' ||
    opArg.value.type === 'Sketch' ||
    opArg.value.type === 'Helix'
  ) {
    artifactIds = [opArg.value.value.artifactId]
  } else if (opArg.value.type === 'Segment') {
    artifactIds = [opArg.value.artifact_id]
  } else if (opArg.value.type === 'Uuid') {
    artifactIds = [opArg.value.value]
  } else if (opArg.value.type === 'ImportedGeometry') {
    artifactIds = [opArg.value.artifact_id]
  } else if (opArg.value.type === 'Array') {
    artifactIds = opArg.value.value.flatMap((v) => {
      if (v.type === 'Solid' || v.type === 'Sketch' || v.type === 'Helix') {
        return [v.value.artifactId]
      }
      if (v.type === 'Segment') {
        return [v.artifact_id]
      }
      if (v.type === 'Uuid') {
        return [v.value]
      }
      if (v.type === 'TagIdentifier' && v.artifact_id) {
        return [v.artifact_id]
      }
      return []
    })
  } else if (opArg.value.type === 'TagIdentifier' && opArg.value.artifact_id) {
    artifactIds = [opArg.value.artifact_id]
  } else {
    return error
  }

  const graphSelections: Selection[] = []
  for (const artifactId of artifactIds) {
    let artifact =
      artifactGraph.get(artifactId) ??
      getPatternArtifactForCopyId(artifactId, artifactGraph)
    if (!artifact) {
      continue
    }

    if (artifact.type === 'segment') {
      const correspondingWall = artifactGraph
        .values()
        .find((a) => a.type === 'wall' && a.segId === artifact?.id)
      if (correspondingWall) {
        artifact = correspondingWall
      }
    }

    const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
    if (!codeRefs || codeRefs.length === 0) {
      continue
    }

    const isArtifactFromImportedModule = codeRefs.some(
      (c) => c.pathToNode.length === 0
    )
    if (isArtifactFromImportedModule) {
      // TODO: retrieve module import alias instead of throwing here
      // https://github.com/KittyCAD/modeling-app/issues/8463
      return new Error(
        "The selected artifact is from an imported module, editing isn't supported yet. Please delete the operation and recreate."
      )
    }

    graphSelections.push({
      artifact,
      codeRef: codeRefs[0],
    })
  }

  if (graphSelections.length === 0) {
    return error
  }

  return { graphSelections, otherSelections: [] }
}

export function findOperationArtifact(
  operation: StdLibCallOp,
  artifactGraph: ArtifactGraph
) {
  const nodePath = JSON.stringify(operation.nodePath)
  const artifact = artifactGraph
    .values()
    .toArray()
    .find(
      (a) =>
        'codeRef' in a &&
        JSON.stringify(a.codeRef?.nodePath) === nodePath &&
        a.codeRef.range.every((v, i) => v === operation.sourceRange[i])
    )
  return artifact
}

export function findOperationForArtifact(input: {
  artifact: Artifact | undefined
  operations: Operation[]
}): Operation | undefined {
  if (!input.artifact || !('codeRef' in input.artifact)) {
    return undefined
  }
  const { artifact } = input

  return input.operations.find((operation) => {
    if (!('sourceRange' in operation)) {
      return false
    }
    return (
      sourceRangeContains(operation.sourceRange, artifact.codeRef.range) ||
      (operation.type === 'StdLibCall' &&
        operation.stdlibEntrySourceRange !== undefined &&
        operation.stdlibEntrySourceRange !== null &&
        sourceRangeContains(
          operation.stdlibEntrySourceRange,
          artifact.codeRef.range
        ))
    )
  })
}

export function findOperationPlaneArtifact(
  operation: StdLibCallOp,
  artifactGraph: ArtifactGraph
) {
  const nodePath = JSON.stringify(operation.nodePath)
  const artifact = [...artifactGraph.values()].find(
    (a) => JSON.stringify((a as Plane).codeRef?.nodePath) === nodePath
  )
  return artifact
}

// Returns Plane / Wall / Cap which contains pathIds
export function findOperationPlaneLikeArtifact(
  operation: StdLibCallOp,
  artifactGraph: ArtifactGraph
) {
  const artifact = findOperationPlaneArtifact(operation, artifactGraph)
  if (artifact?.type === 'startSketchOnFace') {
    const planeLikeArtifact = artifactGraph.get(artifact.faceId)
    if (
      planeLikeArtifact?.type === 'plane' ||
      planeLikeArtifact?.type === 'wall' ||
      planeLikeArtifact?.type === 'cap'
    ) {
      return planeLikeArtifact
    }
  }
  return artifact
}

export function isOffsetPlane(item: Operation): item is StdLibCallOp {
  return item.type === 'StdLibCall' && item.name === 'offsetPlane'
}

export type StdLibCallOp = Extract<Operation, { type: 'StdLibCall' }>

// Returns the id of the currently selected plane, either a default plane or an offset plane, or null if no planes are selected.
export function getSelectedPlaneId(selectionRanges: Selections): string | null {
  const defaultPlane = selectionRanges.otherSelections.find(
    (selection) => typeof selection === 'object' && 'name' in selection
  )
  if (defaultPlane) {
    // Found a default plane in the selection
    return defaultPlane.id
  }

  const planeSelection = selectionRanges.graphSelections.find(
    (selection) => selection.artifact?.type === 'plane'
  )
  if (planeSelection) {
    // Found an offset plane in the selection
    return planeSelection.artifact?.id || null
  }

  return null
}

// Returns the plane/wall/cap/edgeCut within the current selection that can be used to start a sketch on.
export function getSelectedSketchTarget(
  selectionRanges: Selections
): string | null {
  const defaultPlane = selectionRanges.otherSelections.find(
    (selection) => typeof selection === 'object' && 'name' in selection
  )
  if (defaultPlane) {
    return defaultPlane.id
  }

  const primitiveFace = getSelectedEnginePrimitiveFace(selectionRanges)
  if (primitiveFace) {
    return primitiveFace.entityId
  }

  // Try to find an offset plane or wall or cap or chamfer edgeCut
  const planeSelection = selectionRanges.graphSelections.find((selection) => {
    const artifactType = selection.artifact?.type || ''
    return (
      ['plane', 'wall', 'cap'].includes(artifactType) ||
      (selection.artifact?.type === 'edgeCut' &&
        selection.artifact?.subType === 'chamfer')
    )
  })
  if (planeSelection) {
    return planeSelection.artifact?.id || null
  }

  return null
}

export function getSelectedEnginePrimitiveFace(selectionRanges: Selections) {
  return selectionRanges.otherSelections.find(
    (selection): selection is EnginePrimitiveSelection =>
      typeof selection !== 'string' &&
      'type' in selection &&
      selection.type === 'enginePrimitive' &&
      selection.primitiveType === 'face'
  )
}

export function getSelectedPlaneAsNode(
  selection: Selections,
  variables: VariableMap,
  wasmInstance: ModuleType
): Node<Name> | Node<Literal> | undefined {
  const defaultPlane = selection.otherSelections.find(
    (selection) => typeof selection === 'object' && 'name' in selection
  )
  if (
    defaultPlane &&
    defaultPlane instanceof Object &&
    'name' in defaultPlane
  ) {
    return createLiteral(defaultPlane.name.toUpperCase(), wasmInstance)
  }

  const offsetPlane = selection.graphSelections.find(
    (sel) => sel.artifact?.type === 'plane'
  )
  if (offsetPlane?.artifact?.type === 'plane') {
    const artifactId = offsetPlane.artifact.id
    const variableName = Object.entries(variables).find(([_, value]) => {
      return value?.type === 'Plane' && value.value?.artifactId === artifactId
    })
    const offsetPlaneName = variableName?.[0]
    return offsetPlaneName ? createLocalName(offsetPlaneName) : undefined
  }

  return undefined
}

export function locateVariableWithCallOrPipe(
  ast: Program,
  pathToNode: PathToNode,
  wasmInstance: ModuleType
): { variableDeclarator: VariableDeclarator; shallowPath: PathToNode } | Error {
  const variableDeclarationNode = getNodeFromPath<VariableDeclaration>(
    ast,
    pathToNode,
    wasmInstance,
    'VariableDeclaration'
  )
  if (err(variableDeclarationNode)) return variableDeclarationNode

  const { node: variableDecl } = variableDeclarationNode
  const variableDeclarator = variableDecl.declaration
  if (!variableDeclarator) {
    return new Error('Variable Declarator not found.')
  }

  const initializer = variableDeclarator?.init
  if (!initializer) {
    return new Error('Initializer not found.')
  }

  if (
    initializer.type !== 'CallExpressionKw' &&
    initializer.type !== 'PipeExpression'
  ) {
    return new Error('Initializer must be a PipeExpression or CallExpressionKw')
  }

  return {
    variableDeclarator,
    shallowPath: variableDeclarationNode.shallowPath,
  }
}

export function findImportNodeAndAlias(
  ast: Node<Program>,
  pathToNode: PathToNode,
  wasmInstance: ModuleType
) {
  const importNode = getNodeFromPath<ImportStatement>(
    ast,
    pathToNode,
    wasmInstance,
    ['ImportStatement']
  )
  if (
    !err(importNode) &&
    importNode.node.type === 'ImportStatement' &&
    importNode.node.selector.type === 'None' &&
    importNode.node.selector.alias &&
    importNode.node.selector.alias?.type === 'Identifier'
  ) {
    return {
      node: importNode.node,
      alias: importNode.node.selector.alias.name,
    }
  }

  return undefined
}

/* Starting from the path to the import node, look for all pipe expressions
 * that use the import alias. If found, return the pipe expression and the
 * path to the pipe node, and the alias. Wrote for the assemblies codemods.
 * TODO: add unit tests, relying on e2e/playwright/point-click-assemblies.spec.ts for now
 */
export function findPipesWithImportAlias(
  ast: Node<Program>,
  pathToNode: PathToNode,
  wasmInstance: ModuleType,
  callInPipe?: string
) {
  let pipes: { expression: PipeExpression; pathToNode: PathToNode }[] = []
  const importNodeAndAlias = findImportNodeAndAlias(
    ast,
    pathToNode,
    wasmInstance
  )
  const callInPipeFilter = callInPipe
    ? (v: Expr) =>
        v.type === 'CallExpressionKw' && v.callee.name.name === callInPipe
    : undefined
  if (importNodeAndAlias) {
    for (const [i, n] of ast.body.entries()) {
      if (
        n.type === 'ExpressionStatement' &&
        n.expression.type === 'PipeExpression' &&
        n.expression.body[0].type === 'Name' &&
        n.expression.body[0].name.name === importNodeAndAlias.alias
      ) {
        const expression = n.expression
        const pathToNode: PathToNode = [
          ['body', ''],
          [i, 'index'],
          ['expression', 'PipeExpression'],
        ]
        if (callInPipeFilter && !expression.body.some(callInPipeFilter)) {
          continue
        }

        pipes.push({ expression, pathToNode })
      }

      if (
        n.type === 'VariableDeclaration' &&
        n.declaration.type === 'VariableDeclarator' &&
        n.declaration.init.type === 'PipeExpression' &&
        n.declaration.init.body[0].type === 'Name' &&
        n.declaration.init.body[0].name.name === importNodeAndAlias.alias
      ) {
        const expression = n.declaration.init
        const pathToNode: PathToNode = [
          ['body', ''],
          [i, 'index'],
          ['declaration', 'VariableDeclaration'],
          ['init', 'VariableDeclarator'],
          ['body', 'PipeExpression'],
        ]
        if (callInPipeFilter && !expression.body.some(callInPipeFilter)) {
          continue
        }

        pipes.push({ expression, pathToNode })
      }
    }
  }

  return pipes
}

export const getPathNormalisedForTruncatedAst = (
  entryNodePath: PathToNode,
  sketchNodePaths: PathToNode[]
): PathToNode => {
  const nodePathWithCorrectedIndexForTruncatedAst =
    structuredClone(entryNodePath)
  const minIndex = Math.min(
    ...sketchNodePaths.map((path) => Number(path[1][0]))
  )
  nodePathWithCorrectedIndexForTruncatedAst[1][0] =
    Number(nodePathWithCorrectedIndexForTruncatedAst[1][0]) - minIndex
  return nodePathWithCorrectedIndexForTruncatedAst
}

/** returns all children of a given artifact, and sorts them DESC by start sourceRange
 * The usecase is we want the last declare relevant  child to use in the boolean operations
 * but might be useful else where.
 */
export function findAllChildrenAndOrderByPlaceInCode(
  artifact: Artifact,
  artifactGraph: ArtifactGraph
): Artifact[] {
  const result = new Set<string>()
  const stack: string[] = [artifact.id]
  const codeRefStartByArtifactId = new Map<string, number>()

  const getArtifacts = (stringIds: string[]): Artifact[] => {
    const artifactsWithCodeRefs: Artifact[] = []
    for (const id of stringIds) {
      const artifact = artifactGraph.get(id)
      if (artifact) {
        const codeRefs = getCodeRefsByArtifactId(id, artifactGraph)
        if (codeRefs && codeRefs[0] && codeRefs[0].range[1] > 0) {
          artifactsWithCodeRefs.push(artifact)
          codeRefStartByArtifactId.set(id, codeRefs[0].range[0])
        }
      }
    }
    return artifactsWithCodeRefs
  }

  const pushToSomething = (
    resultId: string,
    childrenIdOrIds: string | string[] | null | undefined
  ) => {
    if (isArray(childrenIdOrIds)) {
      if (childrenIdOrIds.length) {
        stack.push(...childrenIdOrIds)
      }
    } else {
      if (childrenIdOrIds) {
        stack.push(childrenIdOrIds)
      }
    }
  }

  while (stack.length > 0) {
    const currentId = stack.pop()!
    if (result.has(currentId)) continue
    const current = artifactGraph.get(currentId)
    if (current?.type === 'path') {
      pushToSomething(currentId, current.sweepId)
      pushToSomething(currentId, current.segIds)
      pushToSomething(currentId, current.compositeSolidId)
      pushToSomething(currentId, current.patternIds)
    } else if (current?.type === 'sweep') {
      pushToSomething(currentId, current.surfaceIds)
      pushToSomething(currentId, current.pathId)
      pushToSomething(currentId, current.patternIds)
    } else if (current?.type === 'wall' || current?.type === 'cap') {
      pushToSomething(currentId, current?.pathIds)
    } else if (current?.type === 'segment') {
      pushToSomething(currentId, current.edgeCutId)
      pushToSomething(currentId, current.surfaceId)
    } else if (current?.type === 'edgeCut') {
      pushToSomething(currentId, current.surfaceId)
    } else if (current?.type === 'startSketchOnPlane') {
      pushToSomething(currentId, current.planeId)
    } else if (current?.type === 'plane') {
      pushToSomething(currentId, current.pathIds)
    } else if (current?.type === 'compositeSolid') {
      pushToSomething(currentId, current.compositeSolidId)
      pushToSomething(currentId, current.patternIds)
    } else if (current?.type === 'pattern') {
      pushToSomething(currentId, current.copyIds)
      pushToSomething(currentId, current.copyFaceIds)
      pushToSomething(currentId, current.copyEdgeIds)
    }
    result.add(currentId)
  }

  const codeRefArtifacts = getArtifacts(Array.from(result))
  let orderedByCodeRefDest = codeRefArtifacts.sort((a, b) => {
    const aStart = codeRefStartByArtifactId.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const bStart = codeRefStartByArtifactId.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return aStart - bStart
  })

  // Cut off traversal results at the first NEW sweep (so long as it's not the first sweep)
  // Update this logic to work with the `consumed` property instead
  let firstSweep = true
  const cutoffIndex = orderedByCodeRefDest.findIndex((artifact) => {
    if (artifact.type === 'sweep' && firstSweep) {
      firstSweep = false
      return false
    }
    const isNew = artifact.type === 'sweep' && artifact.method === 'new'
    return isNew && !firstSweep
  })
  if (cutoffIndex !== -1) {
    orderedByCodeRefDest = orderedByCodeRefDest.slice(0, cutoffIndex)
  }

  return orderedByCodeRefDest.reverse()
}

/** Returns the last declared in code, relevant child */
export function getLastVariable(
  orderedDescArtifacts: Artifact[],
  ast: Node<Program>,
  wasmInstance: ModuleType,
  typeFilter?: Array<Artifact['type']>,
  nodeToEdit?: PathToNode
) {
  for (const artifact of orderedDescArtifacts) {
    if (typeFilter && !typeFilter.includes(artifact.type)) {
      continue
    }
    const codeRef = getFaceCodeRef(artifact)
    if (codeRef) {
      const pathToNode =
        codeRef.pathToNode ?? getNodePathFromSourceRange(ast, codeRef.range)
      const isSameAsNodeToEdit =
        nodeToEdit &&
        stringifyPathToNode(pathToNode) === stringifyPathToNode(nodeToEdit)
      if (pathToNode && pathToNode.length > 1 && !isSameAsNodeToEdit) {
        const varDec = getNodeFromPath<VariableDeclaration>(
          ast,
          pathToNode,
          wasmInstance,
          'VariableDeclaration'
        )
        if (!err(varDec)) {
          return {
            variableDeclaration: varDec,
            pathToNode: pathToNode,
            artifact,
          }
        }
      }
    }
  }
  return null
}

export function getEdgeCutMeta(
  artifact: Artifact,
  ast: Node<Program>,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): null | EdgeCutInfo {
  let edgeCutInfo: {
    segment: SegmentArtifact
    type: EdgeCutInfo['subType']
  } | null = null
  if (
    artifact?.type === 'edgeCut' &&
    (artifact.subType === 'chamfer' || artifact.subType === 'fillet')
  ) {
    const consumedArtifact = getArtifactOfTypes(
      {
        key: artifact.consumedEdgeId,
        types: ['segment', 'sweepEdge'],
      },
      artifactGraph
    )
    console.log('consumedArtifact', consumedArtifact)
    if (err(consumedArtifact)) return null
    if (consumedArtifact.type === 'segment') {
      edgeCutInfo = {
        type: 'base',
        segment: consumedArtifact,
      }
    } else {
      const segment = getArtifactOfTypes(
        { key: consumedArtifact.segId, types: ['segment'] },
        artifactGraph
      )
      if (err(segment)) return null
      edgeCutInfo = {
        type: consumedArtifact.subType,
        segment,
      }
    }
  }
  if (!edgeCutInfo) return null
  const segmentCallExpr = getNodeFromPath<CallExpressionKw>(
    ast,
    edgeCutInfo?.segment.codeRef.pathToNode || [],
    wasmInstance,
    ['CallExpressionKw']
  )
  if (err(segmentCallExpr)) return null
  if (segmentCallExpr.node.type !== 'CallExpressionKw') return null
  const sketchNodeArgs = segmentCallExpr.node.arguments.map((la) => la.arg)
  const tagDeclarator = sketchNodeArgs.find(
    ({ type }) => type === 'TagDeclarator'
  )
  if (!tagDeclarator || tagDeclarator.type !== 'TagDeclarator') return null

  return {
    type: 'edgeCut',
    subType: edgeCutInfo.type,
    tagName: tagDeclarator.value,
  }
}

export function isSketchSegmentCallName(name: string): boolean {
  return name in sketchLineHelperMapKw || name === 'close'
}

export function getSketchSegmentName(
  ast: Node<Program>,
  segmentId: string,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType
): string | null {
  const segment = getArtifactOfTypes(
    { key: segmentId, types: ['segment'] },
    artifactGraph
  )
  if (err(segment)) {
    return null
  }

  const directSegmentVarDec = getNodeFromPath<VariableDeclaration>(
    ast,
    segment.codeRef.pathToNode,
    wasmInstance,
    'VariableDeclaration'
  )
  if (
    !err(directSegmentVarDec) &&
    directSegmentVarDec.node.type === 'VariableDeclaration' &&
    directSegmentVarDec.node.declaration.init.type === 'CallExpressionKw' &&
    isSketchSegmentCallName(
      directSegmentVarDec.node.declaration.init.callee.name.name
    )
  ) {
    return directSegmentVarDec.node.declaration.id.name
  }

  return null
}

export function createSketchTagMemberExpression(
  sourceSurfaceExpr: Expr,
  segmentName: string
): Expr {
  return createMemberExpression(
    createMemberExpression(
      createMemberExpression(structuredClone(sourceSurfaceExpr), 'sketch'),
      'tags'
    ),
    segmentName
  )
}

export function getSketchSegmentNameFromSourceSurface(
  sourceSurfaceArtifact: Artifact,
  segmentArtifact: Artifact,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  options: { fallbackToFirstSegment?: boolean } = {}
): string | null {
  if (sourceSurfaceArtifact.type !== 'sweep') {
    return null
  }

  const sourceSurfaceNode = getNodeFromPath<CallExpressionKw>(
    ast,
    sourceSurfaceArtifact.codeRef.pathToNode,
    wasmInstance,
    ['CallExpressionKw']
  )
  if (
    err(sourceSurfaceNode) ||
    sourceSurfaceNode.node.type !== 'CallExpressionKw'
  ) {
    return null
  }

  const sweepInput = sourceSurfaceNode.node.unlabeled
  if (!sweepInput) {
    return null
  }

  let selectedSegment: Extract<Artifact, { type: 'segment' }> | null = null
  if (segmentArtifact.type === 'segment') {
    selectedSegment = segmentArtifact
  } else if (segmentArtifact.type === 'sweepEdge') {
    const segment = getArtifactOfTypes(
      { key: segmentArtifact.segId, types: ['segment'] },
      artifactGraph
    )
    if (!err(segment) && segment.type === 'segment') {
      selectedSegment = segment
    }
  } else if (segmentArtifact.type === 'wall') {
    const segment = getArtifactOfTypes(
      { key: segmentArtifact.segId, types: ['segment'] },
      artifactGraph
    )
    if (!err(segment) && segment.type === 'segment') {
      selectedSegment = segment
    }
  }

  if (
    sweepInput.type === 'MemberExpression' &&
    sweepInput.property.type === 'Name'
  ) {
    return sweepInput.property.name.name
  }

  if (sweepInput.type !== 'ArrayExpression') {
    return null
  }

  if (selectedSegment) {
    const pathArtifact = getArtifactOfTypes(
      { key: sourceSurfaceArtifact.pathId, types: ['path'] },
      artifactGraph
    )
    if (!err(pathArtifact) && pathArtifact.type === 'path') {
      const matchingSegmentIndex = pathArtifact.segIds.findIndex(
        (segmentId) =>
          segmentId === selectedSegment.originalSegId ||
          segmentId === selectedSegment.id
      )

      if (matchingSegmentIndex !== -1) {
        const matchingSegmentExpr = sweepInput.elements[matchingSegmentIndex]
        if (
          matchingSegmentExpr?.type === 'MemberExpression' &&
          matchingSegmentExpr.property.type === 'Name'
        ) {
          return matchingSegmentExpr.property.name.name
        }
      }
    }
  }

  if (options.fallbackToFirstSegment === false) {
    return null
  }

  const firstSweepSegment = sweepInput.elements.find(
    (element) =>
      element.type === 'MemberExpression' && element.property.type === 'Name'
  )
  if (
    firstSweepSegment?.type === 'MemberExpression' &&
    firstSweepSegment.property.type === 'Name'
  ) {
    return firstSweepSegment.property.name.name
  }

  return null
}

export function getRegionSketchTagExprFromSourceSurface(
  sourceSurfaceArtifact: Artifact,
  segmentArtifact: Artifact,
  artifactGraph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType
): Expr | null {
  if (sourceSurfaceArtifact.type !== 'sweep') {
    return null
  }

  const sourceSurfaceNode = getNodeFromPath<CallExpressionKw>(
    ast,
    sourceSurfaceArtifact.codeRef.pathToNode,
    wasmInstance,
    ['CallExpressionKw']
  )
  if (
    err(sourceSurfaceNode) ||
    sourceSurfaceNode.node.type !== 'CallExpressionKw'
  ) {
    return null
  }

  const sweepInput = sourceSurfaceNode.node.unlabeled
  if (!sweepInput || sweepInput.type !== 'Name') {
    return null
  }

  const segmentId =
    segmentArtifact.type === 'segment'
      ? segmentArtifact.id
      : segmentArtifact.type === 'sweepEdge'
        ? segmentArtifact.segId
        : segmentArtifact.type === 'wall'
          ? segmentArtifact.segId
          : null
  if (!segmentId) {
    return null
  }

  return getRegionTagExprFromSegmentId(
    ast,
    segmentId,
    artifactGraph,
    wasmInstance,
    sweepInput.name.name
  )
}

/**
 * Builds a region-tag member expression for a sketch-solve segment, e.g.
 * region001.tags.line2.
 *
 * If regionNameOverride is provided, the region name comes from that value.
 * Otherwise, this attempts to infer the region variable from the segment's
 * VariableDeclaration path.
 */
export function getRegionTagExprFromSegmentId(
  ast: Node<Program>,
  segmentId: string,
  artifactGraph: ArtifactGraph,
  wasmInstance: ModuleType,
  regionNameOverride?: string
): Expr | null {
  const segment = getArtifactOfTypes(
    { key: segmentId, types: ['segment'] },
    artifactGraph
  )
  if (err(segment)) {
    return null
  }
  if (!segment.originalSegId || segment.originalSegId === segment.id) {
    return null
  }

  const regionName = (() => {
    if (regionNameOverride) {
      return regionNameOverride
    }

    const regionVarDec = getNodeFromPath<VariableDeclaration>(
      ast,
      segment.codeRef.pathToNode,
      wasmInstance,
      'VariableDeclaration'
    )
    if (
      err(regionVarDec) ||
      regionVarDec.node.type !== 'VariableDeclaration' ||
      regionVarDec.node.declaration.init.type !== 'CallExpressionKw' ||
      regionVarDec.node.declaration.init.callee.name.name !== 'region'
    ) {
      return null
    }

    return regionVarDec.node.declaration.id.name
  })()
  if (!regionName) {
    return null
  }

  const originalSegName = getSketchSegmentName(
    ast,
    segment.originalSegId,
    artifactGraph,
    wasmInstance
  )
  if (!originalSegName) {
    return null
  }

  return createMemberExpression(
    createMemberExpression(regionName, 'tags'),
    originalSegName
  )
}
