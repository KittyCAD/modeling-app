import { err, reportRejection, trap } from 'lib/trap'
import { Selection } from 'lib/selections'
import {
  Program,
  CallExpression,
  LabeledArg,
  CallExpressionKw,
  PipeExpression,
  VariableDeclaration,
  VariableDeclarator,
  Expr,
  Literal,
  LiteralValue,
  PipeSubstitution,
  Identifier,
  ArrayExpression,
  ObjectExpression,
  UnaryExpression,
  BinaryExpression,
  PathToNode,
  SourceRange,
  sketchFromKclValue,
  isPathToNodeNumber,
  parse,
  formatNumber,
  ArtifactGraph,
  VariableMap,
  KclValue,
} from './wasm'
import {
  isNodeSafeToReplacePath,
  findAllPreviousVariables,
  findAllPreviousVariablesPath,
  getNodeFromPath,
  isNodeSafeToReplace,
  traverse,
  getBodyIndex,
  isCallExprWithName,
  ARG_INDEX_FIELD,
  LABELED_ARG_FIELD,
  UNLABELED_ARG,
} from './queryAst'
import {
  addTagForSketchOnFace,
  ARG_TAG,
  getConstraintInfo,
  getConstraintInfoKw,
} from './std/sketch'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import {
  PathToNodeMap,
  isLiteralArrayOrStatic,
  removeSingleConstraint,
  transformAstSketchLines,
} from './std/sketchcombos'
import { DefaultPlaneStr } from 'lib/planes'
import { isArray, isOverlap, roundOff } from 'lib/utils'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from 'lib/constants'
import { SimplifiedArgDetails } from './std/stdTypes'
import { TagDeclarator } from '@rust/kcl-lib/bindings/TagDeclarator'
import { Models } from '@kittycad/lib'
import { ExtrudeFacePlane } from 'machines/modelingMachine'
import { Node } from '@rust/kcl-lib/bindings/Node'
import { KclExpressionWithVariable } from 'lib/commandTypes'
import {
  Artifact,
  expandCap,
  expandPlane,
  expandWall,
  getArtifactOfTypes,
  getArtifactsOfTypes,
  getFaceCodeRef,
  getPathsFromArtifact,
} from './std/artifactGraph'
import { BodyItem } from '@rust/kcl-lib/bindings/BodyItem'
import { findKwArg } from './util'
import { deleteEdgeTreatment } from './modifyAst/addEdgeTreatment'
import { codeManager } from 'lib/singletons'

export function startSketchOnDefault(
  node: Node<Program>,
  axis: DefaultPlaneStr,
  name = ''
): { modifiedAst: Node<Program>; id: string; pathToNode: PathToNode } {
  const _node = { ...node }
  const _name =
    name || findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.SKETCH)

  const startSketchOn = createCallExpressionStdLib('startSketchOn', [
    createLiteral(axis),
  ])

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
  sketchEntryNodePath: PathToNode,
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
    createCallExpressionStdLib('startProfileAt', [
      createArrayExpression([
        createLiteral(roundOff(at[0])),
        createLiteral(roundOff(at[1])),
      ]),
      createIdentifier(varDec.node.id.name),
    ])
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

  const startSketchOn = createCallExpressionStdLib('startSketchOn', [
    createLiteral(axis.toUpperCase()),
  ])
  const startProfileAt = createCallExpressionStdLib('startProfileAt', [
    createLiteral('default'),
    createPipeSubstitution(),
  ])
  const initialLineTo = createCallExpressionStdLibKw(
    'line',
    null, // Assumes this is being called in a pipeline, so the first arg is optional and if not given, will become pipeline substitution.
    [createLabeledArg('end', createLiteral('default'))]
  )

  const pipeBody = [startSketchOn, startProfileAt, initialLineTo]

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

export function findUniqueName(
  ast: Program | string,
  name: string,
  pad = 3,
  index = 1
): string {
  let searchStr: string = typeof ast === 'string' ? ast : JSON.stringify(ast)
  const indexStr = String(index).padStart(pad, '0')

  const endingDigitsMatcher = /\d+$/
  const nameEndsInDigits = name.match(endingDigitsMatcher)
  let nameIsInString = searchStr.includes(`:"${name}"`)

  if (nameEndsInDigits !== null) {
    // base case: name is unique and ends in digits
    if (!nameIsInString) return name

    // recursive case: name is not unique and ends in digits
    const newPad = nameEndsInDigits[1].length
    const newIndex = parseInt(nameEndsInDigits[1]) + 1
    const nameWithoutDigits = name.replace(endingDigitsMatcher, '')

    return findUniqueName(searchStr, nameWithoutDigits, newPad, newIndex)
  }

  const newName = `${name}${indexStr}`
  nameIsInString = searchStr.includes(`:"${newName}"`)

  // base case: name is unique and does not end in digits
  if (!nameIsInString) return newName

  // recursive case: name is not unique and does not end in digits
  return findUniqueName(searchStr, name, pad, index + 1)
}

/**
Set the keyword argument to the given value.
Returns true if it overwrote an existing argument.
Returns false if no argument with the label existed before.
*/
export function mutateKwArg(
  label: string,
  node: CallExpressionKw,
  val: Expr
): boolean {
  for (let i = 0; i < node.arguments.length; i++) {
    const arg = node.arguments[i]
    if (arg.label.name === label) {
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
    const i = node.arguments.findIndex((la) => la.label.name === label)
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
      })
    }
  }
  return false
}

export function extrudeSketch({
  node,
  pathToNode,
  distance = createLiteral(4),
  extrudeName,
  artifact,
  artifactGraph,
}: {
  node: Node<Program>
  pathToNode: PathToNode
  distance: Expr
  extrudeName?: string
  artifactGraph: ArtifactGraph
  artifact?: Artifact
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
      pathToExtrudeArg: PathToNode
    }
  | Error {
  const orderedSketchNodePaths = getPathsFromArtifact({
    artifact: artifact,
    sketchPathToNode: pathToNode,
    artifactGraph,
    ast: node,
  })
  if (err(orderedSketchNodePaths)) return orderedSketchNodePaths
  const _node = structuredClone(node)
  const _node1 = getNodeFromPath(_node, pathToNode)
  if (err(_node1)) return _node1

  // determine if sketchExpression is in a pipeExpression or not
  const _node2 = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  if (err(_node2)) return _node2

  const _node3 = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator'
  )
  if (err(_node3)) return _node3
  const { node: variableDeclarator } = _node3

  const extrudeCall = createCallExpressionStdLibKw(
    'extrude',
    createIdentifier(variableDeclarator.id.name),
    [createLabeledArg('length', distance)]
  )
  // index of the 'length' arg above. If you reorder the labeled args above,
  // make sure to update this too.
  const argIndex = 0

  // We're not creating a pipe expression,
  // but rather a separate constant for the extrusion
  const name =
    extrudeName ?? findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.EXTRUDE)
  const VariableDeclaration = createVariableDeclaration(name, extrudeCall)

  const lastSketchNodePath =
    orderedSketchNodePaths[orderedSketchNodePaths.length - 1]

  const sketchIndexInBody = Number(lastSketchNodePath[1][0])
  _node.body.splice(sketchIndexInBody + 1, 0, VariableDeclaration)

  const pathToExtrudeArg: PathToNode = [
    ['body', ''],
    [sketchIndexInBody + 1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpressionKw'],
    [argIndex, ARG_INDEX_FIELD],
    ['arg', LABELED_ARG_FIELD],
  ]
  return {
    modifiedAst: _node,
    pathToNode: [...pathToNode.slice(0, -1), [-1, 'index']],
    pathToExtrudeArg,
  }
}

export function loftSketches(
  node: Node<Program>,
  declarators: VariableDeclarator[]
): {
  modifiedAst: Node<Program>
  pathToNode: PathToNode
} {
  const modifiedAst = structuredClone(node)
  const name = findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.LOFT)
  const elements = declarators.map((d) => createIdentifier(d.id.name))
  const loft = createCallExpressionStdLib('loft', [
    createArrayExpression(elements),
  ])
  const declaration = createVariableDeclaration(name, loft)
  modifiedAst.body.push(declaration)
  const pathToNode: PathToNode = [
    ['body', ''],
    [modifiedAst.body.length - 1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpression'],
    [0, 'index'],
  ]

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addSweep(
  node: Node<Program>,
  profileDeclarator: VariableDeclarator,
  pathDeclarator: VariableDeclarator
): {
  modifiedAst: Node<Program>
  pathToNode: PathToNode
} {
  const modifiedAst = structuredClone(node)
  const name = findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.SWEEP)
  const sweep = createCallExpressionStdLibKw(
    'sweep',
    createIdentifier(profileDeclarator.id.name),
    [createLabeledArg('path', createIdentifier(pathDeclarator.id.name))]
  )
  const declaration = createVariableDeclaration(name, sweep)
  modifiedAst.body.push(declaration)
  const pathToNode: PathToNode = [
    ['body', ''],
    [modifiedAst.body.length - 1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpressionKw'],
    [0, ARG_INDEX_FIELD],
    ['arg', LABELED_ARG_FIELD],
  ]

  return {
    modifiedAst,
    pathToNode,
  }
}

export function revolveSketch(
  node: Node<Program>,
  pathToNode: PathToNode,
  shouldPipe = false,
  angle: Expr = createLiteral(4)
):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
      pathToRevolveArg: PathToNode
    }
  | Error {
  const _node = structuredClone(node)
  const _node1 = getNodeFromPath(_node, pathToNode)
  if (err(_node1)) return _node1
  const { node: sketchExpression } = _node1

  // determine if sketchExpression is in a pipeExpression or not
  const _node2 = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  if (err(_node2)) return _node2
  const { node: pipeExpression } = _node2

  const isInPipeExpression = pipeExpression.type === 'PipeExpression'

  const _node3 = getNodeFromPath<VariableDeclarator>(
    _node,
    pathToNode,
    'VariableDeclarator'
  )
  if (err(_node3)) return _node3
  const { node: variableDeclarator, shallowPath: pathToDecleration } = _node3

  const revolveCall = createCallExpressionStdLib('revolve', [
    createObjectExpression({
      angle: angle,
      // TODO: hard coded 'X' axis for revolve MVP, should be changed.
      axis: createLiteral('X'),
    }),
    createIdentifier(variableDeclarator.id.name),
  ])

  if (shouldPipe) {
    const pipeChain = createPipeExpression(
      isInPipeExpression
        ? [...pipeExpression.body, revolveCall]
        : [sketchExpression as any, revolveCall]
    )

    variableDeclarator.init = pipeChain
    const pathToRevolveArg: PathToNode = [
      ...pathToDecleration,
      ['init', 'VariableDeclarator'],
      ['body', ''],
      [pipeChain.body.length - 1, 'index'],
      ['arguments', 'CallExpression'],
      [0, 'index'],
    ]

    return {
      modifiedAst: _node,
      pathToNode,
      pathToRevolveArg,
    }
  }

  // We're not creating a pipe expression,
  // but rather a separate constant for the extrusion
  const name = findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.REVOLVE)
  const VariableDeclaration = createVariableDeclaration(name, revolveCall)
  const sketchIndexInPathToNode =
    pathToDecleration.findIndex((a) => a[0] === 'body') + 1
  const sketchIndexInBody = pathToDecleration[sketchIndexInPathToNode][0]
  if (typeof sketchIndexInBody !== 'number')
    return new Error('expected sketchIndexInBody to be a number')
  _node.body.splice(sketchIndexInBody + 1, 0, VariableDeclaration)

  const pathToRevolveArg: PathToNode = [
    ['body', ''],
    [sketchIndexInBody + 1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpression'],
    [0, 'index'],
  ]
  return {
    modifiedAst: _node,
    pathToNode: [...pathToNode.slice(0, -1), [-1, 'index']],
    pathToRevolveArg,
  }
}

export function sketchOnExtrudedFace(
  node: Node<Program>,
  sketchPathToNode: PathToNode,
  extrudePathToNode: PathToNode,
  info: ExtrudeFacePlane['faceInfo'] = { type: 'wall' }
): { modifiedAst: Program; pathToNode: PathToNode } | Error {
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
  const _node2 = getNodeFromPath<CallExpression | CallExpressionKw>(
    _node,
    sketchPathToNode,
    ['CallExpression', 'CallExpressionKw']
  )
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
      expression.callee.name,
      info.type === 'edgeCut' ? info : null
    )
    if (err(__tag)) return __tag
    const { modifiedAst, tag } = __tag
    _tag = createIdentifier(tag)
    _node = modifiedAst
  } else {
    _tag = createLiteral(info.subType.toUpperCase())
  }
  const newSketch = createVariableDeclaration(
    newSketchName,
    createCallExpressionStdLib('startSketchOn', [
      createIdentifier(extrudeName ? extrudeName : oldSketchName),
      _tag,
    ]),
    undefined,
    'const'
  )

  const expressionIndex = Math.max(
    sketchPathToNode[1][0] as number,
    extrudePathToNode[1][0] as number
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
 * Append a helix to the AST
 */
export function addHelix({
  node,
  revolutions,
  angleStart,
  counterClockWise,
  radius,
  axis,
  length,
  insertIndex,
  variableName,
}: {
  node: Node<Program>
  revolutions: Expr
  angleStart: Expr
  counterClockWise: boolean
  radius: Expr
  axis: string
  length: Expr
  insertIndex?: number
  variableName?: string
}): { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(node)
  const name =
    variableName ?? findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.HELIX)
  const variable = createVariableDeclaration(
    name,
    createCallExpressionStdLibKw(
      'helix',
      null, // Not in a pipeline
      [
        createLabeledArg('revolutions', revolutions),
        createLabeledArg('angleStart', angleStart),
        createLabeledArg('counterClockWise', createLiteral(counterClockWise)),
        createLabeledArg('radius', radius),
        createLabeledArg('axis', createLiteral(axis)),
        createLabeledArg('length', length),
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
    createCallExpressionStdLib('startSketchOn', [
      createIdentifier(offsetPlaneName),
    ]),
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
 * Note: This depends on WASM, but it's not async.  Callers are responsible for
 * awaiting init of the WASM module.
 */
export function createLiteral(value: LiteralValue | number): Node<Literal> {
  if (typeof value === 'number') {
    value = { value, suffix: 'None' }
  }
  let raw: string
  if (typeof value === 'string') {
    // TODO: Should we handle escape sequences?
    raw = `${value}`
  } else if (typeof value === 'boolean') {
    raw = `${value}`
  } else if (typeof value.value === 'number' && value.suffix === 'None') {
    // Fast path for numbers when there are no units.
    raw = `${value.value}`
  } else {
    raw = formatNumber(value.value, value.suffix)
  }
  return {
    type: 'Literal',
    start: 0,
    end: 0,
    moduleId: 0,
    value,
    raw,
    outerAttrs: [],
  }
}

export function createTagDeclarator(value: string): Node<TagDeclarator> {
  return {
    type: 'TagDeclarator',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],

    value,
  }
}

export function createIdentifier(name: string): Node<Identifier> {
  return {
    type: 'Identifier',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],

    name,
  }
}

export function createPipeSubstitution(): Node<PipeSubstitution> {
  return {
    type: 'PipeSubstitution',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
  }
}

export function createCallExpressionStdLib(
  name: string,
  args: CallExpression['arguments']
): Node<CallExpression> {
  return {
    type: 'CallExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    callee: {
      type: 'Identifier',
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],

      name,
    },
    arguments: args,
  }
}

export function createCallExpressionStdLibKw(
  name: string,
  unlabeled: CallExpressionKw['unlabeled'],
  args: CallExpressionKw['arguments']
): Node<CallExpressionKw> {
  console.error(
    'ADAM: Creating call expression',
    name,
    args.map((a) => a.label.name)
  )
  return {
    type: 'CallExpressionKw',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    nonCodeMeta: nonCodeMetaEmpty(),
    callee: {
      type: 'Identifier',
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],

      name,
    },
    unlabeled,
    arguments: args,
  }
}

export function createCallExpression(
  name: string,
  args: CallExpression['arguments']
): Node<CallExpression> {
  return {
    type: 'CallExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    callee: {
      type: 'Identifier',
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],

      name,
    },
    arguments: args,
  }
}

export function createArrayExpression(
  elements: ArrayExpression['elements']
): Node<ArrayExpression> {
  return {
    type: 'ArrayExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],

    nonCodeMeta: nonCodeMetaEmpty(),
    elements,
  }
}

export function createPipeExpression(
  body: PipeExpression['body']
): Node<PipeExpression> {
  return {
    type: 'PipeExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],

    body,
    nonCodeMeta: nonCodeMetaEmpty(),
  }
}

export function createVariableDeclaration(
  varName: string,
  init: VariableDeclarator['init'],
  visibility: VariableDeclaration['visibility'] = 'default',
  kind: VariableDeclaration['kind'] = 'const'
): Node<VariableDeclaration> {
  return {
    type: 'VariableDeclaration',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],

    declaration: {
      type: 'VariableDeclarator',
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],

      id: createIdentifier(varName),
      init,
    },
    visibility,
    kind,
  }
}

export function createObjectExpression(properties: {
  [key: string]: Expr
}): Node<ObjectExpression> {
  return {
    type: 'ObjectExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],

    nonCodeMeta: nonCodeMetaEmpty(),
    properties: Object.entries(properties).map(([key, value]) => ({
      type: 'ObjectProperty',
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      key: createIdentifier(key),

      value,
    })),
  }
}

export function createUnaryExpression(
  argument: UnaryExpression['argument'],
  operator: UnaryExpression['operator'] = '-'
): Node<UnaryExpression> {
  return {
    type: 'UnaryExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],

    operator,
    argument,
  }
}

export function createBinaryExpression([left, operator, right]: [
  BinaryExpression['left'],
  BinaryExpression['operator'],
  BinaryExpression['right']
]): Node<BinaryExpression> {
  return {
    type: 'BinaryExpression',
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],

    operator,
    left,
    right,
  }
}

export function createBinaryExpressionWithUnary([left, right]: [
  BinaryExpression['left'],
  BinaryExpression['right']
]): Node<BinaryExpression> {
  if (right.type === 'UnaryExpression' && right.operator === '-')
    return createBinaryExpression([left, '-', right.argument])
  return createBinaryExpression([left, '+', right])
}

export function giveSketchFnCallTag(
  ast: Node<Program>,
  range: SourceRange,
  tag?: string
):
  | {
      modifiedAst: Node<Program>
      tag: string
      isTagExisting: boolean
      pathToNode: PathToNode
    }
  | Error {
  const path = getNodePathFromSourceRange(ast, range)
  const maybeTag = (() => {
    const callNode = getNodeFromPath<CallExpression | CallExpressionKw>(
      ast,
      path,
      ['CallExpression', 'CallExpressionKw']
    )
    if (!err(callNode) && callNode.node.type === 'CallExpressionKw') {
      const { node: primaryCallExp } = callNode
      const existingTag = findKwArg(ARG_TAG, primaryCallExp)
      const tagDeclarator =
        existingTag || createTagDeclarator(tag || findUniqueName(ast, 'seg', 2))
      const isTagExisting = !!existingTag
      if (!isTagExisting) {
        callNode.node.arguments.push(createLabeledArg(ARG_TAG, tagDeclarator))
      }
      return { tagDeclarator, isTagExisting }
    }

    // We've handled CallExpressionKw above, so this has to be positional.
    const _node1 = getNodeFromPath<CallExpression>(ast, path, 'CallExpression')
    if (err(_node1)) return _node1
    const { node: primaryCallExp } = _node1

    // Tag is always 3rd expression now, using arg index feels brittle
    // but we can come up with a better way to identify tag later.
    const thirdArg = primaryCallExp.arguments?.[2]
    const tagDeclarator =
      thirdArg ||
      (createTagDeclarator(
        tag || findUniqueName(ast, 'seg', 2)
      ) as TagDeclarator)
    const isTagExisting = !!thirdArg
    if (!isTagExisting) {
      primaryCallExp.arguments[2] = tagDeclarator
    }
    return { tagDeclarator, isTagExisting }
  })()

  if (err(maybeTag)) return maybeTag
  const { tagDeclarator, isTagExisting } = maybeTag
  if ('value' in tagDeclarator) {
    // Now TypeScript knows tagDeclarator has a value property
    return {
      modifiedAst: ast,
      tag: String(tagDeclarator.value),
      isTagExisting,
      pathToNode: path,
    }
  } else {
    return new Error('Unable to assign tag without value')
  }
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

  if (!isSafe || value.type === 'Identifier') {
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
  modifiedAst: Program
  pathToReplacedNode?: PathToNode
} {
  const meta = isNodeSafeToReplacePath(ast, pathToNode)
  if (trap(meta)) return { modifiedAst: ast }
  const { isSafe, value, replacer } = meta

  if (!isSafe || value.type === 'Identifier') return { modifiedAst: ast }

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
  if (!isSafe || value.type === 'Identifier') return { modifiedAst: ast }

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

    const callExp = getNodeFromPath<Node<CallExpression | CallExpressionKw>>(
      _modifiedAst,
      path,
      ['CallExpression', 'CallExpressionKw'],
      true
    )
    if (err(callExp)) return callExp

    const constraintInfo =
      callExp.node.type === 'CallExpression'
        ? getConstraintInfo(callExp.node, code, path).find(({ sourceRange }) =>
            isOverlap(sourceRange, range)
          )
        : getConstraintInfoKw(callExp.node, code, path).find(
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

export async function deleteFromSelection(
  ast: Node<Program>,
  selection: Selection,
  variables: VariableMap,
  artifactGraph: ArtifactGraph,
  getFaceDetails: (id: string) => Promise<Models['FaceIsPlanar_type']> = () =>
    ({} as any)
): Promise<Node<Program> | Error> {
  const astClone = structuredClone(ast)
  let deletionArtifact = selection.artifact

  // Coerce sketch artifacts to their plane first
  if (selection.artifact?.type === 'startSketchOnPlane') {
    const planeArtifact = getArtifactOfTypes(
      { key: selection.artifact.planeId, types: ['plane'] },
      artifactGraph
    )
    if (!err(planeArtifact)) {
      deletionArtifact = planeArtifact
    }
  } else if (selection.artifact?.type === 'startSketchOnFace') {
    const planeArtifact = getArtifactOfTypes(
      { key: selection.artifact.faceId, types: ['plane'] },
      artifactGraph
    )
    if (!err(planeArtifact)) {
      deletionArtifact = planeArtifact
    }
  }

  if (
    (deletionArtifact?.type === 'plane' ||
      deletionArtifact?.type === 'cap' ||
      deletionArtifact?.type === 'wall') &&
    deletionArtifact?.pathIds?.length
  ) {
    const plane =
      deletionArtifact.type === 'plane'
        ? expandPlane(deletionArtifact, artifactGraph)
        : deletionArtifact.type === 'wall'
        ? expandWall(deletionArtifact, artifactGraph)
        : expandCap(deletionArtifact, artifactGraph)
    for (const path of plane.paths.sort(
      (a, b) => b.codeRef.range?.[0] - a.codeRef.range?.[0]
    )) {
      const varDec = getNodeFromPath<VariableDeclarator>(
        ast,
        path.codeRef.pathToNode,
        'VariableDeclarator'
      )
      if (err(varDec)) return varDec
      const bodyIndex = Number(varDec.shallowPath[1][0])
      astClone.body.splice(bodyIndex, 1)
    }
    // If it's a cap, we're not going to continue and try to
    // delete the extrusion
    if (deletionArtifact.type === 'cap' || deletionArtifact.type === 'wall') {
      // Delete the sketch node, which would not work if
      // we continued down the traditional code path below.
      // faceCodeRef's pathToNode is empty for some reason
      // so using source range instead
      const codeRef = getFaceCodeRef(deletionArtifact)
      if (!codeRef) return new Error('Could not find face code ref')
      const sketchVarDec = getNodePathFromSourceRange(astClone, codeRef.range)
      const sketchBodyIndex = Number(sketchVarDec[1][0])
      astClone.body.splice(sketchBodyIndex, 1)
      return astClone
    }

    // If we coerced the artifact from a sketch to a plane,
    // this is where we hop off after we delete the sketch variable declaration
    if (
      selection.artifact?.type === 'startSketchOnPlane' ||
      selection.artifact?.type === 'startSketchOnFace'
    ) {
      const sketchVarDec = getNodePathFromSourceRange(
        astClone,
        selection.artifact.codeRef.range
      )
      const sketchBodyIndex = Number(sketchVarDec[1][0])
      astClone.body.splice(sketchBodyIndex, 1)
      return astClone
    }
  }

  // Below is all AST-based deletion logic
  const varDec = getNodeFromPath<VariableDeclarator>(
    ast,
    selection?.codeRef?.pathToNode,
    'VariableDeclarator'
  )
  if (err(varDec)) return varDec
  if (
    ((selection?.artifact?.type === 'wall' ||
      selection?.artifact?.type === 'cap') &&
      varDec.node.init.type === 'PipeExpression') ||
    selection.artifact?.type === 'sweep' ||
    selection.artifact?.type === 'plane' ||
    selection.artifact?.type === 'helix' ||
    !selection.artifact // aka expected to be a shell at this point
  ) {
    let extrudeNameToDelete = ''
    let pathToNode: PathToNode | null = null
    if (
      selection.artifact &&
      selection.artifact.type !== 'sweep' &&
      selection.artifact.type !== 'plane' &&
      selection.artifact.type !== 'helix'
    ) {
      const varDecName = varDec.node.id.name
      traverse(astClone, {
        enter: (node, path) => {
          if (node.type === 'VariableDeclaration') {
            const dec = node.declaration
            if (
              (dec.init.type === 'CallExpression' &&
                (dec.init.callee.name === 'extrude' ||
                  dec.init.callee.name === 'revolve') &&
                dec.init.arguments?.[1].type === 'Identifier' &&
                dec.init.arguments?.[1].name === varDecName) ||
              (dec.init.type === 'CallExpressionKw' &&
                (dec.init.callee.name === 'extrude' ||
                  dec.init.callee.name === 'revolve') &&
                dec.init.unlabeled?.type === 'Identifier' &&
                dec.init.unlabeled?.name === varDecName)
            ) {
              pathToNode = path
              extrudeNameToDelete = dec.id.name
            }
            if (
              dec.init.type === 'CallExpression' &&
              dec.init.callee.name === 'loft' &&
              dec.init.arguments?.[0].type === 'ArrayExpression' &&
              dec.init.arguments?.[0].elements.some(
                (a) => a.type === 'Identifier' && a.name === varDecName
              )
            ) {
              pathToNode = path
              extrudeNameToDelete = dec.id.name
            }
          }
        },
      })
      if (!pathToNode) return new Error('Could not find extrude variable')
    } else {
      pathToNode = selection.codeRef.pathToNode
      if (varDec.node.type !== 'VariableDeclarator') {
        const callExp = getNodeFromPath<CallExpression>(
          astClone,
          pathToNode,
          'CallExpression'
        )
        if (err(callExp)) return callExp
        extrudeNameToDelete = callExp.node.callee.name
      } else {
        extrudeNameToDelete = varDec.node.id.name
      }
    }

    const expressionIndex = pathToNode[1][0] as number
    astClone.body.splice(expressionIndex, 1)
    if (extrudeNameToDelete) {
      await new Promise((resolve) => {
        ;(async () => {
          const pathsDependingOnExtrude: Array<{
            path: PathToNode
            variable: KclValue
          }> = []
          const roundLiteral = (x: number) => createLiteral(roundOff(x))
          const modificationDetails: {
            parentPipe: PipeExpression['body']
            parentInit: VariableDeclarator
            faceDetails: Models['FaceIsPlanar_type']
            lastKey: number | string
          }[] = []
          const wallArtifact =
            selection.artifact?.type === 'wall'
              ? selection.artifact
              : selection.artifact?.type === 'segment' &&
                selection.artifact.surfaceId
              ? getArtifactOfTypes(
                  { key: selection.artifact.surfaceId, types: ['wall'] },
                  artifactGraph
                )
              : null
          if (err(wallArtifact)) return
          if (wallArtifact) {
            const sweep = getArtifactOfTypes(
              { key: wallArtifact.sweepId, types: ['sweep'] },
              artifactGraph
            )
            if (err(sweep)) return
            const wallsWithDependencies = Array.from(
              getArtifactsOfTypes(
                { keys: sweep.surfaceIds, types: ['wall', 'cap'] },
                artifactGraph
              ).values()
            ).filter((wall) => wall?.pathIds?.length)
            const wallIds = wallsWithDependencies.map((wall) => wall.id)
            Object.entries(variables).forEach(([key, _var]) => {
              if (
                _var?.type === 'Face' &&
                wallIds.includes(_var.value.artifactId)
              ) {
                const pathToStartSketchOn = getNodePathFromSourceRange(
                  astClone,
                  _var.value.__meta[0].sourceRange
                )
                pathsDependingOnExtrude.push({
                  path: pathToStartSketchOn,
                  variable: _var,
                })
              }
              if (
                _var?.type === 'Sketch' &&
                _var.value.on.type === 'face' &&
                wallIds.includes(_var.value.on.artifactId)
              ) {
                const pathToStartSketchOn = getNodePathFromSourceRange(
                  astClone,
                  _var.value.on.__meta[0].sourceRange
                )
                pathsDependingOnExtrude.push({
                  path: pathToStartSketchOn,
                  variable: {
                    type: 'Face',
                    value: _var.value.on,
                  },
                })
              }
            })
          }
          for (const { path, variable } of pathsDependingOnExtrude) {
            // `parentPipe` and `parentInit` are the exact same node, but because it could either be an array or on object node
            // putting them in two different variables was the only way to get TypeScript to stop complaining
            // the reason why we're grabbing the parent and the last key is because we want to mutate the ast
            // so `parent[lastKey]` does the trick, if there's a better way of doing this I'm all years
            const parentPipe = getNodeFromPath<PipeExpression['body']>(
              astClone,
              path.slice(0, -1)
            )
            const parentInit = getNodeFromPath<VariableDeclarator>(
              astClone,
              path.slice(0, -1)
            )
            if (err(parentPipe) || err(parentInit)) {
              return
            }
            if (!variable) return new Error('Could not find sketch')
            const artifactId =
              variable.type === 'Sketch'
                ? variable.value.artifactId
                : variable.type === 'Face'
                ? variable.value.artifactId
                : ''
            if (!artifactId) return new Error('Sketch not on anything')
            const onId =
              variable.type === 'Sketch'
                ? variable.value.on.id
                : variable.type === 'Face'
                ? variable.value.id
                : ''
            if (!onId) return new Error('Sketch not on anything')
            // Can't kick off multiple requests at once as getFaceDetails
            // is three engine calls in one and they conflict
            const faceDetails = await getFaceDetails(onId)
            if (
              !(
                faceDetails.origin &&
                faceDetails.x_axis &&
                faceDetails.y_axis &&
                faceDetails.z_axis
              )
            ) {
              return
            }
            const lastKey = path.slice(-1)[0][0]
            modificationDetails.push({
              parentPipe: parentPipe.node,
              parentInit: parentInit.node,
              faceDetails,
              lastKey,
            })
          }
          for (const {
            parentInit,
            parentPipe,
            faceDetails,
            lastKey,
          } of modificationDetails) {
            if (
              !(
                faceDetails.origin &&
                faceDetails.x_axis &&
                faceDetails.y_axis &&
                faceDetails.z_axis
              )
            ) {
              continue
            }
            const expression = createCallExpressionStdLib('startSketchOn', [
              createObjectExpression({
                plane: createObjectExpression({
                  origin: createObjectExpression({
                    x: roundLiteral(faceDetails.origin.x),
                    y: roundLiteral(faceDetails.origin.y),
                    z: roundLiteral(faceDetails.origin.z),
                  }),
                  xAxis: createObjectExpression({
                    x: roundLiteral(faceDetails.x_axis.x),
                    y: roundLiteral(faceDetails.x_axis.y),
                    z: roundLiteral(faceDetails.x_axis.z),
                  }),
                  yAxis: createObjectExpression({
                    x: roundLiteral(faceDetails.y_axis.x),
                    y: roundLiteral(faceDetails.y_axis.y),
                    z: roundLiteral(faceDetails.y_axis.z),
                  }),
                  zAxis: createObjectExpression({
                    x: roundLiteral(faceDetails.z_axis.x),
                    y: roundLiteral(faceDetails.z_axis.y),
                    z: roundLiteral(faceDetails.z_axis.z),
                  }),
                }),
              }),
            ])
            if (
              parentInit.type === 'VariableDeclarator' &&
              lastKey === 'init'
            ) {
              parentInit[lastKey] = expression
            } else if (isArray(parentPipe) && typeof lastKey === 'number') {
              parentPipe[lastKey] = expression
            }
          }
          resolve(true)
        })().catch(reportRejection)
      })
    }
    // await prom
    return astClone
  } else if (selection.artifact?.type === 'edgeCut') {
    return deleteEdgeTreatment(astClone, selection)
  } else if (varDec.node.init.type === 'PipeExpression') {
    const pipeBody = varDec.node.init.body
    const doNotDeleteProfileIfItHasBeenExtruded = !(
      selection?.artifact?.type === 'segment' && selection?.artifact?.surfaceId
    )
    if (
      pipeBody[0].type === 'CallExpression' &&
      doNotDeleteProfileIfItHasBeenExtruded &&
      (pipeBody[0].callee.name === 'startSketchOn' ||
        pipeBody[0].callee.name === 'startProfileAt')
    ) {
      // remove varDec
      const varDecIndex = varDec.shallowPath[1][0] as number
      astClone.body.splice(varDecIndex, 1)
      return astClone
    }
  } else if (
    // single expression profiles
    (varDec.node.init.type === 'CallExpressionKw' ||
      varDec.node.init.type === 'CallExpression') &&
    ['circleThreePoint', 'circle'].includes(varDec.node.init.callee.name)
  ) {
    const varDecIndex = varDec.shallowPath[1][0] as number
    astClone.body.splice(varDecIndex, 1)
    return astClone
  }

  return new Error('Selection not recognised, could not delete')
}

export const nonCodeMetaEmpty = () => {
  return { nonCodeNodes: {}, startNodes: [], start: 0, end: 0 }
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
 * part001 = startSketchOn('XZ')
  |> startProfileAt([1, 2], %)
  |> line([3, 4], %)
  |> line([5, 6], %)
  |> close(%)
extrude001 = extrude(5, part001)
```
into
```ts
sketch001 = startSketchOn('XZ')
part001 = startProfileAt([1, 2], sketch001)
  |> line([3, 4], %)
  |> line([5, 6], %)
  |> close(%)
extrude001 = extrude(5, part001)
```
Notice that the `startSketchOn` is what gets the new variable name, this is so part001 still has the same data as before
making it safe for later code that uses part001 (the extrude in this example)
 * 
 */
export function splitPipedProfile(
  ast: Program,
  pathToPipe: PathToNode
):
  | {
      modifiedAst: Program
      pathToProfile: PathToNode
      pathToPlane: PathToNode
    }
  | Error {
  const _ast = structuredClone(ast)
  const varDec = getNodeFromPath<VariableDeclaration>(
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
  if (!isCallExprWithName(secondCall, 'startProfileAt'))
    return new Error('Second call is not startProfileAt')

  const varName = varDec.node.declaration.id.name
  const newVarName = findUniqueName(_ast, 'sketch')
  const secondCallArgs = structuredClone(secondCall.arguments)
  secondCallArgs[1] = createIdentifier(newVarName)
  const firstCallOfNewPipe = createCallExpression(
    'startProfileAt',
    secondCallArgs
  )
  const newSketch = createVariableDeclaration(
    newVarName,
    varDec.node.declaration.init.body[0]
  )
  const newProfile = createVariableDeclaration(
    varName,
    varDec.node.declaration.init.body.length <= 2
      ? firstCallOfNewPipe
      : createPipeExpression([
          firstCallOfNewPipe,
          ...varDec.node.declaration.init.body.slice(2),
        ])
  )
  const index = getBodyIndex(pathToPipe)
  if (err(index)) return index
  _ast.body.splice(index, 1, newSketch, newProfile)
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

export const createLabeledArg = (label: string, arg: Expr): LabeledArg => {
  return { label: createIdentifier(label), arg, type: 'LabeledArg' }
}
