import type { BodyItem } from '@rust/kcl-lib/bindings/BodyItem'
import type { Name } from '@rust/kcl-lib/bindings/Name'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { NonCodeMeta } from '@rust/kcl-lib/bindings/NonCodeMeta'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createIdentifier,
  createImportAsSelector,
  createImportStatement,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createPipeExpression,
  createVariableDeclaration,
  findUniqueName,
} from '@src/lang/create'
import {
  findAllPreviousVariables,
  findAllPreviousVariablesPath,
  getBodyIndex,
  getNodeFromPath,
  isCallExprWithName,
  isNodeSafeToReplace,
  isNodeSafeToReplacePath,
} from '@src/lang/queryAst'
import {
  ARG_INDEX_FIELD,
  LABELED_ARG_FIELD,
  UNLABELED_ARG,
} from '@src/lang/queryAstConstants'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  addTagForSketchOnFace,
  getConstraintInfoKw,
} from '@src/lang/std/sketch'
import type { PathToNodeMap } from '@src/lang/std/sketchcombos'
import {
  isLiteralArrayOrStatic,
  removeSingleConstraint,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import type { SimplifiedArgDetails } from '@src/lang/std/stdTypes'
import type {
  ArrayExpression,
  CallExpressionKw,
  Expr,
  Literal,
  PathToNode,
  PipeExpression,
  Program,
  SourceRange,
  VariableDeclaration,
  VariableDeclarator,
  VariableMap,
} from '@src/lang/wasm'
import { isPathToNodeNumber, parse } from '@src/lang/wasm'
import type {
  KclCommandValue,
  KclExpressionWithVariable,
} from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import type { DefaultPlaneStr } from '@src/lib/planes'

import { err, trap } from '@src/lib/trap'
import { isArray, isOverlap, roundOff } from '@src/lib/utils'
import type { ExtrudeFacePlane } from '@src/machines/modelingMachine'
import { ARG_AT } from '@src/lang/constants'

export function startSketchOnDefault(
  node: Node<Program>,
  axis: DefaultPlaneStr,
  name = ''
): { modifiedAst: Node<Program>; id: string; pathToNode: PathToNode } {
  const _node = { ...node }
  const _name =
    name || findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.SKETCH)

  const startSketchOn = createCallExpressionStdLibKw(
    'startSketchOn',
    createLiteral(axis),
    []
  )

  const variableDeclaration = createVariableDeclaration(_name, startSketchOn)
  _node.body = [...node.body, variableDeclaration]
  const sketchIndex = _node.body.length - 1

  let pathToNode: PathToNode = [
    ['body', ''],
    [sketchIndex, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
  ]

  return {
    modifiedAst: _node,
    id: _name,
    pathToNode,
  }
}

export function insertNewStartProfileAt(
  node: Node<Program>,
  sketchNodePaths: PathToNode[],
  planeNodePath: PathToNode,
  at: [number, number],
  insertType: 'start' | 'end' = 'end'
):
  | {
      modifiedAst: Node<Program>
      updatedSketchNodePaths: PathToNode[]
      updatedEntryNodePath: PathToNode
    }
  | Error {
  const varDec = getNodeFromPath<VariableDeclarator>(
    node,
    planeNodePath,
    'VariableDeclarator'
  )
  if (err(varDec)) return varDec
  if (varDec.node.type !== 'VariableDeclarator') return new Error('not a var')

  const newExpression = createVariableDeclaration(
    findUniqueName(node, 'profile'),
    createCallExpressionStdLibKw(
      'startProfile',
      createLocalName(varDec.node.id.name),
      [
        createLabeledArg(
          ARG_AT,
          createArrayExpression([
            createLiteral(roundOff(at[0])),
            createLiteral(roundOff(at[1])),
          ])
        ),
      ]
    )
  )
  const insertIndex = getInsertIndex(sketchNodePaths, planeNodePath, insertType)

  const _node = structuredClone(node)
  // TODO the rest of this function will not be robust to work for sketches defined within a function declaration
  _node.body.splice(insertIndex, 0, newExpression)

  const { updatedEntryNodePath, updatedSketchNodePaths } =
    updateSketchNodePathsWithInsertIndex({
      insertIndex,
      insertType,
      sketchNodePaths,
    })
  return {
    modifiedAst: _node,
    updatedSketchNodePaths,
    updatedEntryNodePath,
  }
}

export function addSketchTo(
  node: Node<Program>,
  axis: 'xy' | 'xz' | 'yz',
  name = ''
): { modifiedAst: Program; id: string; pathToNode: PathToNode } {
  const _node = { ...node }
  const _name =
    name || findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.SKETCH)

  const startSketchOn = createCallExpressionStdLibKw(
    'startSketchOn',
    createLiteral(axis.toUpperCase()),
    []
  )
  const startProfile = createCallExpressionStdLibKw('startProfile', null, [
    createLabeledArg(ARG_AT, createLiteral('default')),
  ])
  const initialLineTo = createCallExpressionStdLibKw(
    'line',
    null, // Assumes this is being called in a pipeline, so the first arg is optional and if not given, will become pipeline substitution.
    [createLabeledArg('end', createLiteral('default'))]
  )

  const pipeBody = [startSketchOn, startProfile, initialLineTo]

  const variableDeclaration = createVariableDeclaration(
    _name,
    createPipeExpression(pipeBody)
  )

  _node.body = [...node.body, variableDeclaration]
  let sketchIndex = _node.body.length - 1
  let pathToNode: PathToNode = [
    ['body', ''],
    [sketchIndex, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
  ]
  if (axis !== 'xy') {
    pathToNode = [...pathToNode, ['body', ''], ['0', 'index']]
  }

  return {
    modifiedAst: _node,
    id: _name,
    pathToNode,
  }
}

/**
Set the keyword argument to the given value.
Returns true if it overwrote an existing argument.
Returns false if no argument with the label existed before.
Returns 'no-mutate' if the label was found, but the value is constrained and not
mutated.
Also do some checks to see if it's actually trying to set a constraint on
a sketch line that's already fully constrained, and if so, duplicates the arg.
WILL BE FIXED SOON.
*/
export function mutateKwArg(
  label: string,
  node: CallExpressionKw,
  val: Expr
): boolean | 'no-mutate' {
  for (let i = 0; i < node.arguments.length; i++) {
    const arg = node.arguments[i]
    if (arg.label?.name === label) {
      if (isLiteralArrayOrStatic(val) && isLiteralArrayOrStatic(arg.arg)) {
        node.arguments[i].arg = val
        return true
      } else if (
        arg.arg.type === 'ArrayExpression' &&
        val.type === 'ArrayExpression'
      ) {
        const arrExp = arg.arg
        arrExp.elements.forEach((element, i) => {
          if (isLiteralArrayOrStatic(element)) {
            arrExp.elements[i] = val.elements[i]
          }
        })
        return true
      }
      // The label was found, but the value is not a literal or static.
      return 'no-mutate'
    }
  }
  node.arguments.push(createLabeledArg(label, val))
  return false
}

/**
Set the keyword argument to the given value.
Returns true if it overwrote an existing argument.
Returns false if no argument with the label existed before.
*/
export function mutateKwArgOnly(
  label: string,
  node: CallExpressionKw,
  val: Expr
): boolean {
  for (let i = 0; i < node.arguments.length; i++) {
    const arg = node.arguments[i]
    if (arg.label?.name === label) {
      node.arguments[i].arg = val
      return true
    }
  }
  node.arguments.push(createLabeledArg(label, val))
  return false
}

/**
Mutates the given node by removing the labeled arguments.
*/
export function removeKwArgs(labels: string[], node: CallExpressionKw) {
  for (const label of labels) {
    const i = node.arguments.findIndex((la) => la.label?.name === label)
    if (i == -1) {
      continue
    }
    node.arguments.splice(i, 1)
  }
}

export function mutateArrExp(node: Expr, updateWith: ArrayExpression): boolean {
  if (node.type === 'ArrayExpression') {
    node.elements.forEach((element, i) => {
      if (isLiteralArrayOrStatic(element)) {
        node.elements[i] = updateWith.elements[i]
      }
    })
    return true
  }
  return false
}

export function mutateObjExpProp(
  node: Expr,
  updateWith: Node<Literal> | Node<ArrayExpression>,
  key: string
): boolean {
  if (node.type === 'ObjectExpression') {
    const keyIndex = node.properties.findIndex((a) => a.key.name === key)
    if (keyIndex !== -1) {
      if (
        isLiteralArrayOrStatic(updateWith) &&
        isLiteralArrayOrStatic(node.properties[keyIndex].value)
      ) {
        node.properties[keyIndex].value = updateWith
        return true
      } else if (
        node.properties[keyIndex].value.type === 'ArrayExpression' &&
        updateWith.type === 'ArrayExpression'
      ) {
        const arrExp = node.properties[keyIndex].value as ArrayExpression
        arrExp.elements.forEach((element, i) => {
          if (isLiteralArrayOrStatic(element)) {
            arrExp.elements[i] = updateWith.elements[i]
          }
        })
      }
      return true
    } else {
      node.properties.push({
        type: 'ObjectProperty',
        key: createIdentifier(key),
        value: updateWith,
        start: 0,
        end: 0,
        moduleId: 0,
        outerAttrs: [],
        preComments: [],
        commentStart: 0,
      })
    }
  }
  return false
}

export function addShell({
  node,
  sweepName,
  faces,
  thickness,
  insertIndex,
  variableName,
}: {
  node: Node<Program>
  sweepName: string
  faces: Expr[]
  thickness: Expr
  insertIndex?: number
  variableName?: string
}): { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(node)
  const name =
    variableName ?? findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.SHELL)
  const shell = createCallExpressionStdLibKw(
    'shell',
    createLocalName(sweepName),
    [
      createLabeledArg('faces', createArrayExpression(faces)),
      createLabeledArg('thickness', thickness),
    ]
  )

  const variable = createVariableDeclaration(name, shell)
  const insertAt =
    insertIndex !== undefined
      ? insertIndex
      : modifiedAst.body.length
        ? modifiedAst.body.length
        : 0

  if (modifiedAst.body.length) {
    modifiedAst.body.splice(insertAt, 0, variable)
  } else {
    modifiedAst.body.push(variable)
  }

  const argIndex = 0
  const pathToNode: PathToNode = [
    ['body', ''],
    [insertAt, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpressionKw'],
    [argIndex, ARG_INDEX_FIELD],
    ['arg', LABELED_ARG_FIELD],
  ]

  return {
    modifiedAst,
    pathToNode,
  }
}

export function sketchOnExtrudedFace(
  node: Node<Program>,
  sketchPathToNode: PathToNode,
  extrudePathToNode: PathToNode,
  info: ExtrudeFacePlane['faceInfo'] = { type: 'wall' }
): { modifiedAst: Node<Program>; pathToNode: PathToNode } | Error {
  let _node = { ...node }
  const newSketchName = findUniqueName(
    node,
    KCL_DEFAULT_CONSTANT_PREFIXES.SKETCH
  )
  const _node1 = getNodeFromPath<VariableDeclarator>(
    _node,
    sketchPathToNode,
    'VariableDeclarator',
    true
  )
  if (err(_node1)) return _node1
  const { node: oldSketchNode } = _node1

  const oldSketchName = oldSketchNode.id.name
  const _node2 = getNodeFromPath<CallExpressionKw>(_node, sketchPathToNode, [
    'CallExpressionKw',
  ])
  if (err(_node2)) return _node2
  const { node: expression } = _node2

  const _node3 = getNodeFromPath<VariableDeclarator>(
    _node,
    extrudePathToNode,
    'VariableDeclarator'
  )
  if (err(_node3)) return _node3
  const { node: extrudeVarDec } = _node3
  const extrudeName = extrudeVarDec.id?.name

  let _tag
  if (info.type !== 'cap') {
    const __tag = addTagForSketchOnFace(
      {
        pathToNode: sketchPathToNode,
        node: _node,
      },
      expression.callee.name.name,
      info.type === 'edgeCut' ? info : null
    )
    if (err(__tag)) return __tag
    const { modifiedAst, tag } = __tag
    _tag = createLocalName(tag)
    _node = modifiedAst
  } else {
    _tag = createLiteral(info.subType.toUpperCase())
  }
  const newSketch = createVariableDeclaration(
    newSketchName,
    createCallExpressionStdLibKw(
      'startSketchOn',
      createLocalName(extrudeName ? extrudeName : oldSketchName),
      [createLabeledArg('face', _tag)]
    ),
    undefined,
    'const'
  )

  const expressionIndex = Math.max(
    sketchPathToNode[1][0] as number,
    extrudePathToNode[1][0] as number,
    node.body.length - 1
  )
  _node.body.splice(expressionIndex + 1, 0, newSketch)
  const newpathToNode: PathToNode = [
    ['body', ''],
    [expressionIndex + 1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
  ]

  return {
    modifiedAst: _node,
    pathToNode: newpathToNode,
  }
}

/**
 * Append an offset plane to the AST
 */
export function addOffsetPlane({
  node,
  defaultPlane,
  insertIndex,
  offset,
  planeName,
}: {
  node: Node<Program>
  defaultPlane: DefaultPlaneStr
  insertIndex?: number
  offset: Expr
  planeName?: string
}): { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(node)
  const newPlaneName =
    planeName ?? findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.PLANE)

  const newPlane = createVariableDeclaration(
    newPlaneName,
    createCallExpressionStdLibKw(
      'offsetPlane',
      createLiteral(defaultPlane.toUpperCase()),
      [createLabeledArg('offset', offset)]
    )
  )

  const insertAt =
    insertIndex !== undefined
      ? insertIndex
      : modifiedAst.body.length
        ? modifiedAst.body.length
        : 0

  modifiedAst.body.length
    ? modifiedAst.body.splice(insertAt, 0, newPlane)
    : modifiedAst.body.push(newPlane)
  const pathToNode: PathToNode = [
    ['body', ''],
    [insertAt, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['unlabeled', UNLABELED_ARG],
  ]
  return {
    modifiedAst,
    pathToNode,
  }
}

/**
 * Add an import call to load a part
 */
export function addModuleImport({
  ast,
  path,
  localName,
}: {
  ast: Node<Program>
  path: string
  localName: string
}): {
  modifiedAst: Node<Program>
  pathToNode: PathToNode
} {
  const modifiedAst = structuredClone(ast)

  // Add import statement
  const importStatement = createImportStatement(
    createImportAsSelector(localName),
    { type: 'Kcl', filename: path }
  )
  const lastImportIndex = modifiedAst.body.findLastIndex(
    (v) => v.type === 'ImportStatement'
  )
  const importIndex = lastImportIndex + 1 // either -1 + 1 = 0 or after the last import
  modifiedAst.body.splice(importIndex, 0, importStatement)
  const pathToNode: PathToNode = [
    ['body', ''],
    [importIndex, 'index'],
    ['path', 'ImportStatement'],
  ]

  return {
    modifiedAst,
    pathToNode,
  }
}

/**
 * Append a helix to the AST
 */
export function addHelix({
  node,
  axis,
  cylinder,
  revolutions,
  angleStart,
  radius,
  length,
  ccw,
  insertIndex,
  variableName,
}: {
  node: Node<Program>
  axis?: Node<Literal> | Node<Name | CallExpressionKw>
  cylinder?: VariableDeclarator
  revolutions: Expr
  angleStart: Expr
  radius?: Expr
  length?: Expr
  ccw: boolean
  insertIndex?: number
  variableName?: string
}): { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(node)
  const name =
    variableName ?? findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.HELIX)
  const modeArgs: CallExpressionKw['arguments'] = []
  if (axis && radius) {
    modeArgs.push(createLabeledArg('axis', axis))
    modeArgs.push(createLabeledArg('radius', radius))
    if (length) {
      modeArgs.push(createLabeledArg('length', length))
    }
  } else if (cylinder) {
    modeArgs.push(
      createLabeledArg('cylinder', createLocalName(cylinder.id.name))
    )
  }

  const variable = createVariableDeclaration(
    name,
    createCallExpressionStdLibKw(
      'helix',
      null, // Not in a pipeline
      [
        ...modeArgs,
        createLabeledArg('revolutions', revolutions),
        createLabeledArg('angleStart', angleStart),
        createLabeledArg('ccw', createLiteral(ccw)),
      ]
    )
  )

  const insertAt =
    insertIndex !== undefined
      ? insertIndex
      : modifiedAst.body.length
        ? modifiedAst.body.length
        : 0

  modifiedAst.body.length
    ? modifiedAst.body.splice(insertAt, 0, variable)
    : modifiedAst.body.push(variable)
  const argIndex = 0
  const pathToNode: PathToNode = [
    ['body', ''],
    [insertAt, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpressionKw'],
    [argIndex, ARG_INDEX_FIELD],
    ['arg', LABELED_ARG_FIELD],
  ]

  return {
    modifiedAst,
    pathToNode,
  }
}

/**
 * Add clone statement
 */
export function addClone({
  ast,
  geometryName,
  variableName,
}: {
  ast: Node<Program>
  geometryName: string
  variableName: string
}): { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(ast)
  const variable = createVariableDeclaration(
    variableName,
    createCallExpressionStdLibKw('clone', createLocalName(geometryName), [])
  )

  modifiedAst.body.push(variable)
  const insertAt = modifiedAst.body.length - 1
  const pathToNode: PathToNode = [
    ['body', ''],
    [insertAt, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
  ]

  return {
    modifiedAst,
    pathToNode,
  }
}

/**
 * Return a modified clone of an AST with a named constant inserted into the body
 */
export function insertNamedConstant({
  node,
  newExpression,
}: {
  node: Node<Program>
  newExpression: KclExpressionWithVariable
}): Node<Program> {
  const ast = structuredClone(node)
  ast.body.splice(
    newExpression.insertIndex,
    0,
    newExpression.variableDeclarationAst
  )
  return ast
}

/**
 * Modify the AST to create a new sketch using the variable declaration
 * of an offset plane. The new sketch just has to come after the offset
 * plane declaration.
 */
export function sketchOnOffsetPlane(
  node: Node<Program>,
  offsetPathToNode: PathToNode
) {
  let _node = { ...node }

  // Find the offset plane declaration
  const offsetPlaneDeclarator = getNodeFromPath<VariableDeclarator>(
    _node,
    offsetPathToNode,
    'VariableDeclarator',
    true
  )
  if (err(offsetPlaneDeclarator)) return offsetPlaneDeclarator
  const { node: offsetPlaneNode } = offsetPlaneDeclarator
  const offsetPlaneName = offsetPlaneNode.id.name

  // Create a new sketch declaration
  const newSketchName = findUniqueName(
    node,
    KCL_DEFAULT_CONSTANT_PREFIXES.SKETCH
  )
  const newSketch = createVariableDeclaration(
    newSketchName,
    createCallExpressionStdLibKw(
      'startSketchOn',
      createLocalName(offsetPlaneName),
      []
    ),
    undefined,
    'const'
  )

  // Decide where to insert the new sketch declaration
  const offsetIndex = offsetPathToNode[1][0]

  if (!isPathToNodeNumber(offsetIndex)) {
    return new Error('Expected offsetIndex to be a number')
  }
  // and insert it
  _node.body.splice(offsetIndex + 1, 0, newSketch)
  const newPathToNode = structuredClone(offsetPathToNode)
  newPathToNode[1][0] = offsetIndex + 1

  // Return the modified AST and the path to the new sketch declaration
  return {
    modifiedAst: _node,
    pathToNode: newPathToNode,
  }
}

export const getLastIndex = (pathToNode: PathToNode): number =>
  splitPathAtLastIndex(pathToNode).index

export function splitPathAtLastIndex(pathToNode: PathToNode): {
  path: PathToNode
  index: number
} {
  const last = pathToNode[pathToNode.length - 1]
  if (last && typeof last[0] === 'number') {
    return {
      path: pathToNode.slice(0, -1),
      index: last[0],
    }
  } else if (pathToNode.length === 0) {
    return {
      path: [],
      index: -1,
    }
  }
  return splitPathAtLastIndex(pathToNode.slice(0, -1))
}

export function splitPathAtPipeExpression(pathToNode: PathToNode): {
  path: PathToNode
  index: number
} {
  const last = pathToNode[pathToNode.length - 1]

  if (
    last &&
    last[1] === 'index' &&
    pathToNode?.[pathToNode.length - 2]?.[1] === 'PipeExpression' &&
    typeof last[0] === 'number'
  ) {
    return {
      path: pathToNode.slice(0, -1),
      index: last[0],
    }
  } else if (pathToNode.length === 0) {
    return {
      path: [],
      index: -1,
    }
  }

  return splitPathAtPipeExpression(pathToNode.slice(0, -1))
}

/**
 * Replace a
 */
export function replaceValueAtNodePath({
  ast,
  pathToNode,
  newExpressionString,
}: {
  ast: Node<Program>
  pathToNode: PathToNode
  newExpressionString: string
}) {
  const replaceCheckResult = isNodeSafeToReplacePath(ast, pathToNode)
  if (err(replaceCheckResult)) {
    return replaceCheckResult
  }
  const { isSafe, value, replacer } = replaceCheckResult

  if (!isSafe || value.type === 'Name') {
    return new Error('Not safe to replace')
  }

  return replacer(ast, newExpressionString)
}

export function moveValueIntoNewVariablePath(
  ast: Node<Program>,
  memVars: VariableMap,
  pathToNode: PathToNode,
  variableName: string
): {
  modifiedAst: Node<Program>
  pathToReplacedNode?: PathToNode
} {
  const meta = isNodeSafeToReplacePath(ast, pathToNode)
  if (trap(meta)) return { modifiedAst: ast }
  const { isSafe, value, replacer } = meta

  if (!isSafe || value.type === 'Name') return { modifiedAst: ast }

  const { insertIndex } = findAllPreviousVariablesPath(ast, memVars, pathToNode)
  let _node = structuredClone(ast)
  const boop = replacer(_node, variableName)
  if (trap(boop)) return { modifiedAst: ast }

  _node = boop.modifiedAst
  _node.body.splice(
    insertIndex,
    0,
    createVariableDeclaration(variableName, value)
  )
  return { modifiedAst: _node, pathToReplacedNode: boop.pathToReplaced }
}

export function moveValueIntoNewVariable(
  ast: Node<Program>,
  memVars: VariableMap,
  sourceRange: SourceRange,
  variableName: string
): {
  modifiedAst: Node<Program>
  pathToReplacedNode?: PathToNode
} {
  const meta = isNodeSafeToReplace(ast, sourceRange)
  if (trap(meta)) return { modifiedAst: ast }
  const { isSafe, value, replacer } = meta
  if (!isSafe || value.type === 'Name') return { modifiedAst: ast }

  const { insertIndex } = findAllPreviousVariables(ast, memVars, sourceRange)
  let _node = structuredClone(ast)
  const replaced = replacer(_node, variableName)
  if (trap(replaced)) return { modifiedAst: ast }

  const { modifiedAst, pathToReplaced } = replaced
  _node = modifiedAst
  _node.body.splice(
    insertIndex,
    0,
    createVariableDeclaration(variableName, value)
  )
  return { modifiedAst: _node, pathToReplacedNode: pathToReplaced }
}

/**
 * Deletes a segment from a pipe expression, if the segment has a tag that other segments use, it will remove that value and replace it with the equivalent literal
 * @param dependentRanges - The ranges of the segments that are dependent on the segment being deleted, this is usually the output of `findUsesOfTagInPipe`
 */
export function deleteSegmentFromPipeExpression(
  dependentRanges: SourceRange[],
  modifiedAst: Node<Program>,
  memVars: VariableMap,
  code: string,
  pathToNode: PathToNode
): Node<Program> | Error {
  let _modifiedAst = structuredClone(modifiedAst)

  dependentRanges.forEach((range) => {
    const path = getNodePathFromSourceRange(_modifiedAst, range)

    const callExp = getNodeFromPath<Node<CallExpressionKw>>(
      _modifiedAst,
      path,
      ['CallExpressionKw'],
      true
    )
    if (err(callExp)) return callExp

    const constraintInfo = getConstraintInfoKw(callExp.node, code, path).find(
      ({ sourceRange }) => isOverlap(sourceRange, range)
    )
    if (!constraintInfo) return

    if (!constraintInfo.argPosition) return
    const transform = removeSingleConstraintInfo(
      callExp.shallowPath,
      constraintInfo.argPosition,
      _modifiedAst,
      memVars
    )
    if (!transform) return
    _modifiedAst = transform.modifiedAst
  })

  const pipeExpression = getNodeFromPath<PipeExpression>(
    _modifiedAst,
    pathToNode,
    'PipeExpression'
  )
  if (err(pipeExpression)) return pipeExpression

  const pipeInPathIndex = pathToNode.findIndex(
    ([_, desc]) => desc === 'PipeExpression'
  )
  const segmentIndexInPipe = pathToNode[pipeInPathIndex + 1]
  pipeExpression.node.body.splice(segmentIndexInPipe[0] as number, 1)

  // Move up to the next segment.
  segmentIndexInPipe[0] = Math.max((segmentIndexInPipe[0] as number) - 1, 0)

  return _modifiedAst
}

/**
 * Deletes a standalone top level statement from the AST
 * Used for removing both unassigned statements and variable declarations
 *
 * @param ast The AST to modify
 * @param pathToNode The path to the node to delete
 */
export function deleteTopLevelStatement(
  ast: Node<Program>,
  pathToNode: PathToNode
): Error | void {
  const pathStep = pathToNode[1]
  if (!isArray(pathStep) || typeof pathStep[0] !== 'number') {
    return new Error(
      'Invalid pathToNode structure: expected a number at path[1][0]'
    )
  }
  const statementIndex: number = pathStep[0]
  ast.body.splice(statementIndex, 1)
}

export function removeSingleConstraintInfo(
  pathToCallExp: PathToNode,
  argDetails: SimplifiedArgDetails,
  ast: Node<Program>,
  memVars: VariableMap
):
  | {
      modifiedAst: Node<Program>
      pathToNodeMap: PathToNodeMap
    }
  | false {
  const transform = removeSingleConstraint({
    pathToCallExp,
    inputDetails: argDetails,
    ast,
  })
  if (!transform) return false
  const retval = transformAstSketchLines({
    ast,
    selectionRanges: [pathToCallExp],
    transformInfos: [transform],
    memVars,
    referenceSegName: '',
  })
  if (err(retval)) return false
  return retval
}

export function getInsertIndex(
  sketchNodePaths: PathToNode[],
  planeNodePath: PathToNode,
  insertType: 'start' | 'end'
) {
  let minIndex = 0
  let maxIndex = 0
  for (const path of sketchNodePaths) {
    const index = Number(path[1][0])
    if (index < minIndex) minIndex = index
    if (index > maxIndex) maxIndex = index
  }

  const insertIndex = !sketchNodePaths.length
    ? Number(planeNodePath[1][0]) + 1
    : insertType === 'start'
      ? minIndex
      : maxIndex + 1
  return insertIndex
}

export function updateSketchNodePathsWithInsertIndex({
  insertIndex,
  insertType,
  sketchNodePaths,
}: {
  insertIndex: number
  insertType: 'start' | 'end'
  sketchNodePaths: PathToNode[]
}): {
  updatedEntryNodePath: PathToNode
  updatedSketchNodePaths: PathToNode[]
} {
  // TODO the rest of this function will not be robust to work for sketches defined within a function declaration
  const newExpressionPathToNode: PathToNode = [
    ['body', ''],
    [insertIndex, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
  ]
  let updatedSketchNodePaths = structuredClone(sketchNodePaths)
  if (insertType === 'start') {
    updatedSketchNodePaths = updatedSketchNodePaths.map((path) => {
      path[1][0] = Number(path[1][0]) + 1
      return path
    })
    updatedSketchNodePaths.unshift(newExpressionPathToNode)
  } else {
    updatedSketchNodePaths.push(newExpressionPathToNode)
  }
  return {
    updatedSketchNodePaths,
    updatedEntryNodePath: newExpressionPathToNode,
  }
}

/**
 * 
 * Split the following pipe expression into 
 * ```ts
 * part001 = startSketchOn(XZ)
  |> startProfile(at = [1, 2])
  |> line(end = [3, 4])
  |> line(end = [5, 6])
  |> close()
extrude001 = extrude(part001, length = 5)
```
into
```ts
sketch001 = startSketchOn(XZ)
part001 = startProfile(sketch001, at = [1, 2])
  |> line(end = [3, 4])
  |> line(end = [5, 6])
  |> close()
extrude001 = extrude(part001, length = 5)
```
Notice that the `startSketchOn` is what gets the new variable name, this is so part001 still has the same data as before
making it safe for later code that uses part001 (the extrude in this example)
 * 
 */
export function splitPipedProfile(
  ast: Node<Program>,
  pathToPipe: PathToNode
):
  | {
      modifiedAst: Node<Program>
      pathToProfile: PathToNode
      pathToPlane: PathToNode
    }
  | Error {
  const _ast = structuredClone(ast)
  const varDec = getNodeFromPath<Node<VariableDeclaration>>(
    _ast,
    pathToPipe,
    'VariableDeclaration'
  )
  if (err(varDec)) return varDec
  if (
    varDec.node.type !== 'VariableDeclaration' ||
    varDec.node.declaration.init.type !== 'PipeExpression'
  ) {
    return new Error('pathToNode does not point to pipe')
  }
  const init = varDec.node.declaration.init
  const firstCall = init.body[0]
  if (!isCallExprWithName(firstCall, 'startSketchOn'))
    return new Error('First call is not startSketchOn')
  const secondCall = init.body[1]
  if (!isCallExprWithName(secondCall, 'startProfile'))
    return new Error('Second call is not startProfileAt')

  const varName = varDec.node.declaration.id.name
  const newVarName = findUniqueName(_ast, 'sketch')
  // const secondCallArgs = structuredClone(secondCall.arguments)
  // secondCallArgs[1] = createLocalName(newVarName)
  secondCall.unlabeled = createLocalName(newVarName)
  const startSketchOnBrokenIntoNewVarDec = structuredClone(varDec.node)
  const profileBrokenIntoItsOwnVar = structuredClone(varDec.node)
  if (
    startSketchOnBrokenIntoNewVarDec.declaration.init.type !== 'PipeExpression'
  ) {
    return new Error('clonedVarDec1 is not a PipeExpression')
  }
  varDec.node.declaration.init =
    startSketchOnBrokenIntoNewVarDec.declaration.init.body[0]
  varDec.node.declaration.id.name = newVarName
  if (profileBrokenIntoItsOwnVar.declaration.init.type !== 'PipeExpression') {
    return new Error('clonedVarDec2 is not a PipeExpression')
  }
  profileBrokenIntoItsOwnVar.declaration.init.body =
    profileBrokenIntoItsOwnVar.declaration.init.body.slice(1)
  if (
    !(
      profileBrokenIntoItsOwnVar.declaration.init.body[0].type ===
        'CallExpressionKw' &&
      profileBrokenIntoItsOwnVar.declaration.init.body[0].callee.name.name ===
        'startProfile'
    )
  ) {
    return new Error('problem breaking pipe, expect startProfileAt to be first')
  }
  profileBrokenIntoItsOwnVar.declaration.init.body[0].unlabeled =
    createLocalName(newVarName)
  profileBrokenIntoItsOwnVar.declaration.id.name = varName
  profileBrokenIntoItsOwnVar.preComments = [] // we'll duplicate the comments since the new variable will have it to

  // new pipe has one less from the start, so need to decrement comments for them to remain in the same place
  if (profileBrokenIntoItsOwnVar.declaration.init?.nonCodeMeta?.nonCodeNodes) {
    let decrementedNonCodeMeta: NonCodeMeta['nonCodeNodes'] = {}
    decrementedNonCodeMeta =
      Object.entries(
        profileBrokenIntoItsOwnVar.declaration.init?.nonCodeMeta?.nonCodeNodes
      ).reduce((acc, [key, value]) => {
        acc[Number(key) - 1] = value
        return acc
      }, decrementedNonCodeMeta) || {}
    profileBrokenIntoItsOwnVar.declaration.init.nonCodeMeta.nonCodeNodes =
      decrementedNonCodeMeta
  }

  const index = getBodyIndex(pathToPipe)
  if (err(index)) return index
  _ast.body.splice(index + 1, 0, profileBrokenIntoItsOwnVar)
  const pathToPlane = structuredClone(pathToPipe)
  const pathToProfile = structuredClone(pathToPipe)
  pathToProfile[1][0] = index + 1

  return {
    modifiedAst: _ast,
    pathToProfile,
    pathToPlane,
  }
}

export function createNodeFromExprSnippet(
  strings: TemplateStringsArray,
  ...expressions: any[]
): Node<BodyItem> | Error {
  const code = strings.reduce(
    (acc, str, i) => acc + str + (expressions[i] || ''),
    ''
  )
  let program = parse(code)
  if (err(program)) return program
  const node = program.program?.body[0]
  if (!node) return new Error('No node found')
  return node
}

export function insertVariableAndOffsetPathToNode(
  variable: KclCommandValue,
  modifiedAst: Node<Program>,
  pathToNode?: PathToNode
) {
  if ('variableName' in variable && variable.variableName) {
    modifiedAst.body.splice(
      variable.insertIndex,
      0,
      variable.variableDeclarationAst
    )
    if (pathToNode && pathToNode[1] && typeof pathToNode[1][0] === 'number') {
      pathToNode[1][0]++
    }
  }
}
