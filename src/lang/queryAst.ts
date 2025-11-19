import type { FunctionExpression } from '@rust/kcl-lib/bindings/FunctionExpression'
import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { TypeDeclaration } from '@rust/kcl-lib/bindings/TypeDeclaration'
import {
  createLiteral,
  createLocalName,
  createPipeSubstitution,
} from '@src/lang/create'
import type { ToolTip } from '@src/lang/langHelpers'
import { splitPathAtLastIndex } from '@src/lang/modifyAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  codeRefFromRange,
  getArtifactOfTypes,
  getCodeRefsByArtifactId,
  getFaceCodeRef,
} from '@src/lang/std/artifactGraph'
import { getArgForEnd } from '@src/lang/std/sketch'
import { getSketchSegmentFromSourceRange } from '@src/lang/std/sketchConstraints'
import {
  getConstraintLevelFromSourceRange,
  getConstraintType,
} from '@src/lang/std/sketchcombos'
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
  VariableDeclaration,
  VariableDeclarator,
  VariableMap,
} from '@src/lang/wasm'
import { kclSettings, recast, sketchFromKclValue } from '@src/lang/wasm'
import type { KclSettingsAnnotation } from '@src/lib/settings/settingsTypes'
import { err } from '@src/lib/trap'
import { getAngle, isArray } from '@src/lib/utils'

import type { Artifact, Plane } from '@rust/kcl-lib/bindings/Artifact'
import type { NumericType } from '@rust/kcl-lib/bindings/NumericType'
import type { OpArg, Operation } from '@rust/kcl-lib/bindings/Operation'
import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { UnaryExpression } from 'typescript'
import type {
  Selection,
  Selections,
  EdgeCutInfo,
} from '@src/machines/modelingSharedTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

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
  stopAt?: SyntaxType | SyntaxType[],
  returnEarly = false,
  suppressNoise = false,
  replacement?: any,
  wasmInstance?: ModuleType
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
  wasmInstance?: ModuleType
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
      stopAt,
      returnEarly,
      undefined,
      undefined,
      wasmInstance
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
    // hmm this smell
    _traverse(_node.object, [...pathToNode, ['object', 'MemberExpression']])
    _traverse(_node.property, [...pathToNode, ['property', 'MemberExpression']])
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
    const varName = item.declaration.id.name
    const varValue = memVars[varName]
    if (!varValue || typeof varValue?.value !== type) return
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
  type: 'number' | 'string' = 'number'
): {
  variables: PrevVariable<typeof type extends 'number' ? number : string>[]
  bodyPath: PathToNode
  insertIndex: number
} {
  const path = getNodePathFromSourceRange(ast, sourceRange)
  return findAllPreviousVariablesPath(ast, memVars, path, type)
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
    'Name',
    'CallExpressionKw',
    'Literal',
    'UnaryExpression',
  ]
  const _node1 = getNodeFromPath<
    BinaryExpression | Name | CallExpressionKw | Literal | UnaryExpression
  >(ast, path, acceptedNodeTypes)
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
    const _nodeToReplace = getNodeFromPath(_ast, startPath)
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
  sourceRange: SourceRange
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
    const _secondaryNode = getNodeFromPath<CallExpressionKw>(
      ast,
      secondaryPath,
      ['CallExpressionKw']
    )
    if (err(_secondaryNode)) return _secondaryNode
    const secondaryNode = _secondaryNode.node
    const _varDec = getNodeFromPath(ast, primaryPath, 'VariableDeclaration')
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

    const _varDec2 = getNodeFromPath(ast, secondaryPath, 'VariableDeclaration')
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
  pathToNode: PathToNode
): SourceRange[] {
  const stdlibFunctionsThatTakeTagInputs = [
    'segAng',
    'segEndX',
    'segEndY',
    'segLen',
  ]
  const nodeMeta = getNodeFromPath<CallExpressionKw>(ast, pathToNode, [
    'CallExpressionKw',
  ])
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
  traverse(ast as any, {
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
  selectionRanges: Selection
): boolean {
  if (ast.body.length === 0) return false
  if (!selectionRanges?.codeRef?.pathToNode) return false
  const node = getNodeFromPath<FunctionExpression>(
    ast,
    selectionRanges.codeRef.pathToNode,
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
  pathToPipe: PathToNode
): boolean | Error {
  const varDec = getNodeFromPath<VariableDeclarator>(
    ast,
    pathToPipe,
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
  instance?: ModuleType
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
  pathToUpdate: PathToNode
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

// Go from a selection to a list of KCL expressions that
// can be used to create function calls in codemods.
// lastChildLookup will look for the last child of the selection in the artifact graph
export function getVariableExprsFromSelection(
  selection: Selections,
  ast: Node<Program>,
  nodeToEdit?: PathToNode,
  lastChildLookup = false,
  artifactGraph?: ArtifactGraph,
  artifactTypeFilter?: Array<Artifact['type']>
): Error | { exprs: Expr[]; pathIfPipe?: PathToNode } {
  let pathIfPipe: PathToNode | undefined
  const exprs: Expr[] = []
  const pushedNames = {} as Record<string, boolean>
  for (const s of selection.graphSelections) {
    let variable:
      | {
          node: VariableDeclaration
          shallowPath: PathToNode
          deepPath: PathToNode
        }
      | undefined
    if (lastChildLookup && s.artifact && artifactGraph) {
      const children = findAllChildrenAndOrderByPlaceInCode(
        s.artifact,
        artifactGraph
      )
      const lastChildVariable = getLastVariable(
        children,
        ast,
        artifactTypeFilter
      )
      if (!lastChildVariable) {
        continue
      }

      variable = lastChildVariable.variableDeclaration
    } else {
      const directLookup = getNodeFromPath<VariableDeclaration>(
        ast,
        s.codeRef.pathToNode,
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
    const importNodeAndAlias = findImportNodeAndAlias(ast, s.codeRef.pathToNode)
    if (importNodeAndAlias) {
      exprs.push(createLocalName(importNodeAndAlias.alias))
      continue
    }

    // No variable case
    exprs.push(createPipeSubstitution())
    pathIfPipe = s.codeRef.pathToNode
  }

  if (exprs.length === 0) {
    return new Error("Couldn't map selections to program references")
  }

  return { exprs, pathIfPipe }
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
  if (opArg.value.type === 'Solid' || opArg.value.type === 'Sketch') {
    artifactIds = [opArg.value.value.artifactId]
  } else if (opArg.value.type === 'ImportedGeometry') {
    artifactIds = [opArg.value.artifact_id]
  } else if (opArg.value.type === 'Array') {
    artifactIds = opArg.value.value
      .filter((v) => v.type === 'Solid' || v.type === 'Sketch')
      .map((v) => v.value.artifactId)
  } else {
    return error
  }

  const graphSelections: Selection[] = []
  for (const artifactId of artifactIds) {
    const artifact = artifactGraph.get(artifactId)
    if (!artifact) {
      continue
    }

    const codeRefs = getCodeRefsByArtifactId(artifactId, artifactGraph)
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

  return { graphSelections, otherSelections: [] } as Selections
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

export function getSelectedPlaneAsNode(
  selection: Selections,
  variables: VariableMap
): Node<Name> | Node<Literal> | undefined {
  const defaultPlane = selection.otherSelections.find(
    (selection) => typeof selection === 'object' && 'name' in selection
  )
  if (
    defaultPlane &&
    defaultPlane instanceof Object &&
    'name' in defaultPlane
  ) {
    return createLiteral(defaultPlane.name.toUpperCase())
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
  pathToNode: PathToNode
): { variableDeclarator: VariableDeclarator; shallowPath: PathToNode } | Error {
  const variableDeclarationNode = getNodeFromPath<VariableDeclaration>(
    ast,
    pathToNode,
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
  pathToNode: PathToNode
) {
  const importNode = getNodeFromPath<ImportStatement>(ast, pathToNode, [
    'ImportStatement',
  ])
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
  callInPipe?: string
) {
  let pipes: { expression: PipeExpression; pathToNode: PathToNode }[] = []
  const importNodeAndAlias = findImportNodeAndAlias(ast, pathToNode)
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
  const result: string[] = []
  const stack: string[] = [artifact.id]

  const getArtifacts = (stringIds: string[]): Artifact[] => {
    const artifactsWithCodeRefs: Artifact[] = []
    for (const id of stringIds) {
      const artifact = artifactGraph.get(id)
      if (artifact) {
        const codeRef = getFaceCodeRef(artifact)
        if (codeRef && codeRef.range[1] > 0) {
          artifactsWithCodeRefs.push(artifact)
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
      result.push(resultId)
    } else {
      if (childrenIdOrIds) {
        stack.push(childrenIdOrIds)
      }
      result.push(resultId)
    }
  }

  while (stack.length > 0) {
    const currentId = stack.pop()!
    const current = artifactGraph.get(currentId)
    if (current?.type === 'path') {
      pushToSomething(currentId, current.sweepId)
      pushToSomething(currentId, current.segIds)
    } else if (current?.type === 'sweep') {
      pushToSomething(currentId, current.surfaceIds)
      const path = artifactGraph.get(current.pathId)
      if (path && path.type === 'path') {
        const compositeSolidId = path.compositeSolidId
        if (compositeSolidId) {
          result.push(compositeSolidId)
        }
      }
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
      pushToSomething(currentId, current.solidIds)
      pushToSomething(currentId, current.toolIds)
    }
  }

  const resultSet = new Set(result)
  const codeRefArtifacts = getArtifacts(Array.from(resultSet))
  let orderedByCodeRefDest = codeRefArtifacts.sort((a, b) => {
    const aCodeRef = getFaceCodeRef(a)
    const bCodeRef = getFaceCodeRef(b)
    if (!aCodeRef || !bCodeRef) {
      return 0
    }
    return aCodeRef.range[0] - bCodeRef.range[0]
  })

  // Cut off traversal results at the first NEW sweep (so long as it's not the first sweep)
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
  typeFilter?: Array<Artifact['type']>
) {
  for (const artifact of orderedDescArtifacts) {
    if (typeFilter && !typeFilter.includes(artifact.type)) {
      continue
    }
    const codeRef = getFaceCodeRef(artifact)
    if (codeRef) {
      const pathToNode =
        codeRef.pathToNode ?? getNodePathFromSourceRange(ast, codeRef.range)
      if (pathToNode && pathToNode.length > 1) {
        const varDec = getNodeFromPath<VariableDeclaration>(
          ast,
          pathToNode,
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
  artifactGraph: ArtifactGraph
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
