import { err, reportRejection, trap } from 'lib/trap'
import { Selection, Selections } from 'lib/selections'
import {
  Program,
  CallExpression,
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
  ProgramMemory,
  SourceRange,
  sketchFromKclValue,
  isPathToNodeNumber,
} from './wasm'
import {
  isNodeSafeToReplacePath,
  findAllPreviousVariables,
  findAllPreviousVariablesPath,
  getNodeFromPath,
  getNodePathFromSourceRange,
  isNodeSafeToReplace,
  traverse,
} from './queryAst'
import { addTagForSketchOnFace, getConstraintInfo } from './std/sketch'
import {
  PathToNodeMap,
  isLiteralArrayOrStatic,
  removeSingleConstraint,
  transformAstSketchLines,
} from './std/sketchcombos'
import { DefaultPlaneStr } from 'clientSideScene/sceneEntities'
import { isOverlap, roundOff } from 'lib/utils'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from 'lib/constants'
import { SimplifiedArgDetails } from './std/stdTypes'
import { TagDeclarator } from 'wasm-lib/kcl/bindings/TagDeclarator'
import { Models } from '@kittycad/lib'
import { ExtrudeFacePlane } from 'machines/modelingMachine'
import { Node } from 'wasm-lib/kcl/bindings/Node'
import { mutateAstWithTagForSketchSegment } from './modifyAst/addFillet'
import { locateDeclarator } from './modifyAst/utils'

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
    ['declarations', 'VariableDeclaration'],
    ['0', 'index'],
    ['init', 'VariableDeclarator'],
  ]

  return {
    modifiedAst: _node,
    id: _name,
    pathToNode,
  }
}

export function addStartProfileAt(
  node: Node<Program>,
  pathToNode: PathToNode,
  at: [number, number]
): { modifiedAst: Node<Program>; pathToNode: PathToNode } | Error {
  const _node1 = getNodeFromPath<VariableDeclaration>(
    node,
    pathToNode,
    'VariableDeclaration'
  )
  if (err(_node1)) return _node1
  const variableDeclaration = _node1.node
  if (variableDeclaration.type !== 'VariableDeclaration') {
    return new Error('variableDeclaration.init.type !== PipeExpression')
  }
  const _node = { ...node }
  const init = variableDeclaration.declarations[0].init
  const startProfileAt = createCallExpressionStdLib('startProfileAt', [
    createArrayExpression([
      createLiteral(roundOff(at[0])),
      createLiteral(roundOff(at[1])),
    ]),
    createPipeSubstitution(),
  ])
  if (init.type === 'PipeExpression') {
    init.body.splice(1, 0, startProfileAt)
  } else {
    variableDeclaration.declarations[0].init = createPipeExpression([
      init,
      startProfileAt,
    ])
  }
  return {
    modifiedAst: _node,
    pathToNode,
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
  const initialLineTo = createCallExpressionStdLib('line', [
    createLiteral('default'),
    createPipeSubstitution(),
  ])

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
    ['declarations', 'VariableDeclaration'],
    ['0', 'index'],
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
      })
    }
  }
  return false
}

export function extrudeSketch(
  node: Node<Program>,
  pathToNode: PathToNode,
  shouldPipe = false,
  distance: Expr = createLiteral(4)
):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
      pathToExtrudeArg: PathToNode
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

  const extrudeCall = createCallExpressionStdLib('extrude', [
    distance,
    shouldPipe
      ? createPipeSubstitution()
      : createIdentifier(variableDeclarator.id.name),
  ])

  if (shouldPipe) {
    const pipeChain = createPipeExpression(
      isInPipeExpression
        ? [...pipeExpression.body, extrudeCall]
        : [sketchExpression as any, extrudeCall]
    )

    variableDeclarator.init = pipeChain
    const pathToExtrudeArg: PathToNode = [
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
      pathToExtrudeArg,
    }
  }

  // We're not creating a pipe expression,
  // but rather a separate constant for the extrusion
  const name = findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.EXTRUDE)
  const VariableDeclaration = createVariableDeclaration(name, extrudeCall)

  const sketchIndexInPathToNode =
    pathToDecleration.findIndex((a) => a[0] === 'body') + 1
  const sketchIndexInBody = pathToDecleration[
    sketchIndexInPathToNode
  ][0] as number
  _node.body.splice(sketchIndexInBody + 1, 0, VariableDeclaration)

  const pathToExtrudeArg: PathToNode = [
    ['body', ''],
    [sketchIndexInBody + 1, 'index'],
    ['declarations', 'VariableDeclaration'],
    [0, 'index'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpression'],
    [0, 'index'],
  ]
  return {
    modifiedAst: _node,
    pathToNode: [...pathToNode.slice(0, -1), [-1, 'index']],
    pathToExtrudeArg,
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
  const _node2 = getNodeFromPath<CallExpression>(
    _node,
    sketchPathToNode,
    'CallExpression'
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
    ['declarations', 'VariableDeclaration'],
    [0, 'index'],
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
  offset,
}: {
  node: Node<Program>
  defaultPlane: DefaultPlaneStr
  offset: Expr
}): { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  const modifiedAst = structuredClone(node)
  const newPlaneName = findUniqueName(node, KCL_DEFAULT_CONSTANT_PREFIXES.PLANE)

  const newPlane = createVariableDeclaration(
    newPlaneName,
    createCallExpressionStdLib('offsetPlane', [
      createLiteral(defaultPlane.toUpperCase()),
      offset,
    ])
  )

  modifiedAst.body.push(newPlane)
  const pathToNode: PathToNode = [
    ['body', ''],
    [modifiedAst.body.length - 1, 'index'],
    ['declarations', 'VariableDeclaration'],
    ['0', 'index'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpression'],
    [0, 'index'],
  ]
  return {
    modifiedAst,
    pathToNode,
  }
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

export function createLiteral(value: LiteralValue): Node<Literal> {
  return {
    type: 'Literal',
    start: 0,
    end: 0,
    moduleId: 0,
    value,
    raw: `${value}`,
  }
}

export function createTagDeclarator(value: string): Node<TagDeclarator> {
  return {
    type: 'TagDeclarator',
    start: 0,
    end: 0,
    moduleId: 0,

    value,
  }
}

export function createIdentifier(name: string): Node<Identifier> {
  return {
    type: 'Identifier',
    start: 0,
    end: 0,
    moduleId: 0,

    name,
  }
}

export function createPipeSubstitution(): Node<PipeSubstitution> {
  return {
    type: 'PipeSubstitution',
    start: 0,
    end: 0,
    moduleId: 0,
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
    callee: {
      type: 'Identifier',
      start: 0,
      end: 0,
      moduleId: 0,

      name,
    },
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
    callee: {
      type: 'Identifier',
      start: 0,
      end: 0,
      moduleId: 0,

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

    declarations: [
      {
        type: 'VariableDeclarator',
        start: 0,
        end: 0,
        moduleId: 0,

        id: createIdentifier(varName),
        init,
      },
    ],
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

    nonCodeMeta: nonCodeMetaEmpty(),
    properties: Object.entries(properties).map(([key, value]) => ({
      type: 'ObjectProperty',
      start: 0,
      end: 0,
      moduleId: 0,
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

    operator,
    argument,
  }
}

export function createBinaryExpression([left, operator, right]: [
  BinaryExpression['left'],
  BinaryExpression['operator'],
  BinaryExpression['right'],
]): Node<BinaryExpression> {
  return {
    type: 'BinaryExpression',
    start: 0,
    end: 0,
    moduleId: 0,

    operator,
    left,
    right,
  }
}

export function createBinaryExpressionWithUnary([left, right]: [
  BinaryExpression['left'],
  BinaryExpression['right'],
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
  const _node1 = getNodeFromPath<CallExpression>(ast, path, 'CallExpression')
  if (err(_node1)) return _node1
  const { node: primaryCallExp } = _node1

  // Tag is always 3rd expression now, using arg index feels brittle
  // but we can come up with a better way to identify tag later.
  const thirdArg = primaryCallExp.arguments?.[2]
  const tagDeclarator =
    thirdArg ||
    (createTagDeclarator(tag || findUniqueName(ast, 'seg', 2)) as TagDeclarator)
  const isTagExisting = !!thirdArg
  if (!isTagExisting) {
    primaryCallExp.arguments[2] = tagDeclarator
  }
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

export function moveValueIntoNewVariablePath(
  ast: Node<Program>,
  programMemory: ProgramMemory,
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

  const { insertIndex } = findAllPreviousVariablesPath(
    ast,
    programMemory,
    pathToNode
  )
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
  programMemory: ProgramMemory,
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

  const { insertIndex } = findAllPreviousVariables(
    ast,
    programMemory,
    sourceRange
  )
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
  programMemory: ProgramMemory,
  code: string,
  pathToNode: PathToNode
): Node<Program> | Error {
  let _modifiedAst = structuredClone(modifiedAst)

  dependentRanges.forEach((range) => {
    const path = getNodePathFromSourceRange(_modifiedAst, range)

    const callExp = getNodeFromPath<Node<CallExpression>>(
      _modifiedAst,
      path,
      'CallExpression',
      true
    )
    if (err(callExp)) return callExp

    const constraintInfo = getConstraintInfo(callExp.node, code, path).find(
      ({ sourceRange }) => isOverlap(sourceRange, range)
    )
    if (!constraintInfo) return

    if (!constraintInfo.argPosition) return
    const transform = removeSingleConstraintInfo(
      callExp.shallowPath,
      constraintInfo.argPosition,
      _modifiedAst,
      programMemory
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
  programMemory: ProgramMemory
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
    programMemory,
    referenceSegName: '',
  })
  if (err(retval)) return false
  return retval
}

export async function deleteFromSelection(
  ast: Node<Program>,
  selection: Selection,
  programMemory: ProgramMemory,
  getFaceDetails: (id: string) => Promise<Models['FaceIsPlanar_type']> = () =>
    ({}) as any
): Promise<Node<Program> | Error> {
  const astClone = structuredClone(ast)
  const varDec = getNodeFromPath<VariableDeclarator>(
    ast,
    selection?.codeRef?.pathToNode,
    'VariableDeclarator'
  )
  if (err(varDec)) return varDec
  if (
    (selection?.artifact?.type === 'wall' ||
      selection?.artifact?.type === 'cap') &&
    varDec.node.init.type === 'PipeExpression'
  ) {
    const varDecName = varDec.node.id.name
    let pathToNode: PathToNode | null = null
    let extrudeNameToDelete = ''
    traverse(astClone, {
      enter: (node, path) => {
        if (node.type === 'VariableDeclaration') {
          const dec = node.declarations[0]
          if (
            dec.init.type === 'CallExpression' &&
            (dec.init.callee.name === 'extrude' ||
              dec.init.callee.name === 'revolve') &&
            dec.init.arguments?.[1].type === 'Identifier' &&
            dec.init.arguments?.[1].name === varDecName
          ) {
            pathToNode = path
            extrudeNameToDelete = dec.id.name
          }
        }
      },
    })
    if (!pathToNode) return new Error('Could not find extrude variable')

    const expressionIndex = pathToNode[1][0] as number
    astClone.body.splice(expressionIndex, 1)
    if (extrudeNameToDelete) {
      await new Promise((resolve) => {
        ;(async () => {
          let currentVariableName = ''
          const pathsDependingOnExtrude: Array<{
            path: PathToNode
            sketchName: string
          }> = []
          traverse(astClone, {
            leave: (node) => {
              if (node.type === 'VariableDeclaration') {
                currentVariableName = ''
              }
            },
            enter: (node, path) => {
              ;(async () => {
                if (node.type === 'VariableDeclaration') {
                  currentVariableName = node.declarations[0].id.name
                }
                if (
                  // match startSketchOn(${extrudeNameToDelete})
                  node.type === 'CallExpression' &&
                  node.callee.name === 'startSketchOn' &&
                  node.arguments[0].type === 'Identifier' &&
                  node.arguments[0].name === extrudeNameToDelete
                ) {
                  pathsDependingOnExtrude.push({
                    path,
                    sketchName: currentVariableName,
                  })
                }
              })().catch(reportRejection)
            },
          })
          const roundLiteral = (x: number) => createLiteral(roundOff(x))
          const modificationDetails: {
            parent: PipeExpression['body']
            faceDetails: Models['FaceIsPlanar_type']
            lastKey: number
          }[] = []
          for (const { path, sketchName } of pathsDependingOnExtrude) {
            const parent = getNodeFromPath<PipeExpression['body']>(
              astClone,
              path.slice(0, -1)
            )
            if (err(parent)) {
              return
            }
            const sketchToPreserve = sketchFromKclValue(
              programMemory.get(sketchName),
              sketchName
            )
            if (err(sketchToPreserve)) return sketchToPreserve
            // Can't kick off multiple requests at once as getFaceDetails
            // is three engine calls in one and they conflict
            const faceDetails = await getFaceDetails(sketchToPreserve.on.id)
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
            const lastKey = Number(path.slice(-1)[0][0])
            modificationDetails.push({
              parent: parent.node,
              faceDetails,
              lastKey,
            })
          }
          for (const { parent, faceDetails, lastKey } of modificationDetails) {
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
            parent[lastKey] = createCallExpressionStdLib('startSketchOn', [
              createObjectExpression({
                plane: createObjectExpression({
                  origin: createObjectExpression({
                    x: roundLiteral(faceDetails.origin.x),
                    y: roundLiteral(faceDetails.origin.y),
                    z: roundLiteral(faceDetails.origin.z),
                  }),
                  x_axis: createObjectExpression({
                    x: roundLiteral(faceDetails.x_axis.x),
                    y: roundLiteral(faceDetails.x_axis.y),
                    z: roundLiteral(faceDetails.x_axis.z),
                  }),
                  y_axis: createObjectExpression({
                    x: roundLiteral(faceDetails.y_axis.x),
                    y: roundLiteral(faceDetails.y_axis.y),
                    z: roundLiteral(faceDetails.y_axis.z),
                  }),
                  z_axis: createObjectExpression({
                    x: roundLiteral(faceDetails.z_axis.x),
                    y: roundLiteral(faceDetails.z_axis.y),
                    z: roundLiteral(faceDetails.z_axis.z),
                  }),
                }),
              }),
            ])
          }
          resolve(true)
        })().catch(reportRejection)
      })
    }
    // await prom
    return astClone
  } else if (varDec.node.init.type === 'PipeExpression') {
    const pipeBody = varDec.node.init.body
    if (
      pipeBody[0].type === 'CallExpression' &&
      pipeBody[0].callee.name === 'startSketchOn'
    ) {
      // remove varDec
      const varDecIndex = varDec.shallowPath[1][0] as number
      astClone.body.splice(varDecIndex, 1)
      return astClone
    }
  }

  return new Error('Selection not recognised, could not delete')
}

const nonCodeMetaEmpty = () => {
  return { nonCodeNodes: {}, startNodes: [], start: 0, end: 0 }
}
