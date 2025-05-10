import type { FunctionExpression } from '@rust/kcl-lib/bindings/FunctionExpression'
import type { ImportStatement } from '@rust/kcl-lib/bindings/ImportStatement'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { TypeDeclaration } from '@rust/kcl-lib/bindings/TypeDeclaration'
import { createLocalName, createPipeSubstitution } from '@src/lang/create'
import type { ToolTip } from '@src/lang/langHelpers'
import { splitPathAtLastIndex } from '@src/lang/modifyAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  codeRefFromRange,
  getArtifactOfTypes,
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
  ObjectExpression,
  ObjectProperty,
  PathToNode,
  PipeExpression,
  Program,
  ReturnStatement,
  SourceRange,
  SyntaxType,
  VariableDeclaration,
  VariableDeclarator,
  VariableMap,
} from '@src/lang/wasm'
import {
  kclSettings,
  recast,
  sketchFromKclValue,
  sketchFromKclValueOptional,
  unitAngToUnitAngle,
  unitLenToUnitLength,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/lib/selections'
import type { KclSettingsAnnotation } from '@src/lib/settings/settingsTypes'
import { Reason, err } from '@src/lib/trap'
import { getAngle, isArray } from '@src/lib/utils'

import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type { UnaryExpression } from 'typescript'
import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'

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
      const sourceCode = recast(node)
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
    currentNode = currentNode?.[pathItem[0]]
    successfulPaths.push(pathItem)
    if (!stopAtNode) {
      pathsExplored.push(pathItem)
    }
    if (
      typeof stopAt !== 'undefined' &&
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

export function hasExtrudeSketch({
  ast,
  selection,
  memVars,
}: {
  ast: Program
  selection: Selection
  memVars: VariableMap
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
  const varName = varDec.declaration.id.name
  const varValue = memVars[varName]
  return (
    varValue?.type === 'Solid' ||
    !(sketchFromKclValueOptional(varValue, varName) instanceof Reason)
  )
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

export function getObjExprProperty(
  node: ObjectExpression,
  propName: string
): { expr: ObjectProperty['value']; index: number } | null {
  const index = node.properties.findIndex(({ key }) => key.name === propName)
  if (index === -1) return null
  return { expr: node.properties[index].value, index }
}

export function isCursorInFunctionDefinition(
  ast: Node<Program>,
  selectionRanges: Selection
): boolean {
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
  kcl: string | Node<Program>
): KclSettingsAnnotation | Error {
  const metaSettings = kclSettings(kcl)
  if (err(metaSettings)) return metaSettings

  const settings: KclSettingsAnnotation = {}
  // No settings in the KCL.
  if (!metaSettings) return settings

  settings.defaultLengthUnit = unitLenToUnitLength(
    metaSettings.defaultLengthUnits
  )
  settings.defaultAngleUnit = unitAngToUnitAngle(metaSettings.defaultAngleUnits)

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

// Go from a selection of sketches to a list of KCL expressions that
// can be used to create KCL sweep call declarations.
export function getSketchExprsFromSelection(
  selection: Selections,
  ast: Node<Program>,
  nodeToEdit?: PathToNode
): Error | Expr[] {
  const sketches: Expr[] = selection.graphSelections.flatMap((s) => {
    const path = getNodePathFromSourceRange(ast, s?.codeRef.range)
    const sketchVariable = getNodeFromPath<VariableDeclarator>(
      ast,
      path,
      'VariableDeclarator'
    )
    if (err(sketchVariable)) {
      return []
    }

    if (sketchVariable.node.id) {
      const name = sketchVariable.node?.id.name
      if (nodeToEdit) {
        const result = getNodeFromPath<VariableDeclarator>(
          ast,
          nodeToEdit,
          'VariableDeclarator'
        )
        if (
          !err(result) &&
          result.node.type === 'VariableDeclarator' &&
          name === result.node.id.name
        ) {
          // Pointing to same variable case
          return createPipeSubstitution()
        }
      }
      // Pointing to different variable case
      return createLocalName(name)
    } else {
      // No variable case
      return createPipeSubstitution()
    }
  })

  if (sketches.length === 0) {
    return new Error("Couldn't map selections to program references")
  }

  return sketches
}

// Go from the sketches argument in a KCL sweep call declaration
// to a list of graph selections, useful for edit flows.
// Somewhat of an inverse of getSketchExprsFromSelection.
export function getSketchSelectionsFromOperation(
  operation: Operation,
  artifactGraph: ArtifactGraph
): Error | Selections {
  const error = new Error("Couldn't retrieve sketches from operation")
  if (operation.type !== 'StdLibCall' && operation.type !== 'KclStdLibCall') {
    return error
  }

  let sketches: OpKclValue[] = []
  if (operation.unlabeledArg?.value.type === 'Sketch') {
    sketches = [operation.unlabeledArg.value]
  } else if (operation.unlabeledArg?.value.type === 'Array') {
    sketches = operation.unlabeledArg.value.value
  } else {
    return error
  }

  const graphSelections: Selection[] = sketches.flatMap((sketch) => {
    // We have to go a little roundabout to get from the original artifact
    // to the solid2DId that we need to pass to the Extrude command.
    if (sketch.type !== 'Sketch') {
      return []
    }

    const pathArtifact = getArtifactOfTypes(
      {
        key: sketch.value.artifactId,
        types: ['path'],
      },
      artifactGraph
    )
    if (
      err(pathArtifact) ||
      pathArtifact.type !== 'path' ||
      !pathArtifact.solid2dId
    ) {
      return []
    }

    const solid2DArtifact = getArtifactOfTypes(
      {
        key: pathArtifact.solid2dId,
        types: ['solid2d'],
      },
      artifactGraph
    )
    if (err(solid2DArtifact) || solid2DArtifact.type !== 'solid2d') {
      return []
    }

    return {
      artifact: solid2DArtifact,
      codeRef: pathArtifact.codeRef,
    }
  })
  if (graphSelections.length === 0) {
    return error
  }

  return {
    graphSelections,
    otherSelections: [],
  }
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
