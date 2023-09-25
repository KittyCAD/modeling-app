import { Selection, ToolTip } from '../useStore'
import {
  Program,
  CallExpression,
  PipeExpression,
  VariableDeclaration,
  VariableDeclarator,
  ExpressionStatement,
  Value,
  Literal,
  PipeSubstitution,
  Identifier,
  ArrayExpression,
  ObjectExpression,
  UnaryExpression,
  BinaryExpression,
} from './abstractSyntaxTreeTypes'
import {
  findAllPreviousVariables,
  getNodeFromPath,
  getNodePathFromSourceRange,
  isNodeSafeToReplace,
} from './queryAst'
import { PathToNode, ProgramMemory } from './executor'
import {
  addTagForSketchOnFace,
  getFirstArg,
  createFirstArg,
} from './std/sketch'
import { isLiteralArrayOrStatic } from './std/sketchcombos'

export function addStartSketch(
  node: Program,
  start: [number, number],
  end: [number, number]
): { modifiedAst: Program; id: string; pathToNode: PathToNode } {
  const _node = { ...node }
  const _name = findUniqueName(node, 'part')

  const startSketchAt = createCallExpression('startSketchAt', [
    createArrayExpression([createLiteral(start[0]), createLiteral(start[1])]),
  ])
  const initialLineTo = createCallExpression('line', [
    createArrayExpression([createLiteral(end[0]), createLiteral(end[1])]),
    createPipeSubstitution(),
  ])

  const pipeBody = [startSketchAt, initialLineTo]

  const variableDeclaration = createVariableDeclaration(
    _name,
    createPipeExpression(pipeBody)
  )

  const newIndex = node.body.length
  _node.body = [...node.body, variableDeclaration]

  let pathToNode: PathToNode = [
    ['body', ''],
    [newIndex.toString(10), 'index'],
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

export function addSketchTo(
  node: Program,
  axis: 'xy' | 'xz' | 'yz',
  name = ''
): { modifiedAst: Program; id: string; pathToNode: PathToNode } {
  const _node = { ...node }
  const _name = name || findUniqueName(node, 'part')

  const startSketchAt = createCallExpressionStdLib('startSketchAt', [
    createLiteral('default'),
  ])
  const rotate = createCallExpression(axis === 'xz' ? 'rx' : 'ry', [
    createLiteral(90),
    createPipeSubstitution(),
  ])
  const initialLineTo = createCallExpressionStdLib('line', [
    createLiteral('default'),
    createPipeSubstitution(),
  ])

  const pipeBody =
    axis !== 'xy'
      ? [startSketchAt, rotate, initialLineTo]
      : [startSketchAt, initialLineTo]

  const variableDeclaration = createVariableDeclaration(
    _name,
    createPipeExpression(pipeBody)
  )

  const showCallIndex = getShowIndex(_node)
  let sketchIndex = showCallIndex
  if (showCallIndex === -1) {
    _node.body = [...node.body, variableDeclaration]
    sketchIndex = _node.body.length - 1
  } else {
    const newBody = [...node.body]
    newBody.splice(showCallIndex, 0, variableDeclaration)
    _node.body = newBody
  }
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
    modifiedAst: addToShow(_node, _name),
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
  let searchStr = ''
  if (typeof ast === 'string') {
    searchStr = ast
  } else {
    searchStr = JSON.stringify(ast)
  }
  const indexStr = `${index}`.padStart(pad, '0')
  const newName = `${name}${indexStr}`
  const isInString = searchStr.includes(newName)
  if (!isInString) {
    return newName
  }
  return findUniqueName(searchStr, name, pad, index + 1)
}

function addToShow(node: Program, name: string): Program {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const showCallIndex = getShowIndex(_node)
  if (showCallIndex === -1) {
    const showCall = createCallExpressionStdLib('show', [
      createIdentifier(name),
    ])
    const showExpressionStatement: ExpressionStatement = {
      type: 'ExpressionStatement',
      ...dumbyStartend,
      expression: showCall,
    }
    _node.body = [..._node.body, showExpressionStatement]
    return _node
  }
  const showCall = { ..._node.body[showCallIndex] } as ExpressionStatement
  const showCallArgs = (showCall.expression as CallExpression).arguments
  const newShowCallArgs: Value[] = [...showCallArgs, createIdentifier(name)]
  const newShowExpression = createCallExpressionStdLib('show', newShowCallArgs)

  _node.body[showCallIndex] = {
    ...showCall,
    expression: newShowExpression,
  }
  return _node
}

function getShowIndex(node: Program): number {
  return node.body.findIndex(
    (statement) =>
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'CallExpression' &&
      statement.expression.callee.type === 'Identifier' &&
      statement.expression.callee.name === 'show'
  )
}

export function mutateArrExp(
  node: Value,
  updateWith: ArrayExpression
): boolean {
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
  node: Value,
  updateWith: Literal | ArrayExpression,
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
      })
    }
  }
  return false
}

export function extrudeSketch(
  node: Program,
  pathToNode: PathToNode,
  shouldPipe = true
): {
  modifiedAst: Program
  pathToNode: PathToNode
  pathToExtrudeArg: PathToNode
} {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const { node: sketchExpression } = getNodeFromPath(
    _node,
    pathToNode,
    'SketchExpression' // TODO fix this #25
  )

  // determine if sketchExpression is in a pipeExpression or not
  const { node: pipeExpression } = getNodeFromPath<PipeExpression>(
    _node,
    pathToNode,
    'PipeExpression'
  )
  const isInPipeExpression = pipeExpression.type === 'PipeExpression'

  const { node: variableDeclorator, shallowPath: pathToDecleration } =
    getNodeFromPath<VariableDeclarator>(_node, pathToNode, 'VariableDeclarator')

  const extrudeCall = createCallExpressionStdLib('extrude', [
    createLiteral(4),
    shouldPipe
      ? createPipeSubstitution()
      : {
          type: 'Identifier',
          ...dumbyStartend,
          name: variableDeclorator.id.name,
        },
  ])

  if (shouldPipe) {
    const pipeChain = createPipeExpression(
      isInPipeExpression
        ? [...pipeExpression.body, extrudeCall]
        : [sketchExpression as any, extrudeCall]
    )

    variableDeclorator.init = pipeChain
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
  const name = findUniqueName(node, 'part')
  const VariableDeclaration = createVariableDeclaration(name, extrudeCall)
  let showCallIndex = getShowIndex(_node)
  if (showCallIndex == -1) {
    // We didn't find a show, so let's just append everything
    showCallIndex = _node.body.length
  }
  _node.body.splice(showCallIndex, 0, VariableDeclaration)
  const pathToExtrudeArg: PathToNode = [
    ['body', ''],
    [showCallIndex, 'index'],
    ['declarations', 'VariableDeclaration'],
    [0, 'index'],
    ['init', 'VariableDeclarator'],
    ['arguments', 'CallExpression'],
    [0, 'index'],
  ]
  return {
    modifiedAst: node,
    pathToNode: [...pathToNode.slice(0, -1), [showCallIndex, 'index']],
    pathToExtrudeArg,
  }
}

export function sketchOnExtrudedFace(
  node: Program,
  pathToNode: PathToNode,
  programMemory: ProgramMemory
): { modifiedAst: Program; pathToNode: PathToNode } {
  let _node = { ...node }
  const newSketchName = findUniqueName(node, 'part')
  const { node: oldSketchNode, shallowPath: pathToOldSketch } =
    getNodeFromPath<VariableDeclarator>(
      _node,
      pathToNode,
      'VariableDeclarator',
      true
    )
  const oldSketchName = oldSketchNode.id.name
  const { node: expression } = getNodeFromPath<CallExpression>(
    _node,
    pathToNode,
    'CallExpression'
  )

  const { modifiedAst, tag } = addTagForSketchOnFace(
    {
      previousProgramMemory: programMemory,
      pathToNode,
      node: _node,
    },
    expression.callee.name
  )
  _node = modifiedAst

  const newSketch = createVariableDeclaration(
    newSketchName,
    createPipeExpression([
      createCallExpressionStdLib('startSketchAt', [
        createArrayExpression([createLiteral(0), createLiteral(0)]),
      ]),
      createCallExpressionStdLib('lineTo', [
        createArrayExpression([createLiteral(1), createLiteral(1)]),
        createPipeSubstitution(),
      ]),
      createCallExpression('transform', [
        createCallExpressionStdLib('getExtrudeWallTransform', [
          createLiteral(tag),
          createIdentifier(oldSketchName),
        ]),
        createPipeSubstitution(),
      ]),
    ]),
    'const'
  )
  const expressionIndex = getLastIndex(pathToOldSketch)
  _node.body.splice(expressionIndex + 1, 0, newSketch)

  return {
    modifiedAst: addToShow(_node, newSketchName),
    pathToNode: [...pathToNode.slice(0, -1), [expressionIndex, 'index']],
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

export function createLiteral(value: string | number): Literal {
  return {
    type: 'Literal',
    start: 0,
    end: 0,
    value,
    raw: `${value}`,
  }
}

export function createIdentifier(name: string): Identifier {
  return {
    type: 'Identifier',
    start: 0,
    end: 0,
    name,
  }
}

export function createPipeSubstitution(): PipeSubstitution {
  return {
    type: 'PipeSubstitution',
    start: 0,
    end: 0,
  }
}

export function createCallExpressionStdLib(
  name: string,
  args: CallExpression['arguments']
): CallExpression {
  return {
    type: 'CallExpression',
    start: 0,
    end: 0,
    callee: {
      type: 'Identifier',
      start: 0,
      end: 0,
      name,
    },
    function: {
      type: 'StdLib',
      func: {
        // We only need the name here to map it back when it serializes
        // to rust, don't worry about the rest.
        name,
        summary: '',
        description: '',
        tags: [],
        returnValue: { type: '', required: false, name: '', schema: {} },
        args: [],
        unpublished: false,
        deprecated: false,
      },
    },
    optional: false,
    arguments: args,
  }
}

export function createCallExpression(
  name: string,
  args: CallExpression['arguments']
): CallExpression {
  return {
    type: 'CallExpression',
    start: 0,
    end: 0,
    callee: {
      type: 'Identifier',
      start: 0,
      end: 0,
      name,
    },
    function: {
      type: 'InMemory',
    },
    optional: false,
    arguments: args,
  }
}

export function createArrayExpression(
  elements: ArrayExpression['elements']
): ArrayExpression {
  return {
    type: 'ArrayExpression',
    start: 0,
    end: 0,
    elements,
  }
}

export function createPipeExpression(
  body: PipeExpression['body']
): PipeExpression {
  return {
    type: 'PipeExpression',
    start: 0,
    end: 0,
    body,
    nonCodeMeta: { nonCodeNodes: {}, start: null },
  }
}

export function createVariableDeclaration(
  varName: string,
  init: VariableDeclarator['init'],
  kind: VariableDeclaration['kind'] = 'const'
): VariableDeclaration {
  return {
    type: 'VariableDeclaration',
    start: 0,
    end: 0,
    declarations: [
      {
        type: 'VariableDeclarator',
        start: 0,
        end: 0,
        id: createIdentifier(varName),
        init,
      },
    ],
    kind,
  }
}

export function createObjectExpression(properties: {
  [key: string]: Value
}): ObjectExpression {
  return {
    type: 'ObjectExpression',
    start: 0,
    end: 0,
    properties: Object.entries(properties).map(([key, value]) => ({
      type: 'ObjectProperty',
      start: 0,
      end: 0,
      key: createIdentifier(key),
      value,
    })),
  }
}

export function createUnaryExpression(
  argument: UnaryExpression['argument'],
  operator: UnaryExpression['operator'] = '-'
): UnaryExpression {
  return {
    type: 'UnaryExpression',
    start: 0,
    end: 0,
    operator,
    argument,
  }
}

export function createBinaryExpression([left, operator, right]: [
  BinaryExpression['left'],
  BinaryExpression['operator'],
  BinaryExpression['right']
]): BinaryExpression {
  return {
    type: 'BinaryExpression',
    start: 0,
    end: 0,
    operator,
    left,
    right,
  }
}

export function createBinaryExpressionWithUnary([left, right]: [
  BinaryExpression['left'],
  BinaryExpression['right']
]): BinaryExpression {
  if (right.type === 'UnaryExpression' && right.operator === '-')
    return createBinaryExpression([left, '-', right.argument])
  return createBinaryExpression([left, '+', right])
}

export function giveSketchFnCallTag(
  ast: Program,
  range: Selection['range'],
  tag?: string
): {
  modifiedAst: Program
  tag: string
  isTagExisting: boolean
  pathToNode: PathToNode
} {
  const path = getNodePathFromSourceRange(ast, range)
  const { node: primaryCallExp } = getNodeFromPath<CallExpression>(
    ast,
    path,
    'CallExpression'
  )
  const firstArg = getFirstArg(primaryCallExp)
  const isTagExisting = !!firstArg.tag
  const tagValue = (firstArg.tag ||
    createLiteral(tag || findUniqueName(ast, 'seg', 2))) as Literal
  const tagStr = String(tagValue.value)
  const newFirstArg = createFirstArg(
    primaryCallExp.callee.name as ToolTip,
    firstArg.val,
    tagValue
  )
  primaryCallExp.arguments[0] = newFirstArg
  return {
    modifiedAst: ast,
    tag: tagStr,
    isTagExisting,
    pathToNode: path,
  }
}

export function moveValueIntoNewVariable(
  ast: Program,
  programMemory: ProgramMemory,
  sourceRange: Selection['range'],
  variableName: string
): {
  modifiedAst: Program
} {
  const { isSafe, value, replacer } = isNodeSafeToReplace(ast, sourceRange)
  if (!isSafe || value.type === 'Identifier') return { modifiedAst: ast }

  const { insertIndex } = findAllPreviousVariables(
    ast,
    programMemory,
    sourceRange
  )
  let _node = JSON.parse(JSON.stringify(ast))
  _node = replacer(_node, variableName).modifiedAst
  _node.body.splice(
    insertIndex,
    0,
    createVariableDeclaration(variableName, value)
  )
  return { modifiedAst: _node }
}
