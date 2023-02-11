import {
  Program,
  BlockStatement,
  CallExpression,
  PipeExpression,
  VariableDeclaration,
  VariableDeclarator,
  ExpressionStatement,
  Value,
  getNodeFromPath,
  Literal,
  PipeSubstitution,
  Identifier,
  ArrayExpression,
  ObjectExpression,
} from './abstractSyntaxTree'
import { PathToNode, ProgramMemory } from './executor'
import { addTagForSketchOnFace } from './std/sketch'

export function addSketchTo(
  node: Program,
  axis: 'xy' | 'xz' | 'yz',
  name = ''
): { modifiedAst: Program; id: string; pathToNode: (string | number)[] } {
  const _node = { ...node }
  const dumbyStartend = { start: 0, end: 0 }
  const _name = name || findUniqueName(node, 'part')

  const startSketchAt = createCallExpression('startSketchAt', [
    createArrayExpression([createLiteral(0), createLiteral(0)]),
  ])
  const rotate = createCallExpression(axis === 'xz' ? 'rx' : 'ry', [
    createLiteral(90),
    createPipeSubstitution(),
  ])
  const initialLineTo = createCallExpression('lineTo', [
    createArrayExpression([createLiteral(1), createLiteral(1)]),
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
  let pathToNode: (string | number)[] = [
    'body',
    sketchIndex,
    'declarations',
    '0',
    'init',
  ]
  if (axis !== 'xy') {
    pathToNode = [...pathToNode, 'body', '0']
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
    const showCall: CallExpression = {
      type: 'CallExpression',
      ...dumbyStartend,
      callee: {
        type: 'Identifier',
        ...dumbyStartend,
        name: 'show',
      },
      optional: false,
      arguments: [
        {
          type: 'Identifier',
          ...dumbyStartend,
          name,
        },
      ],
    }
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
  const newShowCallArgs: Value[] = [
    ...showCallArgs,
    {
      type: 'Identifier',
      ...dumbyStartend,
      name,
    },
  ]
  const newShowExpression: CallExpression = {
    type: 'CallExpression',
    ...dumbyStartend,
    callee: {
      type: 'Identifier',
      ...dumbyStartend,
      name: 'show',
    },
    optional: false,
    arguments: newShowCallArgs,
  }

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
      if (element.type === 'Literal') {
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
        updateWith.type === 'Literal' &&
        node.properties[keyIndex].value.type === 'Literal'
      ) {
        node.properties[keyIndex].value = updateWith
        return true
      } else if (
        node.properties[keyIndex].value.type === 'ArrayExpression' &&
        updateWith.type === 'ArrayExpression'
      ) {
        const arrExp = node.properties[keyIndex].value as ArrayExpression
        arrExp.elements.forEach((element, i) => {
          if (element.type === 'Literal') {
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
  pathToNode: (string | number)[],
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

  const { node: variableDeclorator, path: pathToDecleration } =
    getNodeFromPath<VariableDeclarator>(_node, pathToNode, 'VariableDeclarator')

  const extrudeCall: CallExpression = {
    type: 'CallExpression',
    ...dumbyStartend,
    callee: {
      type: 'Identifier',
      ...dumbyStartend,
      name: 'extrude',
    },
    optional: false,
    arguments: [
      createLiteral(4),
      shouldPipe
        ? createPipeSubstitution()
        : {
            type: 'Identifier',
            ...dumbyStartend,
            name: variableDeclorator.id.name,
          },
    ],
  }
  if (shouldPipe) {
    const pipeChain: PipeExpression = isInPipeExpression
      ? {
          type: 'PipeExpression',
          nonCodeMeta: {},
          ...dumbyStartend,
          body: [...pipeExpression.body, extrudeCall],
        }
      : {
          type: 'PipeExpression',
          nonCodeMeta: {},
          ...dumbyStartend,
          body: [sketchExpression as any, extrudeCall], // TODO fix this #25
        }

    variableDeclorator.init = pipeChain
    const pathToExtrudeArg = [
      ...pathToDecleration,
      'init',
      'body',
      pipeChain.body.length - 1,
      'arguments',
      0,
    ]

    return {
      modifiedAst: _node,
      pathToNode,
      pathToExtrudeArg,
    }
  }
  const name = findUniqueName(node, 'part')
  const VariableDeclaration: VariableDeclaration = {
    type: 'VariableDeclaration',
    ...dumbyStartend,
    declarations: [
      {
        type: 'VariableDeclarator',
        ...dumbyStartend,
        id: {
          type: 'Identifier',
          ...dumbyStartend,
          name,
        },
        init: extrudeCall,
      },
    ],
    kind: 'const',
  }
  const showCallIndex = getShowIndex(_node)
  _node.body.splice(showCallIndex, 0, VariableDeclaration)
  const pathToExtrudeArg = [
    'body',
    showCallIndex,
    'declarations',
    0,
    'init',
    'arguments',
    0,
  ]
  return {
    modifiedAst: addToShow(_node, name),
    pathToNode: [...pathToNode.slice(0, -1), showCallIndex],
    pathToExtrudeArg,
  }
}

export function sketchOnExtrudedFace(
  node: Program,
  pathToNode: (string | number)[],
  programMemory: ProgramMemory
): { modifiedAst: Program; pathToNode: (string | number)[] } {
  let _node = { ...node }
  const newSketchName = findUniqueName(node, 'part')
  const { node: oldSketchNode, path: pathToOldSketch } =
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
      createCallExpression('startSketchAt', [
        createArrayExpression([createLiteral(0), createLiteral(0)]),
      ]),
      createCallExpression('lineTo', [
        createArrayExpression([createLiteral(1), createLiteral(1)]),
        createPipeSubstitution(),
      ]),
      createCallExpression('transform', [
        createCallExpression('getExtrudeWallTransform', [
          createLiteral(tag),
          createIdentifier(oldSketchName),
        ]),
        createPipeSubstitution(),
      ]),
    ]),
    'const'
  )
  const expressionIndex = getLastIndex(pathToOldSketch)
  console.log('expressionIndex', expressionIndex, pathToOldSketch)
  _node.body.splice(expressionIndex + 1, 0, newSketch)

  return {
    modifiedAst: addToShow(_node, newSketchName),
    pathToNode: [...pathToNode.slice(0, -1), expressionIndex],
  }
}

const getLastIndex = (pathToNode: PathToNode): number => {
  const last = pathToNode[pathToNode.length - 1]
  if (typeof last === 'number') {
    return last
  }
  return getLastIndex(pathToNode.slice(0, -1))
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
    nonCodeMeta: {},
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
